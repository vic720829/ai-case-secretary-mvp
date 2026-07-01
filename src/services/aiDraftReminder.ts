import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { createReminderKey } from "../lib/reminders";
import { getAiTaskRiskLevel } from "../lib/riskRules";
import type { AiTaskType } from "../lib/types";
import { buildAiDraftReviewLineMessages } from "./aiDraftReviewLineMessages";
import { listAdminNotificationGroups } from "./lineAdminGroups";
import { pushLineMessages } from "./line";
import { claimNotificationCooldown } from "./notificationCooldown";

const pendingReviewMinutes = 30;
const highPriorityMinutes = 180;

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
  const [projectSnapshot, aiTaskSnapshot] = await Promise.all([
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
    const notificationResult = shouldNotify30m
      ? await notifyAdminGroups(db, {
          draftId: doc.id,
          projectId,
          title,
          projectName: getProjectName(projects.get(projectId)),
          sourceSenderName,
          taskType: String(aiTask.taskType ?? ""),
          dueDate: timestampToTaipeiDate(aiTask.dueDate),
          createdAt,
          ageMinutes
        })
      : { sent: 0, failed: 0, skippedCooldown: false };
    const notifiedNow = shouldNotify30m && !notificationResult.skippedCooldown;

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
        ...(notifiedNow ? { notified30mAt: FieldValue.serverTimestamp() } : {}),
        ...(isHighPriority && !wasHighPriority ? { highPriorityAt: FieldValue.serverTimestamp() } : {}),
        lastAction: notificationResult.skippedCooldown
          ? "skipped_by_cooldown"
          : isHighPriority && !wasHighPriority
            ? "marked_high_priority"
            : reminder.lastAction ?? "pending_review",
        createdAt: reminder.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    result.createdOrUpdated += 1;
    if (isHighPriority && !wasHighPriority) result.markedHighPriority += 1;

    if (notifiedNow) {
      result.notified30m += 1;
      result.sent += notificationResult.sent;
      result.failed += notificationResult.failed;
    }
  }

  return result;
}

async function notifyAdminGroups(
  db: FirebaseFirestore.Firestore,
  input: {
    draftId: string;
    projectId: string;
    title: string;
    projectName: string;
    sourceSenderName: string;
    taskType: string;
    dueDate: string;
    createdAt: Date | null;
    ageMinutes: number;
  }
) {
  const taskType = normalizeAiTaskType(input.taskType);
  const riskLevel = getAiTaskRiskLevel(taskType, input.title);
  const adminGroups = await listAdminNotificationGroups(db, riskLevel === "critical" ? "critical" : "primary");
  if (!adminGroups.length) return { sent: 0, failed: 0, skippedCooldown: false };

  const canSendNow = await claimNotificationCooldown(db, {
    projectId: input.projectId,
    notificationType: `ai_task_${taskType}`,
    cooldownMinutes: 60,
    title: input.title
  });

  if (!canSendNow) return { sent: 0, failed: 0, skippedCooldown: true };

  const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
  const text = [
    "AI 草稿超過 30 分鐘未審核",
    `案件：${input.projectName}`,
    `草稿：${input.title}`,
    input.sourceSenderName ? `來源：${input.sourceSenderName}` : "",
    input.createdAt ? `建立時間：${formatDateTime(input.createdAt)}` : "",
    `已等待：約 ${input.ageMinutes} 分鐘`,
    "",
    reviewUrl ? `請審核：${reviewUrl}` : "請到網站 AI 審核頁處理。"
  ]
    .filter(Boolean)
    .join("\n");
  const messages = buildAiDraftReviewLineMessages({
    summaryText: text,
    projectName: input.projectName,
    reviewUrl,
    items: [
      {
        id: input.draftId,
        title: input.title,
        taskType: input.taskType,
        dueDate: input.dueDate
      }
    ]
  });
  const results = await Promise.allSettled(
    adminGroups.map((group) => pushLineMessages(group.groupId, messages))
  );

  return {
    sent: results.filter((item) => item.status === "fulfilled").length,
    failed: results.filter((item) => item.status === "rejected").length,
    skippedCooldown: false
  };
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

function timestampToTaipeiDate(value: unknown) {
  const date = timestampToDate(value);
  return date ? taipeiDateString(date) : "";
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
