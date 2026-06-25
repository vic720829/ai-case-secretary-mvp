import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import type { AiTaskType, LineMessageType, LineSenderRole } from "@/lib/types";
import {
  analyzeMessageForAiTasks,
  dateStringToTimestamp,
  type AiMessageContextItem,
  type AiTaskSuggestion
} from "@/services/aiTasks";
import { answerQuestionFromFirestore, shouldAnswerLineQuestion } from "@/services/aiAssistant";
import { buildAiDraftReviewLineMessages } from "@/services/aiDraftReviewLineMessages";
import {
  downloadLineMessageContent,
  getEventGroupId,
  getLineGroupName,
  getLineSenderName,
  pushLineMessages,
  replyLineText,
  type LineWebhookEvent
} from "@/services/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRelationHint = {
  sourceDraftId: string;
  targetDraftId: string;
  hint: string;
};

type LineAttachmentForWrite = {
  messageId: string;
  fileUrl: string;
  fileType: LineMessageType;
  senderName: string;
  senderRole: LineSenderRole;
  text: string;
  createdAt: Timestamp | null;
};

export async function handleLineWebhookEvents(events: LineWebhookEvent[]) {
  const db = getAdminDb();
  const results = await Promise.all(events.map((event) => handleAndLogLineEvent(db, event)));

  return NextResponse.json({ ok: true, results });
}

async function handleAndLogLineEvent(db: FirebaseFirestore.Firestore, event: LineWebhookEvent) {
  try {
    const result = await handleLineEvent(db, event);
    await writeWebhookLog(db, event, result);
    return result;
  } catch (caught) {
    const errorMessage = caught instanceof Error ? caught.message : "Unknown LINE webhook error";
    const result = { ok: false, errorMessage };
    await writeWebhookLog(db, event, result);
    return result;
  }
}

