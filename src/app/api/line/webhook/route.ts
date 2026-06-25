import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { analyzeMessageForAiTasks, dateStringToTimestamp } from "@/services/aiTasks";
import { answerQuestionFromFirestore, shouldAnswerLineQuestion } from "@/services/aiAssistant";
import {
  getEventGroupId,
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
  const messageRef = await db.collection("messages").add({
    projectId,
    groupId,
    senderId: event.source?.userId ?? "",
    senderName: event.source?.userId ?? "LINE 使用者",
    messageType,
    text: event.message.text ?? "",
    fileUrl: "",
    timestamp: event.timestamp ? Timestamp.fromMillis(event.timestamp) : FieldValue.serverTimestamp(),
    isProcessed: false
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

function normalizeMessageType(type: string) {
  if (type === "image" || type === "audio") return type;
  return "text";
}

function shouldReplyInLineChat(event: LineWebhookEvent, canAssistantReply: boolean) {
  return canAssistantReply && (event.source?.type === "group" || event.source?.type === "room");
}
