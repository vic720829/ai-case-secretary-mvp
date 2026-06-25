import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import type { LineSenderRole } from "@/lib/types";
import { analyzeMessageForAiTasks, dateStringToTimestamp } from "@/services/aiTasks";
import { answerQuestionFromFirestore, shouldAnswerLineQuestion } from "@/services/aiAssistant";
import {
  downloadLineMessageContent,
  getEventGroupId,
  getLineSenderName,
  replyLineText,
  verifyLineSignature,
  type LineWebhookEvent
} from "@/services/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid LINE signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events?: LineWebhookEvent[] };
  const events = body.events ?? [];
  const db = getAdminDb();

  const results = await Promise.all(events.map((event) => handleLineEvent(db, event)));

  return NextResponse.json({ ok: true, results });
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
  const lineGroup = lineGroupSnapshot && !lineGroupSnapshot.empty ? lineGroupSnapshot.docs[0].data() : null;
  const isAdminGroup = lineGroup?.groupType === "admin";
  const canAssistantReply = isAdminGroup && lineGroup?.allowAssistantReplies !== false;
  const projectId = isAdminGroup ? "" : String(lineGroup?.projectId ?? "");
  const messageType = normalizeMessageType(event.message.type);
  const lineSenderName = await getLineSenderName(event);
  const member = await findLineMember(db, event.source?.userId ?? "", projectId);
  const senderName = member.displayName || lineSenderName;
  const senderRole = member.role;
  const fileUrl = messageType === "text" ? "" : await saveLineMessageFile(event, groupId, messageType);
  const messageRef = await db.collection("messages").add({
    projectId,
    groupId,
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
    const suggestions = shouldCreateAiDrafts
      ? await analyzeMessageForAiTasks(event.message.text, senderRole)
      : [];

    await Promise.all(
      suggestions.map((suggestion) =>
        db.collection("ai_tasks").add({
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
          createdAt: FieldValue.serverTimestamp()
        })
      )
    );

    if (shouldReplyInLineChat(event, canAssistantReply) && shouldAnswerLineQuestion(event.message.text)) {
      const answer = await answerQuestionFromFirestore(event.message.text, projectId);
      await replyLineText(event.replyToken, answer);
    }

    await messageRef.update({ isProcessed: true });

    return {
      messageId: messageRef.id,
      aiTaskDrafts: suggestions.length,
      projectId,
      aiSkippedReason: shouldCreateAiDrafts ? "" : "Only bound project LINE groups create AI task drafts"
    };
  }

  return { messageId: messageRef.id, aiTaskDrafts: 0, projectId };
}

async function handleLinePostback(db: FirebaseFirestore.Firestore, event: LineWebhookEvent) {
  const params = new URLSearchParams(event.postback?.data ?? "");
  const action = params.get("action") ?? "";
  const key = params.get("key") ?? "";

  if (!key || !["confirm_reminder", "snooze_reminder", "keep_reminder"].includes(action)) {
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

async function findLineMember(
  db: FirebaseFirestore.Firestore,
  lineUserId: string,
  projectId: string
): Promise<{ displayName: string; role: LineSenderRole }> {
  if (!lineUserId) return { displayName: "", role: "unknown" };

  const snapshot = await db.collection("line_members").where("lineUserId", "==", lineUserId).get();
  if (snapshot.empty) return { displayName: "", role: "unknown" };

  const members = snapshot.docs.map((doc) => doc.data());
  const matched =
    members.find((member) => String(member.projectId ?? "") === projectId) ??
    members.find((member) => !member.projectId) ??
    members[0];
  const role = normalizeSenderRole(String(matched.role ?? "unknown"));

  return {
    displayName: String(matched.displayName ?? ""),
    role
  };
}

function normalizeSenderRole(role: string): LineSenderRole {
  if (role === "internal" || role === "client" || role === "vendor") return role;
  return "unknown";
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
