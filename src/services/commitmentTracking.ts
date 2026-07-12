import { FieldValue } from "firebase-admin/firestore";
import { createReminderKey } from "../lib/reminders";
import type { LineSenderRole } from "../lib/types";
import { analyzeMessageForCommitments, type AiMessageContextItem } from "./aiTasks";

type TrackCommitmentsInput = {
  projectId: string;
  groupId: string;
  sourceMessageId: string;
  sourceLineMessageId: string;
  sourceSenderId: string;
  senderName: string;
  senderRole: LineSenderRole;
  text: string;
  recentMessages: AiMessageContextItem[];
};

export async function trackCommitmentsFromLineMessage(
  db: FirebaseFirestore.Firestore,
  input: TrackCommitmentsInput
) {
  if (!input.projectId || !input.groupId || input.senderRole !== "internal" || !input.text.trim()) {
    return { tracked: 0, keys: [] as string[] };
  }

  const commitments = await analyzeMessageForCommitments(input.text, input.senderRole, {
    recentMessages: input.recentMessages
  });
  const uniqueCommitments = dedupeCommitments(commitments);
  const today = taipeiDateString();
  const keys: string[] = [];

  await Promise.all(
    uniqueCommitments.map(async (commitment, index) => {
      const key = `${createReminderKey("message", input.sourceMessageId, "commitment_due")}_${index + 1}`;
      const reminderRef = db.collection("reminder_logs").doc(key);
      const snapshot = await reminderRef.get();
      const existing = snapshot.exists ? snapshot.data() ?? {} : {};

      if (existing.status === "confirmed") return;

      keys.push(key);

      await reminderRef.set(
        {
          key,
          sourceType: "message",
          sourceId: input.sourceMessageId,
          reminderType: "commitment_due",
          projectId: input.projectId,
          groupId: input.groupId,
          sourceLineMessageId: input.sourceLineMessageId,
          sourceSenderId: input.sourceSenderId,
          sourceSenderName: input.senderName,
          sourceSenderRole: input.senderRole,
          sourceLabel: "承諾追蹤",
          title: commitment.title,
          description: commitment.description,
          commitmentText: input.text,
          dueDate: commitment.dueDate ?? "",
          status: "pending",
          priority: "normal",
          firstTriggeredOn: existing.firstTriggeredOn ?? today,
          lastRemindedOn: existing.lastRemindedOn ?? "",
          lastAction: existing.lastAction ?? "commitment_tracked",
          createdAt: existing.createdAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    })
  );

  return { tracked: keys.length, keys };
}

function dedupeCommitments<T extends { title: string; dueDate?: string }>(commitments: T[]) {
  const seen = new Set<string>();

  return commitments.filter((commitment) => {
    const key = `${commitment.title}-${commitment.dueDate ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
