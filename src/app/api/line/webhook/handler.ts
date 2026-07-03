import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import { canReviewAiDraft } from "@/lib/aiReviewPolicy";
import { canLineGroupUseAssistantReplies, canReplyInLineChat } from "@/lib/lineReplyPolicy";
import type { AiFeedbackAction, AiTaskType, LineMessageType, LineSenderRole, RiskLevel } from "@/lib/types";
import {
  analyzeMessageForAiTasks,
  dateStringToTimestamp,
  type AiMessageContextItem,
  type AiTaskSuggestion
} from "@/services/aiTasks";
import { answerQuestionFromFirestore, shouldAnswerLineQuestion } from "@/services/aiAssistant";
import { buildAiDraftReviewLineMessages } from "@/services/aiDraftReviewLineMessages";
import { buildLineAdminWelcomeText } from "@/services/lineAdminWelcome";
import { listAdminNotificationGroups, type AdminNotificationAudience } from "@/services/lineAdminGroups";
import { claimNotificationCooldown } from "@/services/notificationCooldown";
import { buildIncidentKey, getPrimaryIncidentType, maxRiskLevel } from "@/lib/incidentRules";
import {
  getAiDraftImmediateNotificationAudience,
  getMergedAiTaskImmediateNotificationAudience,
  shouldNotifyAiDraftsImmediately,
  shouldNotifyMergedAiTasksImmediately
} from "@/lib/lineNotificationPolicy";
import { getAiTaskRiskLevel } from "@/lib/riskRules";
import { transcribeAudioBuffer } from "@/services/audioTranscription";
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

type SavedLineFile = {
  fileUrl: string;
  errorMessage: string;
  buffer?: Buffer;
  contentType?: string;
  fileName?: string;
};

type AiTaskDraftCreateResult = {
  draftIds: string[];
  newDraftIds: string[];
  reusedDraftIds: string[];
  mergedItems: AiTaskMergedItem[];
};