async function handleLineEvent(db: FirebaseFirestore.Firestore, event: LineWebhookEvent) {
  if (event.type === "postback") {
    return handleLinePostback(db, event);
  }

  if (event.type !== "message" || !event.message) {
    const pendingGroup = await syncLinePendingGroup(db, null, event);
    const adminNotification = pendingGroup
      ? await notifyAdminGroupsAboutPendingLineGroup(db, {
          groupId: pendingGroup.groupId,
          groupName: pendingGroup.groupName,
          eventType: event.type ?? ""
        })
      : { sent: 0, failed: 0, groups: 0 };

    return pendingGroup
      ? {
          ok: true,
          reason: "LINE group recorded for binding",
          groupId: pendingGroup.groupId,
          groupName: pendingGroup.groupName,
          adminNotifications: adminNotification.sent,
          adminNotificationFailures: adminNotification.failed
        }
      : { skipped: true, reason: "Unsupported event" };
  }

  const groupId = getEventGroupId(event);
  const lineGroupSnapshot = groupId
    ? await db.collection("line_groups").where("groupId", "==", groupId).limit(1).get()
    : null;
  const lineGroupDoc = lineGroupSnapshot && !lineGroupSnapshot.empty ? lineGroupSnapshot.docs[0] : null;
  const lineGroup = lineGroupDoc ? lineGroupDoc.data() : null;
  const isAdminGroup = lineGroup?.groupType === "admin";
  const canAssistantReply = isAdminGroup && lineGroup?.allowAssistantReplies !== false;
  const projectId = isAdminGroup ? "" : String(lineGroup?.projectId ?? "");
  const messageType = normalizeMessageType(event.message.type);
  const lineMessageId = event.message.id ?? "";
  const duplicatedMessage = lineMessageId
    ? await db.collection("messages").where("lineMessageId", "==", lineMessageId).limit(1).get()
    : null;

  if (duplicatedMessage && !duplicatedMessage.empty) {
    return {
      skipped: true,
      reason: "Duplicate LINE message",
      messageId: duplicatedMessage.docs[0].id,
      lineMessageId,
      projectId
    };
  }

  await syncLineGroupName(lineGroupDoc, event);

  const lineSenderName = await getLineSenderName(event);
  const member = await findLineMember(db, event.source?.userId ?? "", projectId);
  const senderName = member.displayName || lineSenderName;
  const senderRole = member.role;
  await syncLinePendingGroup(db, lineGroupDoc, event, {
    lastMessageText: event.message.text ?? `[${messageType}]`,
    lastSenderName: senderName,
    incrementMessageCount: true
  });
  const fileUrl = messageType === "text" ? "" : await saveLineMessageFile(event, groupId, messageType);
  const messageRef = await db.collection("messages").add({
    projectId,
    groupId,
    lineMessageId,
    senderId: event.source?.userId ?? "",
    senderName,
    senderRole,
    messageType,
    text: event.message.text ?? "",
    fileUrl,
    timestamp: event.timestamp ? Timestamp.fromMillis(event.timestamp) : FieldValue.serverTimestamp(),
    isProcessed: false,
    createdAt: FieldValue.serverTimestamp()
  });

  if (messageType === "text" && event.message.text) {
    const shouldCreateAiDrafts = Boolean(lineGroup && !isAdminGroup && projectId);
    const recentMessages = shouldCreateAiDrafts ? await loadRecentMessageContext(db, groupId, messageRef.id) : [];
    const nearbyAttachments = shouldCreateAiDrafts
      ? await loadRecentImageAttachments(db, {
          groupId,
          projectId,
          senderId: event.source?.userId ?? "",
          currentMessageId: messageRef.id,
          currentTimestamp: event.timestamp ? Timestamp.fromMillis(event.timestamp) : null
        })
      : [];
    const baseSuggestions = shouldCreateAiDrafts
      ? await analyzeMessageForAiTasks(event.message.text, senderRole, { recentMessages })
      : [];
    const suggestions =
      baseSuggestions.length || !nearbyAttachments.length
        ? baseSuggestions
        : [buildImageReviewSuggestion(event.message.text)];

    const pendingImageDraft = nearbyAttachments.length
      ? await findPendingImageDraftForAttachments(db, {
          projectId,
          groupId,
          senderId: event.source?.userId ?? "",
          attachmentMessageIds: nearbyAttachments.map((attachment) => attachment.messageId)
        })
      : null;
    const createdDraftIds = await createAiTaskDrafts(db, {
      projectId,
      groupId,
      sourceMessageId: messageRef.id,
      sourceSenderId: event.source?.userId ?? "",
      senderName,
      senderRole,
      suggestions,
      attachments: nearbyAttachments,
      reusableDraftId: pendingImageDraft?.id ?? ""
    });
    const relationHints = suggestions.length
      ? await linkPossibleAnsweredFollowups(db, {
          projectId,
          groupId,
          senderName,
          senderRole,
          suggestions,
          createdDraftIds
        }).catch(() => [])
      : [];
    const adminNotification = suggestions.length
      ? await notifyAdminGroupsAboutAiDrafts(db, {
          projectId,
          senderName,
          senderRole,
          text: event.message.text,
          suggestions,
          createdDraftIds,
          relationHints,
          attachmentCount: nearbyAttachments.length
        })
      : { sent: 0, failed: 0, groups: 0 };
    const unboundNotification = !shouldCreateAiDrafts && !isAdminGroup
      ? await notifyAdminGroupsAboutUnboundLineMessage(db, {
          groupId,
          senderName,
          senderRole,
          text: event.message.text,
          reason: getAiSkippedReason(lineGroup, projectId, isAdminGroup)
        })
      : { sent: 0, failed: 0, groups: 0 };

    if (shouldReplyInLineChat(event, canAssistantReply) && shouldAnswerLineQuestion(event.message.text)) {
      const answer = await answerQuestionFromFirestore(event.message.text, projectId);
      await replyLineText(event.replyToken, answer);
    }

    await messageRef.update({ isProcessed: true });

    return {
      messageId: messageRef.id,
      lineMessageId,
      aiTaskDrafts: suggestions.length,
      adminNotifications: adminNotification.sent + unboundNotification.sent,
      adminNotificationFailures: adminNotification.failed + unboundNotification.failed,
      aiDraftRelations: relationHints.length,
      projectId,
      senderName,
      senderRole,
      messageText: event.message.text,
      aiSkippedReason: shouldCreateAiDrafts ? "" : getAiSkippedReason(lineGroup, projectId, isAdminGroup)
    };
  }

  if (messageType === "image" && fileUrl) {
    const shouldCreateAiDrafts = Boolean(lineGroup && !isAdminGroup && projectId);
    const nearbyText = shouldCreateAiDrafts
      ? await loadRecentTextForImage(db, {
          groupId,
          projectId,
          senderId: event.source?.userId ?? "",
          currentMessageId: messageRef.id,
          currentTimestamp: event.timestamp ? Timestamp.fromMillis(event.timestamp) : null
        })
      : "";
    const attachment = buildLineAttachment({
      messageId: messageRef.id,
      fileUrl,
      fileType: messageType,
      senderName,
      senderRole,
      text: nearbyText,
      createdAt: event.timestamp ? Timestamp.fromMillis(event.timestamp) : null
    });
    const baseSuggestions =
      shouldCreateAiDrafts && nearbyText
        ? await analyzeMessageForAiTasks(nearbyText, senderRole, { recentMessages: [] })
        : [];
    const suggestions = shouldCreateAiDrafts
      ? baseSuggestions.length
        ? baseSuggestions
        : [buildImageReviewSuggestion(nearbyText)]
      : [];
    const createdDraftIds = await createAiTaskDrafts(db, {
      projectId,
      groupId,
      sourceMessageId: messageRef.id,
      sourceSenderId: event.source?.userId ?? "",
      senderName,
      senderRole,
      suggestions,
      attachments: [attachment]
    });
    const adminNotification = suggestions.length
      ? await notifyAdminGroupsAboutAiDrafts(db, {
          projectId,
          senderName,
          senderRole,
          text: nearbyText || "客戶傳送圖片，尚未提供文字說明。",
          suggestions,
          createdDraftIds,
          relationHints: [],
          attachmentCount: 1
        })
      : { sent: 0, failed: 0, groups: 0 };
    const unboundNotification = !shouldCreateAiDrafts && !isAdminGroup
      ? await notifyAdminGroupsAboutUnboundLineMessage(db, {
          groupId,
          senderName,
          senderRole,
          text: "客戶傳送圖片",
          reason: getAiSkippedReason(lineGroup, projectId, isAdminGroup)
        })
      : { sent: 0, failed: 0, groups: 0 };

    if (shouldCreateAiDrafts) {
      await messageRef.update({ isProcessed: true });
    }

    return {
      messageId: messageRef.id,
      lineMessageId,
      aiTaskDrafts: suggestions.length,
      adminNotifications: adminNotification.sent + unboundNotification.sent,
      adminNotificationFailures: adminNotification.failed + unboundNotification.failed,
      projectId,
      senderName,
      senderRole,
      messageText: nearbyText,
      attachmentCount: 1
    };
  }

  return { messageId: messageRef.id, lineMessageId, aiTaskDrafts: 0, projectId };
}

