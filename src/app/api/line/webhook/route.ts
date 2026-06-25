import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
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
  const senderName = await getLineSenderName(event);
  const fileUrl = messageType === "text" ? "" : await saveLineMessageFile(event, groupId, messageType);
  const messageRef = await db.collection("messages").add({
    projectId,
    groupId,
    senderId: event.source?.userId ?? "",
    senderName,
    messageType,
    text: event.message.text ?? "",
    fileUrl,
    timestamp: event.timestamp ? Timestamp.fromMillis(event.timestamp) : FieldValue.serverTimestamp(),
    isProcessed: false,
    createdAt: FieldValue.serverTimestamp()
  });

  if (messageType === "text" && event.message.text) {
    const suggestions = await analyzeMessageForAiTasks(event.message.text);

    await Promise.all(
      suggestions.map((suggestion) =>
        db.collection("ai_tasks").add({
          projectId,
          sourceMessageId: messageRef.id,
          title: suggestion.title,
          description: suggestion.description,
          taskType: suggestion.taskType,
          status: "todo",
          assignedTo: suggestion.assignedTo ?? "",
          dueDate: dateStringToTimestamp(suggestion.dueDate),
          createdByAI: true,
          createdAt: FieldValue.serverTimestamp()
        })
      )
    );

    if (shouldReplyInLineChat(event, canAssistantReply) && shouldAnswerLineQuestion(event.message.text)) {
      const answer = await answerQuestionFromFirestore(event.message.text, projectId);
      await replyLineText(event.replyToken, answer);
    }

    await messageRef.update({ isProcessed: true });

    return { messageId: messageRef.id, aiTasks: suggestions.length, projectId };
  }

  return { messageId: messageRef.id, aiTasks: 0, projectId };
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