type AiTaskMergedItem = {
  targetId: string;
  approvedTaskId: string;
  title: string;
  taskType: AiTaskType;
  duplicateCount: number;
  dedupeReason: string;
  targetStatus: "pending_draft" | "approved_task";
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
    const groupId = getEventGroupId(event);
    const lineGroupSnapshot = groupId
      ? await db.collection("line_groups").where("groupId", "==", groupId).limit(1).get()
      : null;
    const lineGroupDoc = lineGroupSnapshot && !lineGroupSnapshot.empty ? lineGroupSnapshot.docs[0] : null;
    const lineGroup = lineGroupDoc ? lineGroupDoc.data() : null;
    const isAdminGroup = lineGroup?.groupType === "admin";
    const canAssistantReply = canLineGroupUseAssistantReplies({
      groupType: String(lineGroup?.groupType ?? ""),
      allowAssistantReplies: lineGroup?.allowAssistantReplies
    });

    await syncLineGroupName(lineGroupDoc, event);

    if (event.type === "join" && canAssistantReply) {
      await syncLinePendingGroup(db, lineGroupDoc, event);
      const replyResult = await replyLineText(event.replyToken, buildLineAdminWelcomeText());

      return {
        ok: true,
        reason: "Admin LINE group welcome sent",
        groupId,
        groupName: String(lineGroup?.groupName ?? ""),
        assistantReply: "admin_welcome",
        assistantReplyError: replyResult.ok ? "" : replyResult.errorMessage
      };
    }

    if (lineGroupDoc) {
      await syncLinePendingGroup(db, lineGroupDoc, event);

      return {
        ok: true,
        reason: isAdminGroup ? "Known admin LINE group event" : "Known project LINE group event",
        groupId,
        groupName: String(lineGroup?.groupName ?? ""),
        assistantReply: "",
        assistantReplyError: ""
      };
    }

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
  const savedFile =
    messageType === "text" ? { fileUrl: "", errorMessage: "" } : await saveLineMessageFile(event, groupId, messageType);
  const fileUrl = savedFile.fileUrl;
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
    ...(savedFile.errorMessage ? { fileSaveError: savedFile.errorMessage } : {}),
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
    const incidentId = shouldCreateAiDrafts
      ? await upsertLineIncident(db, {
          projectId,
          groupId,
          messageId: messageRef.id,
          lineMessageId,
          messageType,
          messageText: event.message.text,
          messageTimestamp: event.timestamp ? Timestamp.fromMillis(event.timestamp) : null,
          senderName,
          senderRole,
          contextText: getLatestCustomerContextText(recentMessages),
          suggestions
        })
      : "";

    const pendingImageDraft = nearbyAttachments.length
      ? await findPendingImageDraftForAttachments(db, {
          projectId,
          groupId,
          senderId: event.source?.userId ?? "",
          attachmentMessageIds: nearbyAttachments.map((attachment) => attachment.messageId)
        })
      : null;
    const draftResult = await createAiTaskDrafts(db, {
      projectId,
      groupId,
      sourceMessageId: messageRef.id,
      sourceSenderId: event.source?.userId ?? "",
      senderName,
      senderRole,
      suggestions,
      attachments: nearbyAttachments,
      incidentId,
      reusableDraftId: pendingImageDraft?.id ?? ""
    });
    const createdDraftIds = draftResult.draftIds;
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
    const shouldNotifyAiDraft = shouldNotifyAiDrafts(draftResult, suggestions, pendingImageDraft?.data);
    const adminNotification = shouldNotifyAiDraft
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
    if (adminNotification.sent > 0) {
      await markAiDraftsAdminNotified(db, createdDraftIds);
    }
    const mergedNotification = shouldNotifyMergedAiTasksImmediately(draftResult.mergedItems)
      ? await notifyAdminGroupsAboutMergedAiTasks(db, {
          projectId,
          senderName,
          senderRole,
          text: event.message.text,
          mergedItems: draftResult.mergedItems
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

    const canReplyInChat = canReplyInLineChat({
      groupType: String(lineGroup?.groupType ?? ""),
      allowAssistantReplies: lineGroup?.allowAssistantReplies,
      sourceType: event.source?.type
    });
    const didReplyHelp = canReplyInChat && isLineAssistantHelpCommand(event.message.text);
    const didReplyQuestion = !didReplyHelp && canReplyInChat && shouldAnswerLineQuestion(event.message.text);
    let assistantReplyError = "";

    if (didReplyHelp) {
      const replyResult = await replyLineText(event.replyToken, buildLineAdminHelpText());
      assistantReplyError = replyResult.ok ? "" : replyResult.errorMessage;
    } else if (didReplyQuestion) {
      try {
        const answer = await answerQuestionFromFirestore(event.message.text, projectId);
        const replyResult = await replyLineText(event.replyToken, answer);
        assistantReplyError = replyResult.ok ? "" : replyResult.errorMessage;
      } catch (caught) {
        assistantReplyError = caught instanceof Error ? caught.message : "Unknown LINE assistant reply error";
      }
    }

    await messageRef.update({ isProcessed: true });

    return {
      messageId: messageRef.id,
      lineMessageId,
      aiTaskDrafts: suggestions.length,
      adminNotifications: adminNotification.sent + unboundNotification.sent + mergedNotification.sent,
      adminNotificationFailures: adminNotification.failed + unboundNotification.failed + mergedNotification.failed,
      aiDraftsMerged: draftResult.mergedItems.length,
      aiDraftMergedNotifications: mergedNotification.sent,
      aiDraftRelations: relationHints.length,
      projectId,
      senderName,
      senderRole,
      messageText: event.message.text,
      assistantReply: didReplyHelp ? "help" : didReplyQuestion ? "answer" : "",
      assistantReplyError,
      fileUrlSaved: Boolean(fileUrl),
      fileSaveError: savedFile.errorMessage,
      aiSkippedReason: shouldCreateAiDrafts ? "" : getAiSkippedReason(lineGroup, projectId, isAdminGroup)
    };
  }

  if (messageType === "audio") {
    const shouldCreateAiDrafts = Boolean(lineGroup && !isAdminGroup && projectId);
    const currentTimestamp = event.timestamp ? Timestamp.fromMillis(event.timestamp) : null;
    let transcript = "";
    let audioTranscriptionError = "";

    if (savedFile.buffer && savedFile.contentType) {
      try {
        transcript = await transcribeAudioBuffer({
          fileName: savedFile.fileName || `${lineMessageId || messageRef.id}.m4a`,
          contentType: savedFile.contentType,
          buffer: savedFile.buffer
        });
      } catch (caught) {
        audioTranscriptionError = caught instanceof Error ? caught.message : "Unknown audio transcription error";
      }
    } else {
      audioTranscriptionError = savedFile.errorMessage || "LINE audio content was not available for transcription.";
    }

    if (transcript || audioTranscriptionError) {
      await messageRef.update({
        ...(transcript
          ? {
              text: transcript,
              audioTranscript: transcript,
              audioTranscribedAt: FieldValue.serverTimestamp()
            }
          : {}),
        ...(audioTranscriptionError ? { audioTranscriptionError } : {})
      });
    }

    const audioAttachment =
      fileUrl && transcript
        ? buildLineAttachment({
            messageId: messageRef.id,
            fileUrl,
            fileType: messageType,
            senderName,
            senderRole,
            text: transcript,
            createdAt: currentTimestamp
          })
        : null;
    const recentMessages = shouldCreateAiDrafts && transcript ? await loadRecentMessageContext(db, groupId, messageRef.id) : [];
    const suggestions =
      shouldCreateAiDrafts && transcript ? await analyzeMessageForAiTasks(transcript, senderRole, { recentMessages }) : [];
    const incidentId =
      shouldCreateAiDrafts && transcript
        ? await upsertLineIncident(db, {
            projectId,
            groupId,
            messageId: messageRef.id,
            lineMessageId,
            messageType,
            messageText: transcript,
            messageTimestamp: currentTimestamp,
            senderName,
            senderRole,
            contextText: getLatestCustomerContextText(recentMessages),
            suggestions,
            attachmentMessageIds: audioAttachment ? [audioAttachment.messageId] : []
          })
        : "";
    const draftResult = await createAiTaskDrafts(db, {
      projectId,
      groupId,
      sourceMessageId: messageRef.id,
      sourceSenderId: event.source?.userId ?? "",
      senderName,
      senderRole,
      suggestions,
      attachments: audioAttachment ? [audioAttachment] : [],
      incidentId
    });
    const createdDraftIds = draftResult.draftIds;
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
    const shouldNotifyAiDraft = shouldNotifyAiDrafts(draftResult, suggestions);
    const adminNotification = shouldNotifyAiDraft
      ? await notifyAdminGroupsAboutAiDrafts(db, {
          projectId,
          senderName,
          senderRole,
          text: transcript,
          suggestions,
          createdDraftIds,
          relationHints,
          attachmentCount: audioAttachment ? 1 : 0
        })
      : { sent: 0, failed: 0, groups: 0 };
    if (adminNotification.sent > 0) {
      await markAiDraftsAdminNotified(db, createdDraftIds);
    }
    const mergedNotification = shouldNotifyMergedAiTasksImmediately(draftResult.mergedItems)
      ? await notifyAdminGroupsAboutMergedAiTasks(db, {
          projectId,
          senderName,
          senderRole,
          text: transcript,
          mergedItems: draftResult.mergedItems
        })
      : { sent: 0, failed: 0, groups: 0 };
    const unboundNotification = !shouldCreateAiDrafts && !isAdminGroup && transcript
      ? await notifyAdminGroupsAboutUnboundLineMessage(db, {
          groupId,
          senderName,
          senderRole,
          text: transcript,
          reason: getAiSkippedReason(lineGroup, projectId, isAdminGroup)
        })
      : { sent: 0, failed: 0, groups: 0 };

    const canReplyInChat = canReplyInLineChat({
      groupType: String(lineGroup?.groupType ?? ""),
      allowAssistantReplies: lineGroup?.allowAssistantReplies,
      sourceType: event.source?.type
    });
    const didReplyQuestion = Boolean(transcript && canReplyInChat && shouldAnswerLineQuestion(transcript));
    let assistantReplyError = "";

    if (didReplyQuestion) {
      try {
        const answer = await answerQuestionFromFirestore(transcript, projectId);
        const replyResult = await replyLineText(event.replyToken, answer);
        assistantReplyError = replyResult.ok ? "" : replyResult.errorMessage;
      } catch (caught) {
        assistantReplyError = caught instanceof Error ? caught.message : "Unknown LINE assistant reply error";
      }
    }

    if (shouldCreateAiDrafts && transcript) {
      await messageRef.update({ isProcessed: true });
    }

    return {
      messageId: messageRef.id,
      lineMessageId,
      aiTaskDrafts: suggestions.length,
      adminNotifications: adminNotification.sent + unboundNotification.sent + mergedNotification.sent,
      adminNotificationFailures: adminNotification.failed + unboundNotification.failed + mergedNotification.failed,
      aiDraftsMerged: draftResult.mergedItems.length,
      aiDraftMergedNotifications: mergedNotification.sent,
      aiDraftRelations: relationHints.length,
      projectId,
      senderName,
      senderRole,
      messageText: transcript,
      audioTranscribed: Boolean(transcript),
      audioTranscriptionError,
      assistantReply: didReplyQuestion ? "answer" : "",
      assistantReplyError,
      fileUrlSaved: Boolean(fileUrl),
      fileSaveError: savedFile.errorMessage,
      aiSkippedReason: shouldCreateAiDrafts ? "" : getAiSkippedReason(lineGroup, projectId, isAdminGroup)
    };
  }

  if (messageType === "image" && fileUrl) {
    const shouldCreateAiDrafts = Boolean(lineGroup && !isAdminGroup && projectId);
    const currentTimestamp = event.timestamp ? Timestamp.fromMillis(event.timestamp) : null;
    const nearbyText = shouldCreateAiDrafts
      ? await loadRecentTextForImage(db, {
          groupId,
          projectId,
          senderId: event.source?.userId ?? "",
          currentMessageId: messageRef.id,
          currentTimestamp
        })
      : "";
    const attachment = buildLineAttachment({
      messageId: messageRef.id,
      fileUrl,
      fileType: messageType,
      senderName,
      senderRole,
      text: nearbyText,
      createdAt: currentTimestamp
    });
    const recentAttachments = shouldCreateAiDrafts
      ? await loadRecentImageAttachments(db, {
          groupId,
          projectId,
          senderId: event.source?.userId ?? "",
          currentMessageId: messageRef.id,
          currentTimestamp,
          windowMinutes: 5
        })
      : [];
    const attachments = uniqueLineAttachments([...recentAttachments, attachment]);
    const pendingImageDraft = shouldCreateAiDrafts
      ? await findPendingImageDraftForAttachments(db, {
          projectId,
          groupId,
          senderId: event.source?.userId ?? "",
          attachmentMessageIds: attachments.map((item) => item.messageId)
        })
      : null;
    const baseSuggestions =
      shouldCreateAiDrafts && nearbyText
        ? await analyzeMessageForAiTasks(nearbyText, senderRole, { recentMessages: [] })
        : [];
    const suggestions = shouldCreateAiDrafts
      ? baseSuggestions.length
        ? baseSuggestions
        : [buildImageReviewSuggestion(nearbyText, attachments.length)]
      : [];
    const incidentId = shouldCreateAiDrafts
      ? await upsertLineIncident(db, {
          projectId,
          groupId,
          messageId: messageRef.id,
          lineMessageId,
          messageType,
          messageText: nearbyText || "圖片訊息",
          messageTimestamp: currentTimestamp,
          senderName,
          senderRole,
          suggestions,
          attachmentMessageIds: attachments.map((item) => item.messageId)
        })
      : "";
    const draftResult = await createAiTaskDrafts(db, {
      projectId,
      groupId,
      sourceMessageId: messageRef.id,
      sourceSenderId: event.source?.userId ?? "",
      senderName,
      senderRole,
      suggestions,
      attachments,
      incidentId,
      reusableDraftId: pendingImageDraft?.id ?? ""
    });
    const createdDraftIds = draftResult.draftIds;
    const shouldNotifyAiDraft = shouldNotifyAiDrafts(draftResult, suggestions, pendingImageDraft?.data);
    const adminNotification = shouldNotifyAiDraft
      ? await notifyAdminGroupsAboutAiDrafts(db, {
          projectId,
          senderName,
          senderRole,
          text: nearbyText || "客戶傳送圖片，尚未提供文字說明。",
          suggestions,
          createdDraftIds,
          relationHints: [],
          attachmentCount: attachments.length
        })
      : { sent: 0, failed: 0, groups: 0 };
    if (adminNotification.sent > 0) {
      await markAiDraftsAdminNotified(db, createdDraftIds);
    }
    const mergedNotification = shouldNotifyMergedAiTasksImmediately(draftResult.mergedItems)
      ? await notifyAdminGroupsAboutMergedAiTasks(db, {
          projectId,
          senderName,
          senderRole,
          text: nearbyText || "圖片訊息",
          mergedItems: draftResult.mergedItems
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
      adminNotifications: adminNotification.sent + unboundNotification.sent + mergedNotification.sent,
      adminNotificationFailures: adminNotification.failed + unboundNotification.failed + mergedNotification.failed,
      aiDraftsMerged: draftResult.mergedItems.length,
      aiDraftMergedNotifications: mergedNotification.sent,
      projectId,
      senderName,
      senderRole,
      messageText: nearbyText,
      aiDraftMerged: Boolean(pendingImageDraft),
      attachmentCount: attachments.length,
      fileUrlSaved: Boolean(fileUrl),
      fileSaveError: savedFile.errorMessage
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

  const supportedActions = [
    "approve_ai_task",
    "reject_ai_task",
    "resolve_ai_followup",
    "snooze_ai_followup",
    "confirm_reminder",
    "snooze_reminder",
    "keep_reminder"
  ];
  if (!supportedActions.includes(action)) {
    return { skipped: true, reason: "Unsupported postback" };
  }

  const isAdminGroup = await isAssistantAdminGroup(db, getEventGroupId(event));
  if (!isAdminGroup) {
    return { skipped: true, reason: "Postback outside admin LINE group", action, key };
  }

  if (["approve_ai_task", "reject_ai_task"].includes(action)) {
    return handleAiTaskReviewPostback(db, event, action, key);
  }

  if (["resolve_ai_followup", "snooze_ai_followup"].includes(action)) {
    return handleAiFollowupPostback(db, event, action, key, params);
  }

  const senderName = await getLineSenderName(event);
  const reminderRef = db.collection("reminder_logs").doc(key);
  const result = await db.runTransaction(async (transaction) => {
    const reminderSnapshot = await transaction.get(reminderRef);

    if (!reminderSnapshot.exists) {
      return { status: "not_found" as const };
    }

    const reminder = reminderSnapshot.data() ?? {};
    const title = String(reminder.title ?? "未命名提醒");
    const confirmedBy = String(reminder.confirmedBy ?? reminder.actionBy ?? "");

    if (reminder.status === "confirmed") {
      return { status: "already_confirmed" as const, title, confirmedBy };
    }

    if (action === "confirm_reminder") {
      transaction.set(
        reminderRef,
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

      return { status: "confirmed" as const, title };
    }

    if (action === "snooze_reminder") {
      const days = clampNumber(Number(params.get("days") ?? 1), 1, 14);
      const snoozedUntil = datePlusDays(taipeiDateString(), days);

      transaction.set(
        reminderRef,
        {
          status: "pending",
          snoozedUntil,
          lastAction: "snoozed",
          actionBy: senderName,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return { status: "snoozed" as const, title, snoozedUntil };
    }

    transaction.set(
      reminderRef,
      {
        status: "pending",
        snoozedUntil: FieldValue.delete(),
        lastAction: "kept_pending",
        actionBy: senderName,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { status: "kept_pending" as const, title };
  });

  if (result.status === "not_found") {
    await replyLineText(event.replyToken, "找不到這筆提醒，可能已被刪除或重新建立。");
    return { skipped: true, reason: "Reminder not found", key };
  }

  if (result.status === "already_confirmed") {
    const actor = result.confirmedBy || "其他人";
    await replyLineText(event.replyToken, `這筆提醒已由 ${actor} 確認：${result.title}\n後續按鈕不會覆蓋已確認結果。`);
    return { skipped: true, reason: "Reminder already confirmed", key, actionBy: senderName, messageText: result.title };
  }

  if (result.status === "confirmed") {
    await safeRecordAiFeedbackEvent(db, {
      action: "confirm_reminder",
      targetType: "reminder",
      targetId: key,
      targetTitle: result.title,
      actorName: senderName,
      note: "LINE 後台確認提醒"
    });
    await replyLineText(event.replyToken, `已確認：${result.title}\n其他後台群再按按鈕不會覆蓋這次結果。`);
    return { ok: true, action, key, actionBy: senderName, messageText: result.title };
  }

  if (result.status === "snoozed") {
    await safeRecordAiFeedbackEvent(db, {
      action: "snooze_reminder",
      targetType: "reminder",
      targetId: key,
      targetTitle: result.title,
      actorName: senderName,
      note: `LINE 後台延後提醒到 ${result.snoozedUntil}`
    });
    await replyLineText(event.replyToken, `已延後提醒：${result.title}\n下次提醒日：${result.snoozedUntil.replaceAll("-", "/")}`);
    return { ok: true, action, key, actionBy: senderName, snoozedUntil: result.snoozedUntil, messageText: result.title };
  }

  await safeRecordAiFeedbackEvent(db, {
    action: "keep_reminder",
    targetType: "reminder",
    targetId: key,
    targetTitle: result.title,
    actorName: senderName,
    note: "LINE 後台保留待處理"
  });
  await replyLineText(event.replyToken, `已保留待處理：${result.title}`);

  return { ok: true, action, key, actionBy: senderName, messageText: result.title };
}

async function safeRecordAiFeedbackEvent(
  db: FirebaseFirestore.Firestore,
  input: {
    action: AiFeedbackAction;
    targetType: "ai_task" | "reminder" | "task";
    targetId: string;
    targetTitle: string;
    projectId?: string;
    actorName: string;
    note: string;
  }
) {
  try {
    await db.collection("ai_feedback_events").add({
      source: "line",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetTitle: input.targetTitle,
      projectId: input.projectId ?? "",
      actorId: input.actorName,
      actorName: input.actorName,
      actorRole: "line_admin",
      changes: [],
      note: input.note,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch {
    // Learning logs must not block LINE postback actions.
  }
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
    return { skipped: true, reason: "AI followup outside admin LINE group", key };
  }

  const senderName = await getLineSenderName(event);
  const actionBy = `LINE:${senderName}`;
  const aiTaskRef = db.collection("ai_tasks").doc(key);
  const reminderRef = db.collection("reminder_logs").doc(`ai_task_${key}_customer_followup_unanswered`);

  if (action === "snooze_ai_followup") {
    const days = clampNumber(Number(params.get("days") ?? 1), 1, 14);
    const snoozedUntil = datePlusDays(taipeiDateString(), days);

    const result = await db.runTransaction(async (transaction) => {
      const reminderSnapshot = await transaction.get(reminderRef);
      const reminder = reminderSnapshot.data() ?? {};
      const title = String(reminder.title ?? "客戶回覆追蹤");
      const confirmedBy = String(reminder.confirmedBy ?? reminder.actionBy ?? "");

      if (reminderSnapshot.exists && reminder.status === "confirmed") {
        return { status: "already_confirmed" as const, title, confirmedBy };
      }

      transaction.set(
        reminderRef,
        {
          status: "pending",
          snoozedUntil,
          lastAction: "snoozed_customer_followup",
          actionBy,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return { status: "snoozed" as const, title };
    });

    if (result.status === "already_confirmed") {
      const actor = result.confirmedBy || "其他人";
      await replyLineText(event.replyToken, `這筆客戶追蹤已由 ${actor} 確認：${result.title}\n後續按鈕不會覆蓋已確認結果。`);
      return { skipped: true, reason: "AI followup already confirmed", key, senderName, messageText: result.title };
    }

    await safeRecordAiFeedbackEvent(db, {
      action: "snooze_ai_followup",
      targetType: "ai_task",
      targetId: key,
      targetTitle: result.title,
      actorName: senderName,
      note: `LINE 後台設定明天追蹤，下一次 ${snoozedUntil}`
    });
    await replyLineText(event.replyToken, `已設定明天追蹤。\n下次提醒日：${snoozedUntil.replaceAll("-", "/")}`);

    return { ok: true, action, key, senderName, messageText: "明天追蹤客戶回覆" };
  }

  const result = await db.runTransaction(async (transaction) => {
    const aiTaskSnapshot = await transaction.get(aiTaskRef);
    if (!aiTaskSnapshot.exists) return { status: "not_found" as const };
    const reminderSnapshot = await transaction.get(reminderRef);

    const aiTask = aiTaskSnapshot.data() ?? {};
    const title = String(aiTask.title ?? "未命名追蹤").trim() || "未命名追蹤";
    const reminder = reminderSnapshot.data() ?? {};
    const confirmedBy = String(reminder.confirmedBy ?? reminder.actionBy ?? "");
    const reviewStatus = String(aiTask.reviewStatus ?? "pending");
    const status = String(aiTask.status ?? "todo");

    if (reminderSnapshot.exists && reminder.status === "confirmed") {
      return { status: "already_confirmed" as const, title, confirmedBy };
    }

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

  if (result.status === "already_confirmed") {
    const actor = result.confirmedBy || "其他人";
    await replyLineText(event.replyToken, `這筆客戶追蹤已由 ${actor} 確認：${result.title}\n後續按鈕不會覆蓋已確認結果。`);
    return { skipped: true, reason: "AI followup already confirmed", key, senderName, messageText: result.title };
  }

  await safeRecordAiFeedbackEvent(db, {
    action: "resolve_ai_followup",
    targetType: "ai_task",
    targetId: key,
    targetTitle: result.title,
    actorName: senderName,
    note: "LINE 後台標記客戶追蹤已回覆"
  });
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

    if (!canReviewAiDraft(reviewStatus)) {
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

      return { status: "rejected" as const, title, projectId: String(aiTask.projectId ?? "") };
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
    if (taskInput.incidentId) {
      transaction.set(
        db.collection("incidents").doc(taskInput.incidentId),
        {
          aiTaskIds: FieldValue.arrayUnion(key),
          taskIds: FieldValue.arrayUnion(taskRef.id),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

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
    await safeRecordAiFeedbackEvent(db, {
      action: "reject_ai_task",
      targetType: "ai_task",
      targetId: key,
      targetTitle: result.title,
      projectId: result.projectId,
      actorName: senderName,
      note: "LINE 後台拒絕 AI 草稿"
    });
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

  await safeRecordAiFeedbackEvent(db, {
    action: "approve_ai_task",
    targetType: "ai_task",
    targetId: key,
    targetTitle: result.title,
    projectId: result.projectId,
    actorName: senderName,
    note: `LINE 後台通過 AI 草稿並建立待辦 ${result.approvedTaskId}`
  });
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

async function upsertLineIncident(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    groupId: string;
    messageId: string;
    lineMessageId: string;
    messageType: LineMessageType;
    messageText: string;
    messageTimestamp: Timestamp | null;
    senderName: string;
    senderRole: LineSenderRole;
    contextText?: string;
    suggestions: AiTaskSuggestion[];
    attachmentMessageIds?: string[];
  }
) {
  const incidentType = getPrimaryIncidentType(input.suggestions.map((suggestion) => suggestion.taskType));
  const firstSuggestion = input.suggestions[0];
  const title = shortText(firstSuggestion?.title || input.messageText || "LINE 訊息待確認", 80);
  const summary = shortText(firstSuggestion?.description || input.messageText || title, 300);
  const groupingText = getIncidentGroupingText(input);
  const riskLevel = maxRiskLevel(
    input.suggestions.map((suggestion) => getAiTaskRiskLevel(suggestion.taskType, suggestion.title)),
    "low"
  );
  const incidentKey = buildIncidentKey({
    projectId: input.projectId,
    groupId: input.groupId,
    incidentType,
    title,
    text: groupingText
  });
  const incidentId = incidentDocumentIdFromKey(incidentKey);
  const incidentRef = db.collection("incidents").doc(incidentId);
  const incidentSnapshot = await incidentRef.get();
  const existing = incidentSnapshot.exists ? incidentSnapshot.data() ?? {} : {};
  const existingRiskLevel = normalizeRiskLevel(String(existing.riskLevel ?? ""), "low");
  const nextRiskLevel = maxRiskLevel([existingRiskLevel, riskLevel], "low");
  const messageTime = input.messageTimestamp ?? FieldValue.serverTimestamp();
  const payload: FirebaseFirestore.DocumentData = {
    incidentKey,
    projectId: input.projectId,
    groupId: input.groupId,
    title: String(existing.title ?? "") || title,
    summary,
    incidentType,
    riskLevel: nextRiskLevel,
    status: existing.status === "resolved" || existing.status === "ignored" ? existing.status : "open",
    source: "line",
    sourceMessageIds: FieldValue.arrayUnion(input.messageId),
    messageTypes: FieldValue.arrayUnion(input.messageType),
    lastMessageAt: messageTime,
    lastSenderName: input.senderName,
    lastSenderRole: input.senderRole,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (!incidentSnapshot.exists) {
    payload.aiTaskIds = [];
    payload.taskIds = [];
    payload.firstMessageAt = messageTime;
    payload.createdAt = FieldValue.serverTimestamp();
  }

  if (input.lineMessageId) {
    payload.lineMessageIds = FieldValue.arrayUnion(input.lineMessageId);
  }

  if (input.attachmentMessageIds?.length) {
    payload.attachmentMessageIds = FieldValue.arrayUnion(...input.attachmentMessageIds);
  }

  await incidentRef.set(payload, { merge: true });
  await db.collection("messages").doc(input.messageId).set(
    {
      incidentId,
      incidentKey,
      incidentLinkedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return incidentId;
}

async function appendAiDraftsToIncident(db: FirebaseFirestore.Firestore, incidentId: string, draftIds: string[]) {
  const uniqueDraftIds = [...new Set(draftIds.filter(Boolean))];
  if (!incidentId || !uniqueDraftIds.length) return;

  await db.collection("incidents").doc(incidentId).set(
    {
      aiTaskIds: FieldValue.arrayUnion(...uniqueDraftIds),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

function incidentDocumentIdFromKey(incidentKey: string) {
  return createHash("sha256").update(incidentKey).digest("hex");
}

function normalizeRiskLevel(value: string, fallback: RiskLevel): RiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : fallback;
}

function getIncidentGroupingText(input: {
  messageText: string;
  contextText?: string;
  senderRole: LineSenderRole;
  suggestions: AiTaskSuggestion[];
}) {
  const shouldUseContext =
    input.senderRole !== "client" &&
    Boolean(input.contextText?.trim()) &&
    input.suggestions.some((suggestion) => ["promise", "followup", "schedule", "file"].includes(suggestion.taskType));

  return shouldUseContext ? `${input.contextText}\n${input.messageText}` : input.messageText;
}

function getLatestCustomerContextText(messages: AiMessageContextItem[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.senderRole === "client" || message.senderRole === "unknown")
      ?.text.trim() ?? ""
  );
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
    incidentId?: string;
    reusableDraftId?: string;
  }
) {
  const attachmentMessageIds = input.attachments.map((attachment) => attachment.messageId);
  const result: AiTaskDraftCreateResult = {
    draftIds: [],
    newDraftIds: [],
    reusedDraftIds: [],
    mergedItems: []
  };

  for (const [index, suggestion] of input.suggestions.entries()) {
    const reusableDraft =
      index === 0 && input.reusableDraftId
        ? { id: input.reusableDraftId, data: null as FirebaseFirestore.DocumentData | null, reason: "image_attachment" }
        : await findReusableIncidentAiDraft(db, {
            incidentId: input.incidentId ?? "",
            currentSourceMessageId: input.sourceMessageId,
            taskType: suggestion.taskType,
            excludedDraftIds: result.draftIds
          });
    const payload = {
      projectId: input.projectId,
      incidentId: input.incidentId ?? "",
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

    if (reusableDraft) {
      const mergedItem = await mergeAiTaskDraft(db, reusableDraft, payload, input.sourceMessageId, attachmentMessageIds);
      result.draftIds.push(reusableDraft.id);
      result.reusedDraftIds.push(reusableDraft.id);
      if (mergedItem) result.mergedItems.push(mergedItem);
      continue;
    }

    const existingApprovedTask = await findExistingApprovedIncidentAiTask(db, {
      incidentId: input.incidentId ?? "",
      currentSourceMessageId: input.sourceMessageId,
      taskType: suggestion.taskType
    });

    if (existingApprovedTask) {
      const mergedItem = await markDuplicateOnExistingAiTask(
        db,
        existingApprovedTask,
        payload,
        input.sourceMessageId,
        attachmentMessageIds
      );
      result.draftIds.push("");
      result.reusedDraftIds.push(existingApprovedTask.id);
      if (mergedItem) result.mergedItems.push(mergedItem);
      continue;
    }

    const draftRef = await db.collection("ai_tasks").add({
      ...payload,
      createdAt: FieldValue.serverTimestamp()
    });
    result.draftIds.push(draftRef.id);
    result.newDraftIds.push(draftRef.id);
  }

  if (input.incidentId && result.draftIds.length) {
    await appendAiDraftsToIncident(db, input.incidentId, result.draftIds);
  }

  return result;
}

async function findReusableIncidentAiDraft(
  db: FirebaseFirestore.Firestore,
  input: {
    incidentId: string;
    currentSourceMessageId: string;
    taskType: AiTaskType;
    excludedDraftIds: string[];
  }
) {
  if (!input.incidentId) return null;

  const snapshot = await db.collection("ai_tasks").where("incidentId", "==", input.incidentId).get();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const excludedDraftIds = new Set(input.excludedDraftIds);
  const candidate = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => !excludedDraftIds.has(item.id))
    .filter((item) => String(item.data.sourceMessageId ?? "") !== input.currentSourceMessageId)
    .filter((item) => String(item.data.taskType ?? "") === input.taskType)
    .filter((item) => String(item.data.reviewStatus ?? "pending") === "pending")
    .filter((item) => !String(item.data.approvedTaskId ?? ""))
    .filter((item) => timestampToMillis(item.data.createdAt) >= cutoff || timestampToMillis(item.data.updatedAt) >= cutoff)
    .sort((a, b) => timestampToMillis(b.data.updatedAt || b.data.createdAt) - timestampToMillis(a.data.updatedAt || a.data.createdAt))[0];

  return candidate ? { ...candidate, reason: "same_incident_pending_draft" } : null;
}

async function findExistingApprovedIncidentAiTask(
  db: FirebaseFirestore.Firestore,
  input: {
    incidentId: string;
    currentSourceMessageId: string;
    taskType: AiTaskType;
  }
) {
  if (!input.incidentId) return null;

  const snapshot = await db.collection("ai_tasks").where("incidentId", "==", input.incidentId).get();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const candidate = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => String(item.data.sourceMessageId ?? "") !== input.currentSourceMessageId)
    .filter((item) => String(item.data.taskType ?? "") === input.taskType)
    .filter((item) => String(item.data.reviewStatus ?? "pending") === "approved")
    .filter((item) => Boolean(String(item.data.approvedTaskId ?? "")))
    .filter((item) => String(item.data.status ?? "todo") !== "done")
    .filter((item) => timestampToMillis(item.data.createdAt) >= cutoff || timestampToMillis(item.data.updatedAt) >= cutoff)
    .sort((a, b) => timestampToMillis(b.data.updatedAt || b.data.createdAt) - timestampToMillis(a.data.updatedAt || a.data.createdAt))[0];

  return candidate ? { ...candidate, reason: "same_incident_approved_task" } : null;
}

async function mergeAiTaskDraft(
  db: FirebaseFirestore.Firestore,
  reusableDraft: {
    id: string;
    data: FirebaseFirestore.DocumentData | null;
    reason: string;
  },
  payload: FirebaseFirestore.DocumentData,
  sourceMessageId: string,
  attachmentMessageIds: string[]
) {
  const updatePayload: FirebaseFirestore.DocumentData =
    reusableDraft.reason === "image_attachment"
      ? payload
      : {
          incidentId: payload.incidentId,
          projectId: payload.projectId,
          sourceGroupId: payload.sourceGroupId,
          sourceSenderId: payload.sourceSenderId,
          sourceSenderName: payload.sourceSenderName,
          sourceSenderRole: payload.sourceSenderRole,
          title: payload.title,
          description: payload.description,
          taskType: payload.taskType,
          status: payload.status,
          assignedTo: payload.assignedTo,
          dueDate: payload.dueDate,
          latestSourceMessageId: sourceMessageId,
          duplicateSourceMessageIds: FieldValue.arrayUnion(sourceMessageId),
          duplicateCount: FieldValue.increment(1),
          dedupeReason: reusableDraft.reason,
          updatedAt: FieldValue.serverTimestamp()
        };

  if (reusableDraft.reason !== "image_attachment" && attachmentMessageIds.length) {
    updatePayload.attachmentMessageIds = FieldValue.arrayUnion(...attachmentMessageIds);
    updatePayload.attachmentCount = FieldValue.increment(attachmentMessageIds.length);
  }

  await db.collection("ai_tasks").doc(reusableDraft.id).set(updatePayload, { merge: true });

  if (reusableDraft.reason === "image_attachment") return null;

  return buildMergedAiTaskItem({
    id: reusableDraft.id,
    data: reusableDraft.data,
    fallback: payload,
    reason: reusableDraft.reason,
    targetStatus: "pending_draft"
  });
}

async function markDuplicateOnExistingAiTask(
  db: FirebaseFirestore.Firestore,
  existingTask: {
    id: string;
    data: FirebaseFirestore.DocumentData;
    reason: string;
  },
  payload: FirebaseFirestore.DocumentData,
  sourceMessageId: string,
  attachmentMessageIds: string[]
) {
  const updatePayload: FirebaseFirestore.DocumentData = {
    latestSourceMessageId: sourceMessageId,
    duplicateSourceMessageIds: FieldValue.arrayUnion(sourceMessageId),
    duplicateCount: FieldValue.increment(1),
    dedupeReason: existingTask.reason,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (attachmentMessageIds.length) {
    updatePayload.attachmentMessageIds = FieldValue.arrayUnion(...attachmentMessageIds);
    updatePayload.attachmentCount = FieldValue.increment(attachmentMessageIds.length);
  }

  if (payload.incidentId) updatePayload.incidentId = payload.incidentId;
  if (payload.projectId) updatePayload.projectId = payload.projectId;

  await db.collection("ai_tasks").doc(existingTask.id).set(updatePayload, { merge: true });

  return buildMergedAiTaskItem({
    id: existingTask.id,
    data: existingTask.data,
    fallback: payload,
    reason: existingTask.reason,
    targetStatus: "approved_task"
  });
}

function buildMergedAiTaskItem(input: {
  id: string;
  data: FirebaseFirestore.DocumentData | null;
  fallback: FirebaseFirestore.DocumentData;
  reason: string;
  targetStatus: "pending_draft" | "approved_task";
}): AiTaskMergedItem {
  const data = input.data ?? {};
  const currentDuplicateCount = Number(data.duplicateCount ?? 0);

  return {
    targetId: input.id,
    approvedTaskId: String(data.approvedTaskId ?? ""),
    title: String(data.title ?? input.fallback.title ?? "AI 待辦"),
    taskType: normalizeAiTaskType(String(data.taskType ?? input.fallback.taskType ?? "followup")),
    duplicateCount: currentDuplicateCount + 1,
    dedupeReason: input.reason,
    targetStatus: input.targetStatus
  };
}

function shouldNotifyAiDrafts(
  result: AiTaskDraftCreateResult,
  suggestions: AiTaskSuggestion[],
  reusableDraftData?: FirebaseFirestore.DocumentData
) {
  return shouldNotifyAiDraftsImmediately({
    result,
    suggestions,
    reusableDraftAlreadyNotified: Boolean(reusableDraftData?.adminNotifiedAt)
  });
}

async function markAiDraftsAdminNotified(db: FirebaseFirestore.Firestore, draftIds: string[]) {
  const uniqueDraftIds = [...new Set(draftIds.filter(Boolean))];
  if (!uniqueDraftIds.length) return;

  await Promise.all(
    uniqueDraftIds.map((draftId) =>
      db.collection("ai_tasks").doc(draftId).set(
        {
          adminNotifiedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      )
    )
  );
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
  const cutoff = Date.now() - 5 * 60 * 1000;

  return (
    snapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter((item) => item.data.sourceGroupId === input.groupId)
      .filter((item) => !input.senderId || item.data.sourceSenderId === input.senderId)
      .filter((item) => item.data.reviewStatus === "pending")
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
    windowMinutes?: number;
  }
) {
  const currentMillis = input.currentTimestamp?.toMillis() ?? Date.now();
  const cutoff = currentMillis - (input.windowMinutes ?? 10) * 60 * 1000;
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

function uniqueLineAttachments(attachments: LineAttachmentForWrite[]) {
  const seen = new Set<string>();

  return attachments.filter((attachment) => {
    if (!attachment.messageId || seen.has(attachment.messageId)) return false;
    seen.add(attachment.messageId);
    return true;
  });
}

function buildImageReviewSuggestion(text: string, attachmentCount = 1): AiTaskSuggestion {
  const trimmedText = text.trim();
  const imageLabel = attachmentCount > 1 ? `圖片待確認（共 ${attachmentCount} 張）` : "圖片待確認";

  return {
    title: trimmedText ? `${imageLabel}: ${shortText(trimmedText, 22)}` : imageLabel,
    description: trimmedText
      ? `客戶傳送 ${attachmentCount} 張圖片，並有相關文字說明：\n${trimmedText}\n\n請確認是否為缺失、修補、設計修改或需要追蹤的事項。`
      : `客戶傳送 ${attachmentCount} 張圖片，目前沒有前後文字說明。請人工確認圖片用途，判斷是否需要建立修補、變更或追蹤待辦。`,
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
    const adminGroups = await listAssistantAdminGroupIds(db, getAiDraftNotificationAudience(input.suggestions));

    if (!adminGroups.length) return { sent: 0, failed: 0, groups: 0 };
    const primaryTaskType = getPrimarySuggestionTaskType(input.suggestions);
    const canSendNow = await claimNotificationCooldown(db, {
      projectId: input.projectId,
      notificationType: `ai_task_${primaryTaskType}`,
      cooldownMinutes: 60,
      title: input.suggestions[0]?.title ?? "AI 待審草稿"
    });

    if (!canSendNow) return { sent: 0, failed: 0, groups: adminGroups.length };

    const projectSnapshot = input.projectId ? await db.collection("projects").doc(input.projectId).get() : null;
    const project = projectSnapshot?.exists ? projectSnapshot.data() ?? {} : {};
    const projectName = project.name
      ? `${String(project.name)}${project.clientName ? ` / ${String(project.clientName)}` : ""}`
      : "未綁定案件";
    const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
    const draftItems = input.suggestions
      .map((suggestion, index) => ({ suggestion, index, draftId: input.createdDraftIds[index] ?? "" }))
      .filter((item) => item.draftId);
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
      ...draftItems.slice(0, 5).map(({ suggestion, index }) => {
        const dueDate = suggestion.dueDate ? `｜截止：${suggestion.dueDate.replaceAll("-", "/")}` : "";
        const draftId = input.createdDraftIds[index] ? `｜草稿ID：${input.createdDraftIds[index]}` : "";
        const riskLevel = getAiTaskRiskLevel(suggestion.taskType, suggestion.title);
        return `- ${suggestion.title}｜${aiTaskTypeLabel(suggestion.taskType)}｜${riskLevelLabel(riskLevel)}${dueDate}${draftId}`;
      }),
      ...relationLines,
      "",
      reviewUrl ? `審核：${reviewUrl}` : "請到網站 AI 審核頁確認。"
    ].join("\n");
    const reviewMessages = buildAiDraftReviewLineMessages({
      projectName,
      reviewUrl,
      summaryText: text,
      items: draftItems.map(({ suggestion, index }) => ({
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

async function notifyAdminGroupsAboutMergedAiTasks(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    senderName: string;
    senderRole: LineSenderRole;
    text: string;
    mergedItems: AiTaskMergedItem[];
  }
) {
  try {
    if (!input.mergedItems.length) return { sent: 0, failed: 0, groups: 0 };

    const adminGroups = await listAssistantAdminGroupIds(db, getMergedAiTaskNotificationAudience(input.mergedItems));
    if (!adminGroups.length) return { sent: 0, failed: 0, groups: 0 };
    const primaryTaskType = input.mergedItems[0]?.taskType ?? "followup";
    const canSendNow = await claimNotificationCooldown(db, {
      projectId: input.projectId,
      notificationType: `ai_task_${primaryTaskType}`,
      cooldownMinutes: 60,
      title: input.mergedItems[0]?.title ?? "AI 已合併相似訊息"
    });

    if (!canSendNow) return { sent: 0, failed: 0, groups: adminGroups.length };

    const projectSnapshot = input.projectId ? await db.collection("projects").doc(input.projectId).get() : null;
    const project = projectSnapshot?.exists ? projectSnapshot.data() ?? {} : {};
    const projectName = project.name
      ? `${String(project.name)}${project.clientName ? ` / ${String(project.clientName)}` : ""}`
      : "未綁定案件";
    const incidentUrl = getSiteUrl() ? `${getSiteUrl()}/incidents` : "";
    const aiTasksUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
    const lines = [
      "AI 已合併相似訊息",
      `案件：${projectName}`,
      `來源：${input.senderName || "LINE 成員"}（${senderRoleLabel(input.senderRole)}）`,
      `訊息：${shortText(input.text, 80)}`,
      "",
      ...input.mergedItems.slice(0, 6).map((item) => {
        const totalRelated = item.duplicateCount + 1;
        const targetLabel = item.targetStatus === "approved_task" ? "已核准待辦" : "待審草稿";
        const riskLevel = getAiTaskRiskLevel(item.taskType, item.title);

        return `- ${item.title}（${aiTaskTypeLabel(item.taskType)} / ${riskLevelLabel(riskLevel)} / ${targetLabel}）：已合併 ${item.duplicateCount} 則相似訊息，同一事件共 ${totalRelated} 則`;
      }),
      input.mergedItems.length > 6 ? `另有 ${input.mergedItems.length - 6} 筆合併項目` : "",
      "",
      incidentUrl ? `事件中心：${incidentUrl}` : "",
      aiTasksUrl ? `待辦審核：${aiTasksUrl}` : ""
    ].filter(Boolean);
    const text = lines.join("\n");
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

async function listAssistantAdminGroupIds(
  db: FirebaseFirestore.Firestore,
  audience: AdminNotificationAudience = "primary"
) {
  const adminGroups = await listAdminNotificationGroups(db, audience);
  return adminGroups.map((group) => group.groupId);
}

function getAiDraftNotificationAudience(suggestions: AiTaskSuggestion[]): AdminNotificationAudience {
  return getAiDraftImmediateNotificationAudience(suggestions) ?? "primary";
}

function getMergedAiTaskNotificationAudience(items: AiTaskMergedItem[]): AdminNotificationAudience {
  return getMergedAiTaskImmediateNotificationAudience(items) ?? "primary";
}

function getPrimarySuggestionTaskType(suggestions: AiTaskSuggestion[]): AiTaskType {
  return suggestions[0]?.taskType ?? "followup";
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
    incidentId: String(aiTask.incidentId ?? "").trim(),
    assignee: String(aiTask.assignedTo ?? "").trim(),
    dueDate: timestampToTaipeiInputDate(aiTask.dueDate),
    status: normalizeTaskStatus(String(aiTask.status ?? "")),
    source: "ai" as const,
    riskLevel: getAiTaskRiskLevel(taskType, String(aiTask.title ?? "")),
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

function normalizeAiTaskType(value: string): AiTaskType {
  if (
    value === "promise" ||
    value === "change" ||
    value === "followup" ||
    value === "payment" ||
    value === "invoice" ||
    value === "complaint" ||
    value === "schedule" ||
    value === "file"
  ) {
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
      postbackAction: String(result.action ?? ""),
      actionBy: String(result.actionBy ?? result.senderName ?? ""),
      assistantReply: String(result.assistantReply ?? ""),
      assistantReplyError: String(result.assistantReplyError ?? ""),
      fileUrlSaved: Boolean(result.fileUrlSaved),
      fileSaveError: String(result.fileSaveError ?? ""),
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

function aiTaskTypeLabel(type: AiTaskType) {
  return {
    promise: "承諾",
    change: "變更",
    followup: "追蹤",
    payment: "收款",
    invoice: "發票",
    complaint: "客訴 / 缺失",
    schedule: "工期",
    file: "圖面 / 檔案"
  }[type];
}

function riskLevelLabel(riskLevel: string) {
  if (riskLevel === "critical") return "重大風險";
  if (riskLevel === "high") return "高風險";
  if (riskLevel === "medium") return "中風險";
  return "低風險";
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

function isLineAssistantHelpCommand(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const exactCommands = ["說明", "功能", "使用說明", "help", "幫助", "怎麼用", "指令", "使用方式"];
  if (exactCommands.includes(normalized)) return true;

  return [
    "你會做什麼",
    "可以做什麼",
    "能做什麼",
    "能聊天嗎",
    "怎麼使用",
    "怎麼操作",
    "怎麼設定",
    "沒反應",
    "沒有反應",
    "看不到",
    "看不到回覆",
    "群組列表",
    "群組管理",
    "指令列表"
  ].some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function buildLineAdminHelpText() {
  const siteUrl = getSiteUrl();
  const links = [
    siteUrl ? `提醒中心：${siteUrl}/reminders` : "",
    siteUrl ? `待辦審核：${siteUrl}/ai-tasks` : "",
    siteUrl ? `LINE 對話：${siteUrl}/messages` : ""
  ].filter(Boolean);

  return [
    "我是 AI案件秘書，這個群組是公司後台群，我只會在後台群回覆與發提醒。",
    "",
    "我會幫你注意：",
    "1. 客戶訊息超過 2 小時未回覆",
    "2. AI 偵測到的待辦草稿",
    "3. 今天到期與已逾期待辦",
    "4. 工程進場提醒",
    "5. 關鍵節點提醒",
    "6. 高風險案件、變更、收款、發票事項",
    "",
    "看到提醒時可以直接按：",
    "- 已回覆 / 已處理",
    "- 明天追蹤 / 稍後提醒",
    "- 通過建立待辦",
    "- 拒絕草稿",
    "- 打開網站查看完整內容",
    "",
    "可以直接問我：",
    "- 今天有什麼事？",
    "- 明天有什麼事？",
    "- 有哪些案件有風險？",
    "- 有哪些款項要收？",
    "- 有哪些發票還沒開？",
    "",
    links.length ? links.join("\n") : "",
    "",
    "提醒：客戶群不會出現這些說明與審核按鈕。"
  ]
    .filter(Boolean)
    .join("\n");
}

async function saveLineMessageFile(
  event: LineWebhookEvent,
  groupId: string,
  messageType: "image" | "audio"
): Promise<SavedLineFile> {
  if (!event.message?.id) return { fileUrl: "", errorMessage: "Missing LINE message id" };

  try {
    const content = await downloadLineMessageContent(event.message.id);
    if (!content) return { fileUrl: "", errorMessage: "LINE message content download failed" };

    const bucket = getAdminStorageBucket();
    const extension = getFileExtension(content.contentType, messageType);
    const token = randomUUID();
    const storagePath = `line-messages/${sanitizePathSegment(groupId || "unknown")}/${event.message.id}.${extension}`;

    const saveToStorage = async () => {
      await bucket.file(storagePath).save(content.buffer, {
        metadata: {
          contentType: content.contentType,
          metadata: {
            firebaseStorageDownloadTokens: token
          }
        }
      });
    };

    const storageError = await retryLineFileSave(saveToStorage);
    const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      storagePath
    )}?alt=media&token=${token}`;

    const fileName = `${event.message.id}.${extension}`;

    if (!storageError) {
      return {
        fileUrl: storageUrl,
        errorMessage: "",
        buffer: content.buffer,
        contentType: content.contentType,
        fileName
      };
    }

    if (messageType === "image") {
      return {
        fileUrl: buildLineMessageContentProxyUrl(event.message.id),
        errorMessage: `Firebase Storage save failed, using LINE proxy: ${storageError}`,
        buffer: content.buffer,
        contentType: content.contentType,
        fileName
      };
    }

    return {
      fileUrl: "",
      errorMessage: `Firebase Storage save failed: ${storageError}`,
      buffer: content.buffer,
      contentType: content.contentType,
      fileName
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LINE file save error";

    if (messageType === "image") {
      return {
        fileUrl: buildLineMessageContentProxyUrl(event.message.id),
        errorMessage: `LINE file save fallback used: ${message}`
      };
    }

    return { fileUrl: "", errorMessage: message };
  }
}

async function retryLineFileSave(save: () => Promise<void>) {
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await save();
      return "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown Firebase Storage save error";
      await delay(300 * attempt);
    }
  }

  return lastError;
}

function buildLineMessageContentProxyUrl(messageId: string) {
  const path = `/api/line/message-content/${encodeURIComponent(messageId)}`;
  const siteUrl = getSiteUrl();

  return siteUrl ? `${siteUrl}${path}` : path;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