async function handleLinePostback(db: FirebaseFirestore.Firestore, event: LineWebhookEvent) {
  const params = new URLSearchParams(event.postback?.data ?? "");
  const action = params.get("action") ?? "";
  const key = params.get("key") ?? "";

  if (!key) {
    return { skipped: true, reason: "Unsupported postback" };
  }

  if (["approve_ai_task", "reject_ai_task"].includes(action)) {
    return handleAiTaskReviewPostback(db, event, action, key);
  }

  if (["resolve_ai_followup", "snooze_ai_followup"].includes(action)) {
    return handleAiFollowupPostback(db, event, action, key, params);
  }

  if (!["confirm_reminder", "snooze_reminder", "keep_reminder"].includes(action)) {
    return { skipped: true, reason: "Unsupported postback" };
  }

  const senderName = await getLineSenderName(event);
  const reminderRef = db.collection("reminder_logs").doc(key);
  const reminderSnapshot = await reminderRef.get();

  if (!reminderSnapshot.exists) {
    await replyLineText(event.replyToken, "找不到這筆提醒，可能已被刪除或重新建立。");
    return { skipped: true, reason: "Reminder not found", key };
  }

  const reminder = reminderSnapshot.data() ?? {};
  const title = String(reminder.title ?? "未命名提醒");

  if (action === "confirm_reminder") {
    await reminderRef.set(
      {
        status: "confirmed",
        confirmedBy: senderName,
        confirmedAt: FieldValue.serverTimestamp(),
        snoozedUntil: FieldValue.delete(),
        lastAction: "confirmed",
        actionBy: senderName,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await replyLineText(event.replyToken, `已確認：${title}\n這筆提醒不會再出現在每日提醒。`);
    return { ok: true, action, key };
  }

  if (action === "snooze_reminder") {
    const days = clampNumber(Number(params.get("days") ?? 1), 1, 14);
    const snoozedUntil = datePlusDays(taipeiDateString(), days);

    await reminderRef.set(
      {
        status: "pending",
        snoozedUntil,
        lastAction: "snoozed",
        actionBy: senderName,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await replyLineText(event.replyToken, `已延後提醒：${title}\n下次提醒日：${snoozedUntil.replaceAll("-", "/")}`);
    return { ok: true, action, key, snoozedUntil };
  }

  await reminderRef.set(
    {
      status: "pending",
      snoozedUntil: FieldValue.delete(),
      lastAction: "kept_pending",
      actionBy: senderName,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  await replyLineText(event.replyToken, `已保留待處理：${title}`);

  return { ok: true, action, key };
}

async function handleAiFollowupPostback(
  db: FirebaseFirestore.Firestore,
  event: LineWebhookEvent,
  action: string,
  key: string,
  params: URLSearchParams
) {
  const isAdminGroup = await isAssistantAdminGroup(db, getEventGroupId(event));
  if (!isAdminGroup) {
    await replyLineText(event.replyToken, "客戶回覆追蹤只能在公司 LINE 後台群組操作。");
    return { skipped: true, reason: "AI followup outside admin LINE group", key };
  }

  const senderName = await getLineSenderName(event);
  const actionBy = `LINE:${senderName}`;
  const aiTaskRef = db.collection("ai_tasks").doc(key);
  const reminderRef = db.collection("reminder_logs").doc(`ai_task_${key}_customer_followup_unanswered`);

  if (action === "snooze_ai_followup") {
    const days = clampNumber(Number(params.get("days") ?? 1), 1, 14);
    const snoozedUntil = datePlusDays(taipeiDateString(), days);

    await reminderRef.set(
      {
        status: "pending",
        snoozedUntil,
        lastAction: "snoozed_customer_followup",
        actionBy,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await replyLineText(event.replyToken, `已設定明天追蹤。\n下次提醒日：${snoozedUntil.replaceAll("-", "/")}`);

    return { ok: true, action, key, senderName, messageText: "明天追蹤客戶回覆" };
  }

  const result = await db.runTransaction(async (transaction) => {
    const aiTaskSnapshot = await transaction.get(aiTaskRef);
    if (!aiTaskSnapshot.exists) return { status: "not_found" as const };

    const aiTask = aiTaskSnapshot.data() ?? {};
    const title = String(aiTask.title ?? "未命名追蹤").trim() || "未命名追蹤";
    const reviewStatus = String(aiTask.reviewStatus ?? "pending");
    const status = String(aiTask.status ?? "todo");

    if (reviewStatus === "pending") {
      transaction.update(aiTaskRef, {
        reviewStatus: "rejected",
        reviewedBy: actionBy,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedVia: "line",
        resolutionStatus: "confirmed_resolved",
        updatedAt: FieldValue.serverTimestamp()
      });
    } else if (reviewStatus === "approved" && status !== "done") {
      transaction.update(aiTaskRef, {
        status: "done",
        resolutionStatus: "confirmed_resolved",
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    transaction.set(
      reminderRef,
      {
        status: "confirmed",
        confirmedBy: actionBy,
        confirmedAt: FieldValue.serverTimestamp(),
        snoozedUntil: FieldValue.delete(),
        lastAction: "resolved_customer_followup",
        actionBy,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    transaction.set(
      db.collection("reminder_logs").doc(`ai_task_${key}_ai_task_pending_review`),
      {
        status: "confirmed",
        confirmedBy: actionBy,
        confirmedAt: FieldValue.serverTimestamp(),
        lastAction: "resolved_customer_followup",
        actionBy,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { status: "resolved" as const, title };
  });

  if (result.status === "not_found") {
    await replyLineText(event.replyToken, "找不到這筆客戶追蹤，可能已被刪除。");
    return { skipped: true, reason: "AI followup not found", key };
  }

  await replyLineText(event.replyToken, `已標記為已回覆：${result.title}`);

  return { ok: true, action, key, senderName, messageText: `已回覆：${result.title}` };
}

async function handleAiTaskReviewPostback(
  db: FirebaseFirestore.Firestore,
  event: LineWebhookEvent,
  action: string,
  key: string
) {
  const isAdminGroup = await isAssistantAdminGroup(db, getEventGroupId(event));
  if (!isAdminGroup) {
    await replyLineText(event.replyToken, "AI 草稿審核只能在公司 LINE 後台群組操作。");
    return { skipped: true, reason: "AI review outside admin LINE group", key };
  }

  const senderName = await getLineSenderName(event);
  const reviewedBy = `LINE:${senderName}`;
  const aiTaskRef = db.collection("ai_tasks").doc(key);
  const reminderRef = db.collection("reminder_logs").doc(`ai_task_${key}_ai_task_pending_review`);
  const result = await db.runTransaction(async (transaction) => {
    const aiTaskSnapshot = await transaction.get(aiTaskRef);

    if (!aiTaskSnapshot.exists) {
      return { status: "not_found" as const };
    }

    const aiTask = aiTaskSnapshot.data() ?? {};
    const title = String(aiTask.title ?? "未命名草稿").trim() || "未命名草稿";
    const reviewStatus = String(aiTask.reviewStatus ?? "pending");

    if (reviewStatus !== "pending") {
      return { status: "already_reviewed" as const, title };
    }

    if (action === "reject_ai_task") {
      transaction.update(aiTaskRef, {
        reviewStatus: "rejected",
        reviewedBy,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedVia: "line",
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.set(
        reminderRef,
        {
          status: "confirmed",
          confirmedBy: reviewedBy,
          confirmedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastAction: "rejected_ai_task_line"
        },
        { merge: true }
      );

      return { status: "rejected" as const, title };
    }

    const taskInput = buildTaskFromAiDraft(aiTask);
    if (!taskInput.projectId || !taskInput.title) {
      return { status: "needs_edit" as const, title };
    }

    const taskRef = db.collection("tasks").doc();
    transaction.set(taskRef, {
      ...taskInput,
      source: "ai",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.update(aiTaskRef, {
      status: taskInput.status,
      assignedTo: taskInput.assignee,
      reviewStatus: "approved",
      approvedTaskId: taskRef.id,
      reviewedBy,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedVia: "line",
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(
      reminderRef,
      {
        status: "confirmed",
        confirmedBy: reviewedBy,
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastAction: "approved_ai_task_line"
      },
      { merge: true }
    );

    return {
      status: "approved" as const,
      title: taskInput.title,
      projectId: taskInput.projectId,
      approvedTaskId: taskRef.id
    };
  });

  if (result.status === "not_found") {
    await replyLineText(event.replyToken, "找不到這筆 AI 草稿，可能已被刪除。");
    return { skipped: true, reason: "AI task draft not found", key };
  }

  if (result.status === "already_reviewed") {
    await replyLineText(event.replyToken, `這筆 AI 草稿已經審核過：${result.title}`);
    return { skipped: true, reason: "AI task draft already reviewed", key };
  }

  if (result.status === "rejected") {
    await replyLineText(event.replyToken, `已拒絕 AI 草稿：${result.title}`);

    return { ok: true, action, key, senderName, messageText: `拒絕 AI 草稿：${result.title}` };
  }

  if (result.status === "needs_edit") {
    const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
    await replyLineText(
      event.replyToken,
      [
        `這筆 AI 草稿不能直接在 LINE 通過：${result.title}`,
        "原因：缺少案件或標題。",
        reviewUrl ? `請到網站編輯：${reviewUrl}` : "請到網站 AI 審核頁補齊資料。"
      ].join("\n")
    );

    return { skipped: true, reason: "AI task draft requires website editing", key };
  }

  await replyLineText(event.replyToken, `已通過並建立待辦：${result.title}`);

  return {
    ok: true,
    action,
    key,
    projectId: result.projectId,
    senderName,
    messageText: `通過 AI 草稿並建立待辦：${result.title}`,
    approvedTaskId: result.approvedTaskId
  };
}

async function syncLineGroupName(
  lineGroupDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null,
  event: LineWebhookEvent
) {
  if (!lineGroupDoc) return;

  const currentGroupName = String(lineGroupDoc.data().groupName ?? "").trim();
  if (currentGroupName) return;

  const groupName = await getLineGroupName(event);
  if (!groupName) return;

  await lineGroupDoc.ref.set(
    {
      groupName,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function syncLinePendingGroup(
  db: FirebaseFirestore.Firestore,
  lineGroupDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null,
  event: LineWebhookEvent,
  input?: {
    lastMessageText?: string;
    lastSenderName?: string;
    incrementMessageCount?: boolean;
  }
) {
  const sourceType = event.source?.type ?? "";
  const groupId = event.source?.groupId ?? event.source?.roomId ?? "";

  if (!groupId || (sourceType !== "group" && sourceType !== "room")) return null;

  const snapshot = await db.collection("line_pending_groups").where("groupId", "==", groupId).limit(10).get();

  if (lineGroupDoc) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
    return null;
  }

  const existing = snapshot.empty ? null : snapshot.docs[0];
  const existingGroupName = existing ? String(existing.data().groupName ?? "").trim() : "";
  const groupName =
    existingGroupName ||
    (sourceType === "group" ? await getLineGroupName(event) : "") ||
    (sourceType === "room" ? "LINE 多人聊天室" : "");
  const ref = existing?.ref ?? db.collection("line_pending_groups").doc(sanitizePathSegment(groupId));
  const payload: FirebaseFirestore.DocumentData = {
    groupId,
    sourceType,
    lastEventType: event.type ?? "",
    updatedAt: FieldValue.serverTimestamp(),
    lastSeenAt: event.timestamp ? Timestamp.fromMillis(event.timestamp) : FieldValue.serverTimestamp()
  };

  if (!existing) {
    payload.createdAt = FieldValue.serverTimestamp();
    payload.messageCount = 0;
  }
  if (groupName) {
    payload.groupName = groupName;
  }
  if (input?.lastMessageText !== undefined) {
    payload.lastMessageText = input.lastMessageText.slice(0, 500);
  }
  if (input?.lastSenderName !== undefined) {
    payload.lastSenderName = input.lastSenderName.slice(0, 120);
  }
  if (input?.incrementMessageCount) {
    payload.messageCount = FieldValue.increment(1);
  }

  await ref.set(payload, { merge: true });

  return {
    groupId,
    groupName
  };
}

async function createAiTaskDrafts(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    groupId: string;
    sourceMessageId: string;
    sourceSenderId: string;
    senderName: string;
    senderRole: LineSenderRole;
    suggestions: AiTaskSuggestion[];
    attachments: LineAttachmentForWrite[];
    reusableDraftId?: string;
  }
) {
  const attachmentMessageIds = input.attachments.map((attachment) => attachment.messageId);
  const createdDraftIds: string[] = [];

  for (const [index, suggestion] of input.suggestions.entries()) {
    const payload = {
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      sourceGroupId: input.groupId,
      sourceSenderId: input.sourceSenderId,
      sourceSenderName: input.senderName,
      sourceSenderRole: input.senderRole,
      title: suggestion.title,
      description: suggestion.description,
      taskType: suggestion.taskType,
      status: "todo",
      assignedTo: suggestion.assignedTo ?? "",
      dueDate: dateStringToTimestamp(suggestion.dueDate),
      createdByAI: true,
      reviewStatus: "pending",
      reviewedBy: "",
      reviewedAt: null,
      approvedTaskId: "",
      resolutionStatus: "open",
      linkedAiTaskId: "",
      resolutionHint: "",
      resolutionLinkedAt: null,
      attachments: input.attachments,
      attachmentMessageIds,
      attachmentCount: input.attachments.length,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (index === 0 && input.reusableDraftId) {
      await db.collection("ai_tasks").doc(input.reusableDraftId).set(payload, { merge: true });
      createdDraftIds.push(input.reusableDraftId);
      continue;
    }

    const draftRef = await db.collection("ai_tasks").add({
      ...payload,
      createdAt: FieldValue.serverTimestamp()
    });
    createdDraftIds.push(draftRef.id);
  }

  return createdDraftIds;
}

async function findPendingImageDraftForAttachments(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    groupId: string;
    senderId: string;
    attachmentMessageIds: string[];
  }
) {
  if (!input.attachmentMessageIds.length) return null;

  const snapshot = await db.collection("ai_tasks").where("projectId", "==", input.projectId).get();
  const attachmentIds = new Set(input.attachmentMessageIds);
  const cutoff = Date.now() - 30 * 60 * 1000;

  return (
    snapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter((item) => item.data.sourceGroupId === input.groupId)
      .filter((item) => !input.senderId || item.data.sourceSenderId === input.senderId)
      .filter((item) => item.data.reviewStatus === "pending")
      .filter((item) => String(item.data.title ?? "").includes("圖片待確認"))
      .filter((item) => timestampToMillis(item.data.createdAt) >= cutoff)
      .find((item) => {
        const rawIds = Array.isArray(item.data.attachmentMessageIds) ? item.data.attachmentMessageIds : [];
        return rawIds.some((id) => attachmentIds.has(String(id)));
      }) ?? null
  );
}

async function loadRecentImageAttachments(
  db: FirebaseFirestore.Firestore,
  input: {
    groupId: string;
    projectId: string;
    senderId: string;
    currentMessageId: string;
    currentTimestamp: Timestamp | null;
  }
) {
  const currentMillis = input.currentTimestamp?.toMillis() ?? Date.now();
  const cutoff = currentMillis - 10 * 60 * 1000;
  const snapshot = await db.collection("messages").where("groupId", "==", input.groupId).get();

  return snapshot.docs
    .filter((doc) => doc.id !== input.currentMessageId)
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => String(item.data.projectId ?? "") === input.projectId)
    .filter((item) => !input.senderId || String(item.data.senderId ?? "") === input.senderId)
    .filter((item) => item.data.messageType === "image")
    .filter((item) => String(item.data.fileUrl ?? ""))
    .filter((item) => {
      const time = timestampToMillis(item.data.timestamp) || timestampToMillis(item.data.createdAt);
      return time >= cutoff && time <= currentMillis;
    })
    .sort((a, b) => (timestampToMillis(a.data.timestamp) || 0) - (timestampToMillis(b.data.timestamp) || 0))
    .slice(-4)
    .map((item) =>
      buildLineAttachment({
        messageId: item.id,
        fileUrl: String(item.data.fileUrl ?? ""),
        fileType: "image",
        senderName: String(item.data.senderName ?? ""),
        senderRole: normalizeSenderRole(String(item.data.senderRole ?? "unknown")),
        text: String(item.data.text ?? ""),
        createdAt: item.data.timestamp instanceof Timestamp ? item.data.timestamp : null
      })
    );
}

async function loadRecentTextForImage(
  db: FirebaseFirestore.Firestore,
  input: {
    groupId: string;
    projectId: string;
    senderId: string;
    currentMessageId: string;
    currentTimestamp: Timestamp | null;
  }
) {
  const currentMillis = input.currentTimestamp?.toMillis() ?? Date.now();
  const cutoff = currentMillis - 10 * 60 * 1000;
  const snapshot = await db.collection("messages").where("groupId", "==", input.groupId).get();

  return snapshot.docs
    .filter((doc) => doc.id !== input.currentMessageId)
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => String(item.data.projectId ?? "") === input.projectId)
    .filter((item) => !input.senderId || String(item.data.senderId ?? "") === input.senderId)
    .filter((item) => item.data.messageType === "text")
    .filter((item) => String(item.data.text ?? "").trim())
    .filter((item) => {
      const time = timestampToMillis(item.data.timestamp) || timestampToMillis(item.data.createdAt);
      return time >= cutoff && time <= currentMillis;
    })
    .sort((a, b) => (timestampToMillis(a.data.timestamp) || 0) - (timestampToMillis(b.data.timestamp) || 0))
    .slice(-4)
    .map((item) => String(item.data.text ?? "").trim())
    .join("\n");
}

function buildLineAttachment(input: LineAttachmentForWrite): LineAttachmentForWrite {
  return {
    messageId: input.messageId,
    fileUrl: input.fileUrl,
    fileType: input.fileType,
    senderName: input.senderName,
    senderRole: input.senderRole,
    text: input.text,
    createdAt: input.createdAt
  };
}

function buildImageReviewSuggestion(text: string): AiTaskSuggestion {
  const trimmedText = text.trim();

  return {
    title: trimmedText ? `圖片待確認：${shortText(trimmedText, 22)}` : "圖片待確認",
    description: trimmedText
      ? `客戶傳送圖片，並提供相關文字：\n${trimmedText}\n\n請確認是否需要建立修補、變更或追蹤待辦。`
      : "客戶傳送圖片，但目前沒有前後文字說明。請人工確認圖片用途，判斷是否需要建立修補、變更或追蹤待辦。",
    taskType: "followup",
    dueDate: "",
    assignedTo: ""
  };
}

function shortText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

async function notifyAdminGroupsAboutAiDrafts(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    senderName: string;
    senderRole: LineSenderRole;
    text: string;
    suggestions: AiTaskSuggestion[];
    createdDraftIds: string[];
    relationHints: DraftRelationHint[];
    attachmentCount?: number;
  }
) {
  try {
    const adminGroups = await listAssistantAdminGroupIds(db);

    if (!adminGroups.length) return { sent: 0, failed: 0, groups: 0 };

    const projectSnapshot = input.projectId ? await db.collection("projects").doc(input.projectId).get() : null;
    const project = projectSnapshot?.exists ? projectSnapshot.data() ?? {} : {};
    const projectName = project.name
      ? `${String(project.name)}${project.clientName ? ` / ${String(project.clientName)}` : ""}`
      : "未綁定案件";
    const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
    const relationLines = input.relationHints.length
      ? ["", "保守關聯提示：", ...input.relationHints.map((relation) => `- ${relation.hint}`)]
      : [];
    const text = [
      "AI案件秘書建立審核草稿",
      `案件：${projectName}`,
      `來源：${input.senderName || "LINE 使用者"}（${senderRoleLabel(input.senderRole)}）`,
      `原對話：${input.text}`,
      input.attachmentCount ? `附件：${input.attachmentCount} 張圖片` : "",
      "",
      ...input.suggestions.slice(0, 5).map((suggestion, index) => {
        const dueDate = suggestion.dueDate ? `｜截止：${suggestion.dueDate.replaceAll("-", "/")}` : "";
        const draftId = input.createdDraftIds[index] ? `｜草稿ID：${input.createdDraftIds[index]}` : "";
        return `- ${suggestion.title}｜${suggestion.taskType}${dueDate}${draftId}`;
      }),
      ...relationLines,
      "",
      reviewUrl ? `審核：${reviewUrl}` : "請到網站 AI 審核頁確認。"
    ].join("\n");
    const reviewMessages = buildAiDraftReviewLineMessages({
      projectName,
      reviewUrl,
      summaryText: text,
      items: input.suggestions.map((suggestion, index) => ({
        id: input.createdDraftIds[index] ?? "",
        title: suggestion.title,
        taskType: suggestion.taskType,
        dueDate: suggestion.dueDate
      }))
    });
    const results = await Promise.allSettled(
      adminGroups.map((groupId) => pushLineMessages(groupId, reviewMessages))
    );

    return {
      sent: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length,
      groups: adminGroups.length
    };
  } catch {
    return { sent: 0, failed: 1, groups: 0 };
  }
}

async function notifyAdminGroupsAboutUnboundLineMessage(
  db: FirebaseFirestore.Firestore,
  input: {
    groupId: string;
    senderName: string;
    senderRole: LineSenderRole;
    text: string;
    reason: string;
  }
) {
  try {
    const adminGroups = await listAssistantAdminGroupIds(db);
    if (!adminGroups.length) return { sent: 0, failed: 0, groups: 0 };

    const lineGroupsUrl = getSiteUrl() ? `${getSiteUrl()}/line-groups` : "";
    const text = [
      "AI案件秘書收到未處理的 LINE 對話",
      `原因：${input.reason}`,
      `groupId：${input.groupId || "未提供"}`,
      `來源：${input.senderName || "LINE 使用者"}（${senderRoleLabel(input.senderRole)}）`,
      `原對話：${input.text}`,
      "",
      lineGroupsUrl ? `請先綁定 LINE 群組：${lineGroupsUrl}` : "請到網站 LINE 群組頁綁定案件。"
    ].join("\n");
    const results = await Promise.allSettled(
      adminGroups.map((groupId) => pushLineMessages(groupId, [{ type: "text", text }]))
    );

    return {
      sent: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length,
      groups: adminGroups.length
    };
  } catch {
    return { sent: 0, failed: 1, groups: 0 };
  }
}

async function notifyAdminGroupsAboutPendingLineGroup(
  db: FirebaseFirestore.Firestore,
  input: {
    groupId: string;
    groupName: string;
    eventType: string;
  }
) {
  try {
    const adminGroups = await listAssistantAdminGroupIds(db);
    if (!adminGroups.length) return { sent: 0, failed: 0, groups: 0 };

    const lineGroupsUrl = getSiteUrl() ? `${getSiteUrl()}/line-groups` : "";
    const text = [
      "發現未綁定 LINE 群組",
      `群組：${input.groupName || "尚未取得群組名稱"}`,
      `事件：${input.eventType || "LINE event"}`,
      `groupId：${input.groupId}`,
      "",
      "這個群組尚未綁定案件，也不是公司後台群組。",
      lineGroupsUrl ? `請到網站綁定：${lineGroupsUrl}` : "請到網站的 LINE群組 頁面綁定。"
    ].join("\n");
    const results = await Promise.allSettled(
      adminGroups.map((groupId) => pushLineMessages(groupId, [{ type: "text", text }]))
    );

    return {
      sent: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length,
      groups: adminGroups.length
    };
  } catch {
    return { sent: 0, failed: 1, groups: 0 };
  }
}

async function listAssistantAdminGroupIds(db: FirebaseFirestore.Firestore) {
  const adminGroupSnapshot = await db.collection("line_groups").where("groupType", "==", "admin").get();

  return adminGroupSnapshot.docs
    .map((doc) => doc.data())
    .filter((group) => group.allowAssistantReplies !== false)
    .map((group) => String(group.groupId ?? ""))
    .filter(Boolean);
}

async function isAssistantAdminGroup(db: FirebaseFirestore.Firestore, groupId: string) {
  if (!groupId) return false;

  const snapshot = await db.collection("line_groups").where("groupId", "==", groupId).limit(1).get();
  if (snapshot.empty) return false;

  const group = snapshot.docs[0].data();
  return group.groupType === "admin" && group.allowAssistantReplies !== false;
}

function buildTaskFromAiDraft(aiTask: FirebaseFirestore.DocumentData) {
  const taskType = normalizeAiTaskType(String(aiTask.taskType ?? ""));
  const attachments = readLineAttachments(aiTask.attachments);

  return {
    title: String(aiTask.title ?? "").trim(),
    description: String(aiTask.description ?? "").trim(),
    projectId: String(aiTask.projectId ?? "").trim(),
    assignee: String(aiTask.assignedTo ?? "").trim(),
    dueDate: timestampToTaipeiInputDate(aiTask.dueDate),
    status: normalizeTaskStatus(String(aiTask.status ?? "")),
    source: "ai" as const,
    riskLevel: riskByAiTaskType[taskType],
    attachments,
    attachmentMessageIds: attachments.map((attachment) => attachment.messageId),
    attachmentCount: attachments.length
  };
}

function readLineAttachments(value: unknown): LineAttachmentForWrite[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const attachment = item as Record<string, unknown>;
      const fileUrl = String(attachment.fileUrl ?? "");
      const messageId = String(attachment.messageId ?? "");
      if (!fileUrl || !messageId) return null;

      return buildLineAttachment({
        messageId,
        fileUrl,
        fileType: attachment.fileType === "audio" ? "audio" : "image",
        senderName: String(attachment.senderName ?? ""),
        senderRole: normalizeSenderRole(String(attachment.senderRole ?? "unknown")),
        text: String(attachment.text ?? ""),
        createdAt: attachment.createdAt instanceof Timestamp ? attachment.createdAt : null
      });
    })
    .filter((attachment): attachment is LineAttachmentForWrite => Boolean(attachment));
}

const riskByAiTaskType: Record<AiTaskType, "low" | "medium" | "high"> = {
  promise: "medium",
  change: "high",
  followup: "medium",
  payment: "high",
  invoice: "high"
};

function normalizeAiTaskType(value: string): AiTaskType {
  if (value === "promise" || value === "change" || value === "followup" || value === "payment" || value === "invoice") {
    return value;
  }

  return "followup";
}

function normalizeTaskStatus(value: string): "todo" | "doing" | "done" {
  if (value === "doing" || value === "done") return value;
  return "todo";
}

function timestampToTaipeiInputDate(value: unknown) {
  let date: Date | null = null;

  if (value instanceof Timestamp) {
    date = value.toDate();
  } else if (value && typeof value === "object" && "toDate" in value) {
    date = (value as { toDate: () => Date }).toDate();
  }

  if (!date || Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

async function linkPossibleAnsweredFollowups(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    groupId: string;
    senderName: string;
    senderRole: LineSenderRole;
    suggestions: AiTaskSuggestion[];
    createdDraftIds: string[];
  }
): Promise<DraftRelationHint[]> {
  if (!input.projectId || !input.groupId || input.senderRole === "client") return [];

  const answerDrafts = input.suggestions
    .map((suggestion, index) => ({ suggestion, draftId: input.createdDraftIds[index] ?? "" }))
    .filter((draft) => draft.draftId && isPotentialAnswerDraft(draft.suggestion, input.senderRole));
  if (!answerDrafts.length) return [];

  let snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
  try {
    snapshot = await db.collection("ai_tasks").where("projectId", "==", input.projectId).get();
  } catch {
    return [];
  }

  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => !input.createdDraftIds.includes(item.id))
    .filter((item) => item.data.sourceGroupId === input.groupId)
    .filter((item) => item.data.reviewStatus === "pending")
    .filter((item) => item.data.taskType === "followup")
    .filter((item) => item.data.sourceSenderRole === "client" || item.data.sourceSenderRole === "unknown")
    .filter((item) => !item.data.linkedAiTaskId)
    .filter((item) => item.data.resolutionStatus !== "confirmed_resolved")
    .filter((item) => timestampToMillis(item.data.createdAt) >= cutoff)
    .sort((a, b) => timestampToMillis(b.data.createdAt) - timestampToMillis(a.data.createdAt));

  if (candidates.length !== 1) return [];

  const candidate = candidates[0];
  const answerDraft = answerDrafts[0];
  const answerTitle = answerDraft.suggestion.title;
  const candidateTitle = String(candidate.data.title ?? "待回覆事項");
  const hint = `「${answerTitle}」可能回覆了「${candidateTitle}」，請人工確認。`;

  await Promise.all([
    db.collection("ai_tasks").doc(candidate.id).set(
      {
        resolutionStatus: "maybe_answered",
        linkedAiTaskId: answerDraft.draftId,
        resolutionHint: hint,
        resolutionLinkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    ),
    db.collection("ai_tasks").doc(answerDraft.draftId).set(
      {
        linkedAiTaskId: candidate.id,
        resolutionHint: hint,
        resolutionLinkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    )
  ]);

  return [
    {
      sourceDraftId: candidate.id,
      targetDraftId: answerDraft.draftId,
      hint
    }
  ];
}

async function loadRecentMessageContext(
  db: FirebaseFirestore.Firestore,
  groupId: string,
  currentMessageId: string
): Promise<AiMessageContextItem[]> {
  if (!groupId) return [];

  try {
    const snapshot = await db.collection("messages").where("groupId", "==", groupId).get();
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;

    return snapshot.docs
      .filter((doc) => doc.id !== currentMessageId)
      .map((doc) => {
        const data = doc.data();
        const timestamp = timestampToMillis(data.timestamp) || timestampToMillis(data.createdAt);

        return {
          senderName: String(data.senderName ?? ""),
          senderRole: normalizeSenderRole(String(data.senderRole ?? "unknown")),
          text: String(data.text ?? ""),
          timestamp
        };
      })
      .filter((message) => message.text.trim())
      .filter((message) => !message.timestamp || message.timestamp >= cutoff)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      .slice(-8);
  } catch {
    return [];
  }
}

async function writeWebhookLog(
  db: FirebaseFirestore.Firestore,
  event: LineWebhookEvent,
  result: Record<string, unknown>
) {
  try {
    await db.collection("webhook_logs").add({
      eventType: event.type ?? "",
      status: result.ok === false ? "error" : result.skipped ? "skipped" : "success",
      groupId: getEventGroupId(event),
      userId: event.source?.userId ?? "",
      projectId: String(result.projectId ?? ""),
      messageId: String(result.messageId ?? ""),
      lineMessageId: String(result.lineMessageId ?? event.message?.id ?? ""),
      messageType: event.message?.type ?? "",
      senderName: String(result.senderName ?? ""),
      senderRole: String(result.senderRole ?? ""),
      messageText: String(result.messageText ?? event.message?.text ?? "").slice(0, 500),
      aiTaskDrafts: Number(result.aiTaskDrafts ?? 0),
      adminNotifications: Number(result.adminNotifications ?? 0),
      adminNotificationFailures: Number(result.adminNotificationFailures ?? 0),
      reason: String(result.reason ?? result.aiSkippedReason ?? ""),
      errorMessage: String(result.errorMessage ?? ""),
      createdAt: FieldValue.serverTimestamp()
    });
  } catch {
    // Webhook logs are for diagnostics only; LINE processing should not fail because logging failed.
  }
}

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
}

function getAiSkippedReason(
  lineGroup: FirebaseFirestore.DocumentData | null,
  projectId: string,
  isAdminGroup: boolean
) {
  if (isAdminGroup) return "後台群組不建立 AI 草稿";
  if (!lineGroup) return "這個 LINE 群組尚未綁定案件";
  if (!projectId) return "這個 LINE 群組沒有選擇案件";

  return "沒有符合 AI 草稿條件";
}

function senderRoleLabel(role: LineSenderRole) {
  return {
    internal: "內部人員",
    client: "客戶",
    vendor: "廠商",
    unknown: "身份未登記"
  }[role];
}

function isPotentialAnswerDraft(suggestion: AiTaskSuggestion, senderRole: LineSenderRole) {
  if (senderRole === "client") return false;
  if (suggestion.taskType === "promise") return true;

  return (
    suggestion.taskType === "followup" &&
    /(承諾|待判斷|回覆|確認|提供|安排|給你|給您|傳給你|傳給您)/.test(
      `${suggestion.title}\n${suggestion.description}`
    )
  );
}

function timestampToMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  return 0;
}

async function findLineMember(
  db: FirebaseFirestore.Firestore,
  lineUserId: string,
  projectId: string
): Promise<{ displayName: string; role: LineSenderRole }> {
  const defaultRole: LineSenderRole = projectId ? "client" : "unknown";
  if (!lineUserId) return { displayName: "", role: defaultRole };

  const snapshot = await db.collection("line_members").where("lineUserId", "==", lineUserId).get();
  if (snapshot.empty) return { displayName: "", role: defaultRole };

  const members = snapshot.docs.map((doc) => doc.data());
  const matched =
    members.find((member) => String(member.projectId ?? "") === projectId) ??
    members.find((member) => !member.projectId) ??
    members[0];
  const role = normalizeSenderRole(String(matched.role ?? ""), defaultRole);

  return {
    displayName: String(matched.displayName ?? ""),
    role
  };
}

function normalizeSenderRole(role: string, fallback: LineSenderRole = "unknown"): LineSenderRole {
  if (role === "internal" || role === "client" || role === "vendor") return role;
  return fallback;
}

function normalizeMessageType(type: string): "text" | "image" | "audio" {
  if (type === "image" || type === "audio") return type;
  return "text";
}

function shouldReplyInLineChat(event: LineWebhookEvent, canAssistantReply: boolean) {
  return canAssistantReply && (event.source?.type === "group" || event.source?.type === "room");
}

async function saveLineMessageFile(event: LineWebhookEvent, groupId: string, messageType: "image" | "audio") {
  if (!event.message?.id) return "";

  try {
    const content = await downloadLineMessageContent(event.message.id);
    if (!content) return "";

    const bucket = getAdminStorageBucket();
    const extension = getFileExtension(content.contentType, messageType);
    const token = randomUUID();
    const storagePath = `line-messages/${sanitizePathSegment(groupId || "unknown")}/${event.message.id}.${extension}`;

    await bucket.file(storagePath).save(content.buffer, {
      metadata: {
        contentType: content.contentType,
        metadata: {
          firebaseStorageDownloadTokens: token
        }
      }
    });

    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  } catch {
    return "";
  }
}

function getFileExtension(contentType: string, messageType: "image" | "audio") {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("mp4")) return messageType === "audio" ? "m4a" : "mp4";
  if (contentType.includes("x-m4a")) return "m4a";
  if (contentType.includes("aac")) return "aac";

  return messageType === "image" ? "jpg" : "m4a";
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function taipeiDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function datePlusDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  parsed.setUTCDate(parsed.getUTCDate() + days);

  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
