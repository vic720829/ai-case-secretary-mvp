import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { createReminderKey } from "../lib/reminders";
import { pushLineMessages } from "./line";

const pendingReviewMinutes = 30;
const highPriorityMinutes = 180;

type AdminGroup = {
  groupId: string;
};

type ProjectSummary = {
  name: string;
  clientName: string;
};

type PendingDraftReminderResult = {
  checked: number;
  createdOrUpdated: number;
  notified30m: number;
  markedHighPriority: number;
  sent: number;
  failed: number;
};

export async function sendPendingAiDraftReviewReminders(): Promise<PendingDraftReminderResult> {
  const db = getAdminDb();
  const now = new Date();
  const today = taipeiDateString(now);
  const [adminGroups, projectSnapshot, aiTaskSnapshot] = await Promise.all([
    listAdminGroups(),
    db.collection("projects").get(),
    db.collection("ai_tasks").get()
  ]);
  const projects = new Map<string, ProjectSummary>();

  projectSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    projects.set(doc.id, {
      name: String(data.name ?? "未命名案件"),
      clientName: String(data.clientName ?? "")
    });
  });

  const result: PendingDraftReminderResult = {
    checked: 0,
    createdOrUpdated: 0,
    notified30m: 0,
    markedHighPriority: 0,
    sent: 0,
    failed: 0
  };

  for (const doc of aiTaskSnapshot.docs) {
    const aiTask = doc.data();
    if (String(aiTask.reviewStatus ?? "pending") !== "pending") continue;

    result.checked += 1;

    const createdAt = timestampToDate(aiTask.createdAt);
    const ageMinutes = getAgeMinutes(createdAt, now);
    if (ageMinutes < pendingReviewMinutes) continue;

    const projectId = String(aiTask.projectId ?? "");
    const title = String(aiTask.title ?? "未命名 AI 草稿");
    const sourceSenderName = String(aiTask.sourceSenderName ?? "");
    const key = createReminderKey("ai_task", doc.id, "ai_task_pending_review");
    const reminderRef = db.collection("reminder_logs").doc(key);
    const reminderSnapshot = await reminderRef.get();
    const reminder = reminderSnapshot.exists ? reminderSnapshot.data() ?? {} : {};

    if (reminder.status === "confirmed") continue;

    const isHighPriority = ageMinutes >= highPriorityMinutes;
    const wasHighPriority = reminder.priority === "high";
    const shouldNotify30m = !reminder.notified30mAt;

    await reminderRef.set(
      {
        key,
        sourceType: "ai_task",
        sourceId: doc.id,
        reminderType: "ai_task_pending_review",
        projectId,
        title,
        sourceLabel: isHighPriority ? "AI 草稿高優先：超過 3 小時未審核" : "AI 草稿待審核：超過 30 分鐘",
        dueDate: createdAt ? taipeiDateString(createdAt) : today,
        status: "pending",
        priority: isHighPriority ? "high" : "normal",
        firstTriggeredOn: reminder.firstTriggeredOn ?? today,
        lastRemindedOn: reminder.lastRemindedOn ?? today,
        ...(shouldNotify30m ? { notified30mAt: FieldValue.serverTimestamp() } : {}),
        ...(isHighPriority && !wasHighPriority ? { highPriorityAt: FieldValue.serverTimestamp() } : {}),
        lastAction: isHighPriority && !wasHighPriority ? "marked_high_priority" : reminder.lastAction ?? "pending_review",
        createdAt: reminder.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    result.createdOrUpdated += 1;
    if (isHighPriority && !wasHighPriority) result.markedHighPriority += 1;

    if (shouldNotify30m) {
      const notificationResult = await notifyAdminGroups(adminGroups, {
        title,
        projectName: getProjectName(projects.get(projectId)),
        sourceSenderName,
        createdAt,
        ageMinutes
      });
      result.notified30m += 1;
      result.sent += notificationResult.sent;
      result.failed += notificationResult.failed;
    }
  }

  return result;
}

async function listAdminGroups(): Promise<AdminGroup[]> {
  const db = getAdminDb();
  const snapshot = await db.collection("line_groups").where("groupType", "==", "admin").get();

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((group) => group.allowAssistantReplies !== false)
    .map((group) => ({ groupId: String(group.groupId ?? "") }))
    .filter((group) => group.groupId);
}

async function notifyAdminGroups(
  adminGroups: AdminGroup[],
  input: {
    title: string;
    projectName: string;
    sourceSenderName: string;
    createdAt: Date | null;
    ageMinutes: number;
  }
) {
  if (!adminGroups.length) return { sent: 0, failed: 0 };

  const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
  const text = [
    "AI 草稿超過 30 分鐘未審核",
    `案件：${input.projectName}`,
    `草稿：${input.title}`,
    input.sourceSenderName ? `來源：${input.sourceSenderName}` : "",
    input.createdAt ? `建立時間：${formatDateTime(input.createdAt)}` : "",
    `已等待：約 ${input.ageMinutes} 分鐘`,
    "",
    reviewUrl ? `請審核：${reviewUrl}` : "請到網站 AI 任務審核頁處理。"
  ]
    .filter(Boolean)
    .join("\n");
  const results = await Promise.allSettled(
    adminGroups.map((group) => pushLineMessages(group.groupId, [{ type: "text", text }]))
  );

  return {
    sent: results.filter((item) => item.status === "fulfilled").length,
    failed: results.filter((item) => item.status === "rejected").length
  };
}

function getProjectName(project?: ProjectSummary) {
  if (!project) return "未綁定案件";
  return project.clientName ? `${project.name} / ${project.clientName}` : project.name;
}

function timestampToDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

function getAgeMinutes(createdAt: Date | null, now: Date) {
  if (!createdAt) return 0;
  return Math.floor((now.getTime() - createdAt.getTime()) / 60000);
}

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
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

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
