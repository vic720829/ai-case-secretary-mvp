import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import type { AiTaskType, LineSenderRole } from "@/lib/types";
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
  verifyLineSignature,
  type LineWebhookEvent
} from "@/services/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRelationHint = {
  sourceDraftId: string;
  targetDraftId: string;
  hint: string;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid LINE signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events?: LineWebhookEvent[] };
  const events = body.events ?? [];
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
    return { skipped: true, reason: "Unsupported event" };
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
    const suggestions = shouldCreateAiDrafts
      ? await analyzeMessageForAiTasks(event.message.text, senderRole, { recentMessages })
      : [];

    const createdDraftIds = await Promise.all(
      suggestions.map(async (suggestion) => {
        const draftRef = await db.collection("ai_tasks").add({
          projectId,
          sourceMessageId: messageRef.id,
          sourceGroupId: groupId,
          sourceSenderName: senderName,
          sourceSenderRole: senderRole,
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
          createdAt: FieldValue.serverTimestamp()
        });

        return draftRef.id;
      })
    );
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
          relationHints
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
  const aiTaskSnapshot = await aiTaskRef.get();

  if (!aiTaskSnapshot.exists) {
    await replyLineText(event.replyToken, "找不到這筆 AI 草稿，可能已被刪除。");
    return { skipped: true, reason: "AI task draft not found", key };
  }

  const aiTask = aiTaskSnapshot.data() ?? {};
  const title = String(aiTask.title ?? "未命名草稿").trim() || "未命名草稿";
  const reviewStatus = String(aiTask.reviewStatus ?? "pending");

  if (reviewStatus !== "pending") {
    await replyLineText(event.replyToken, `這筆 AI 草稿已經審核過：${title}`);
    return { skipped: true, reason: "AI task draft already reviewed", key };
  }

  if (action === "reject_ai_task") {
    const batch = db.batch();
    batch.update(aiTaskRef, {
      reviewStatus: "rejected",
      reviewedBy,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedVia: "line",
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.set(
      db.collection("reminder_logs").doc(`ai_task_${key}_ai_task_pending_review`),
      {
        status: "confirmed",
        confirmedBy: reviewedBy,
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastAction: "rejected_ai_task_line"
      },
      { merge: true }
    );
    await batch.commit();
    await replyLineText(event.replyToken, `已拒絕 AI 草稿：${title}`);

    return { ok: true, action, key, senderName, messageText: `拒絕 AI 草稿：${title}` };
  }

  const taskInput = buildTaskFromAiDraft(aiTask);
  if (!taskInput.projectId || !taskInput.title) {
    const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
    await replyLineText(
      event.replyToken,
      [
        `這筆 AI 草稿不能直接在 LINE 通過：${title}`,
        "原因：缺少案件或標題。",
        reviewUrl ? `請到網站編輯：${reviewUrl}` : "請到網站 AI 審核頁補齊資料。"
      ].join("\n")
    );

    return { skipped: true, reason: "AI task draft requires website editing", key };
  }

  const taskRef = db.collection("tasks").doc();
  const batch = db.batch();
  batch.set(taskRef, {
    ...taskInput,
    source: "ai",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  batch.update(aiTaskRef, {
    status: taskInput.status,
    assignedTo: taskInput.assignee,
    reviewStatus: "approved",
    approvedTaskId: taskRef.id,
    reviewedBy,
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedVia: "line",
    updatedAt: FieldValue.serverTimestamp()
  });
  batch.set(
    db.collection("reminder_logs").doc(`ai_task_${key}_ai_task_pending_review`),
    {
      status: "confirmed",
      confirmedBy: reviewedBy,
      confirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastAction: "approved_ai_task_line"
    },
    { merge: true }
  );
  await batch.commit();
  await replyLineText(event.replyToken, `已通過並建立任務：${taskInput.title}`);

  return {
    ok: true,
    action,
    key,
    projectId: taskInput.projectId,
    senderName,
    messageText: `通過 AI 草稿並建立任務：${taskInput.title}`,
    approvedTaskId: taskRef.id
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
      `原訊息：${input.text}`,
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
      "AI案件秘書收到未處理的 LINE 訊息",
      `原因：${input.reason}`,
      `groupId：${input.groupId || "未提供"}`,
      `來源：${input.senderName || "LINE 使用者"}（${senderRoleLabel(input.senderRole)}）`,
      `原訊息：${input.text}`,
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

  return {
    title: String(aiTask.title ?? "").trim(),
    description: String(aiTask.description ?? "").trim(),
    projectId: String(aiTask.projectId ?? "").trim(),
    assignee: String(aiTask.assignedTo ?? "").trim(),
    dueDate: timestampToTaipeiInputDate(aiTask.dueDate),
    status: normalizeTaskStatus(String(aiTask.status ?? "")),
    source: "ai" as const,
    riskLevel: riskByAiTaskType[taskType]
  };
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
