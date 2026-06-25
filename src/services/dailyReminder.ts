import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { createReminderKey, dateMinusDays } from "../lib/reminders";
import type { ReminderPriority, ReminderSourceType, ReminderType } from "../lib/types";
import { buildAiDraftReviewTemplateMessage } from "./aiDraftReviewLineMessages";
import { pushLineMessages, type LinePushMessage } from "./line";

type ReminderItem = {
  key: string;
  sourceType: ReminderSourceType;
  sourceId: string;
  reminderType: ReminderType;
  projectId: string;
  sourceLabel: string;
  title: string;
  dueDate: string;
  priority: ReminderPriority;
  firstTriggeredOn: string;
  lastRemindedOn: string;
  snoozedUntil?: string;
  taskType?: string;
};

type ProjectSummary = {
  name: string;
  clientName: string;
};

export async function sendDailyAdminReminder() {
  const db = getAdminDb();
  const adminGroupSnapshot = await db.collection("line_groups").where("groupType", "==", "admin").get();
  const adminGroups = adminGroupSnapshot.docs
    .map((doc) => doc.data())
    .filter((group) => group.allowAssistantReplies !== false)
    .map((group) => ({
      groupId: String(group.groupId ?? ""),
      groupName: String(group.groupName ?? "")
    }))
    .filter((group) => group.groupId);

  if (!adminGroups.length) {
    return { ok: true, sent: 0, failed: 0, reason: "No admin LINE groups configured" };
  }

  const messages = await buildDailyReminderMessages();
  const results = await Promise.allSettled(adminGroups.map((group) => pushLineMessages(group.groupId, messages)));

  return {
    ok: true,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    groups: adminGroups.length
  };
}

export async function buildDailyReminderText() {
  const content = await buildDailyReminderContent();
  return content.text;
}

export async function buildDailyReminderMessages(): Promise<LinePushMessage[]> {
  const content = await buildDailyReminderContent();
  const reviewUrl = getSiteUrl() ? `${getSiteUrl()}/ai-tasks` : "";
  const actionMessages = content.pendingItems
    .slice(0, 4)
    .flatMap((item) => toDailyActionMessage(item, content.projects, reviewUrl));

  return [{ type: "text", text: content.text }, ...actionMessages];
}

async function buildDailyReminderContent() {
  const db = getAdminDb();
  const today = taipeiDateString();
  const [projectSnapshot, taskSnapshot, milestoneSnapshot, stageSnapshot, aiTaskSnapshot] = await Promise.all([
    db.collection("projects").get(),
    db.collection("tasks").get(),
    db.collection("milestones").get(),
    db.collection("projectStages").get(),
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

  const candidates: ReminderItem[] = [];

  taskSnapshot.docs.forEach((doc) => {
    const task = doc.data();
    const status = String(task.status ?? "todo");
    const dueDate = String(task.dueDate ?? "");
    const projectId = String(task.projectId ?? "");
    const title = String(task.title ?? "未命名待辦");

    if (status === "done") return;
    if (dueDate === today) {
      candidates.push(toReminderItem("task", doc.id, "due_today", projectId, "待辦今天到期", title, dueDate, today));
    }
    if (dueDate && dueDate < today) {
      candidates.push(toReminderItem("task", doc.id, "overdue", projectId, "待辦已逾期", title, dueDate, today));
    }
    if (task.riskLevel === "high") {
      candidates.push(toReminderItem("task", doc.id, "high_risk", projectId, "高風險待辦", title, dueDate, today));
    }
  });

  milestoneSnapshot.docs.forEach((doc) => {
    const milestone = doc.data();
    const completed = Boolean(milestone.completed);
    const dueDate = String(milestone.dueDate ?? "");
    const reminderDaysBefore = Number(milestone.reminderDaysBefore ?? 0);
    const projectId = String(milestone.projectId ?? "");
    const title = String(milestone.title ?? "未命名關鍵節點");

    if (completed) return;
    if (dueDate && reminderDaysBefore > 0 && dateMinusDays(dueDate, reminderDaysBefore) <= today) {
      candidates.push(
        toReminderItem(
          "milestone",
          doc.id,
          "milestone_before_due",
          projectId,
          `關鍵節點提醒：${reminderDaysBefore} 天前`,
          title,
          dueDate,
          today
        )
      );
    }
    if (dueDate === today) {
      candidates.push(toReminderItem("milestone", doc.id, "due_today", projectId, "關鍵節點今天到期", title, dueDate, today));
    }
    if (dueDate && dueDate < today) {
      candidates.push(toReminderItem("milestone", doc.id, "overdue", projectId, "關鍵節點已逾期", title, dueDate, today));
    }
    if (milestone.riskLevel === "high") {
      candidates.push(toReminderItem("milestone", doc.id, "high_risk", projectId, "高風險關鍵節點", title, dueDate, today));
    }
  });

  stageSnapshot.docs.forEach((doc) => {
    const stage = doc.data();
    const status = String(stage.status ?? "todo");
    const startDate = String(stage.startDate ?? "");
    const endDate = String(stage.endDate ?? "");
    const reminderDaysBefore = Number(stage.reminderDaysBefore ?? 0);
    const projectId = String(stage.projectId ?? "");
    const title = String(stage.stageName ?? "未命名工期節點");

    if (status === "done") return;
    if (startDate && reminderDaysBefore > 0 && dateMinusDays(startDate, reminderDaysBefore) <= today) {
      candidates.push(
        toReminderItem(
          "stage",
          doc.id,
          "stage_before_start",
          projectId,
          `進場提醒：${reminderDaysBefore} 天前`,
          title,
          startDate,
          today
        )
      );
    }
    if (endDate && endDate < today) {
      candidates.push(toReminderItem("stage", doc.id, "overdue", projectId, "工期節點已逾期", title, endDate, today));
    }
  });

  aiTaskSnapshot.docs.forEach((doc) => {
    const aiTask = doc.data();
    const reviewStatus = String(aiTask.reviewStatus ?? "pending");
    const status = String(aiTask.status ?? "todo");
    const dueDate = timestampToTaipeiDate(aiTask.dueDate);
    const createdDate = timestampToTaipeiDate(aiTask.createdAt);
    const projectId = String(aiTask.projectId ?? "");
    const title = String(aiTask.title ?? "未命名 AI 待辦");
    const taskType = String(aiTask.taskType ?? "");

    if (reviewStatus === "pending") {
      if (!createdDate || createdDate >= today) return;

      candidates.push({
        ...toReminderItem(
          "ai_task",
          doc.id,
          "ai_task_pending_review",
          projectId,
          "AI 草稿高優先：隔夜未審核",
          title,
          createdDate,
          today,
          "high"
        ),
        taskType
      });
      return;
    }

    if (reviewStatus !== "approved") return;
    if (status === "done" || !dueDate) return;
    if (dueDate === today) {
      candidates.push(toReminderItem("ai_task", doc.id, "due_today", projectId, "AI 待辦今天到期", title, dueDate, today));
    }
    if (dueDate < today) {
      candidates.push(toReminderItem("ai_task", doc.id, "overdue", projectId, "AI 待辦已逾期", title, dueDate, today));
    }
  });

  await upsertPendingReminderLogs(candidates);
  const pendingItems = await listPendingReminderItems(today);
  const dailyPendingItems = pendingItems.filter((item) => shouldIncludeInDailyReminder(item, today));

  const sections = [
    formatSection("AI 草稿待審核", dailyPendingItems.filter((item) => item.reminderType === "ai_task_pending_review"), projects),
    formatSection("進場提醒", dailyPendingItems.filter((item) => item.reminderType === "stage_before_start"), projects),
    formatSection("關鍵節點提醒", dailyPendingItems.filter((item) => item.reminderType === "milestone_before_due"), projects),
    formatSection("今天到期", dailyPendingItems.filter((item) => item.reminderType === "due_today"), projects),
    formatSection("已逾期", dailyPendingItems.filter((item) => item.reminderType === "overdue"), projects),
    formatSection("高風險", dailyPendingItems.filter((item) => item.reminderType === "high_risk"), projects)
  ].filter(Boolean);

  return {
    text: [
      "AI案件秘書｜8:30 開工摘要",
      `日期：${today.replaceAll("-", "/")}`,
      "",
      sections.length ? sections.join("\n\n") : "目前沒有需要提醒的事項。",
      "",
      "先看今天要盯的待辦、工程、關鍵節點、風險案件與逾期事項。"
    ].join("\n"),
    pendingItems: dailyPendingItems,
    projects
  };
}

async function upsertPendingReminderLogs(items: ReminderItem[]) {
  const db = getAdminDb();

  await Promise.all(
    items.map(async (item) => {
      const ref = db.collection("reminder_logs").doc(item.key);
      const snapshot = await ref.get();
      const data = snapshot.exists ? snapshot.data() : null;

      if (data?.status === "confirmed") return;

      await ref.set(
        {
          ...item,
          status: "pending",
          createdAt: data?.createdAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    })
  );
}

async function listPendingReminderItems(today: string) {
  const db = getAdminDb();
  const snapshot = await db.collection("reminder_logs").where("status", "==", "pending").get();
  const pendingItems = snapshot.docs
    .map((doc) => doc.data())
    .map((data) => ({
      key: String(data.key ?? ""),
      sourceType: String(data.sourceType ?? "task") as ReminderSourceType,
      sourceId: String(data.sourceId ?? ""),
      reminderType: String(data.reminderType ?? "due_today") as ReminderType,
      projectId: String(data.projectId ?? ""),
      sourceLabel: String(data.sourceLabel ?? ""),
      title: String(data.title ?? "未命名提醒"),
      dueDate: String(data.dueDate ?? ""),
      priority: (data.priority === "high" ? "high" : "normal") as ReminderPriority,
      firstTriggeredOn: String(data.firstTriggeredOn ?? today),
      lastRemindedOn: String(data.lastRemindedOn ?? today),
      snoozedUntil: data.snoozedUntil ? String(data.snoozedUntil) : "",
      taskType: String(data.taskType ?? "")
    }))
    .filter((item) => !item.snoozedUntil || item.snoozedUntil <= today);

  await Promise.all(
    pendingItems.map((item) =>
      db.collection("reminder_logs").doc(item.key).set(
        {
          lastRemindedOn: today,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      )
    )
  );

  return pendingItems;
}

function toReminderItem(
  sourceType: ReminderSourceType,
  sourceId: string,
  reminderType: ReminderType,
  projectId: string,
  sourceLabel: string,
  title: string,
  dueDate: string,
  today: string,
  priority: ReminderPriority = "normal"
): ReminderItem {
  return {
    key: createReminderKey(sourceType, sourceId, reminderType),
    sourceType,
    sourceId,
    reminderType,
    projectId,
    sourceLabel,
    title,
    dueDate,
    priority,
    firstTriggeredOn: today,
    lastRemindedOn: today
  };
}

function toReminderActionMessage(item: ReminderItem, projects: Map<string, ProjectSummary>): LinePushMessage {
  const projectName = getProjectName(item, projects);
  const title = truncate(`${item.sourceLabel}`, 40);
  const text = truncate(`[${projectName}] ${item.title}${item.dueDate ? `｜${item.dueDate.replaceAll("-", "/")}` : ""}`, 160);
  const encodedKey = encodeURIComponent(item.key);

  return {
    type: "template",
    altText: truncate(`提醒確認：${item.title}`, 400),
    template: {
      type: "buttons",
      title,
      text,
      actions: [
        {
          type: "postback",
          label: "已確認",
          data: `action=confirm_reminder&key=${encodedKey}`,
          displayText: truncate(`已確認：${item.title}`, 300)
        },
        {
          type: "postback",
          label: "明天再提醒",
          data: `action=snooze_reminder&key=${encodedKey}&days=1`,
          displayText: truncate(`明天再提醒：${item.title}`, 300)
        },
        {
          type: "postback",
          label: "延後3天",
          data: `action=snooze_reminder&key=${encodedKey}&days=3`,
          displayText: truncate(`延後3天：${item.title}`, 300)
        },
        {
          type: "postback",
          label: "仍待處理",
          data: `action=keep_reminder&key=${encodedKey}`,
          displayText: truncate(`仍待處理：${item.title}`, 300)
        }
      ]
    }
  };
}

function toDailyActionMessage(
  item: ReminderItem,
  projects: Map<string, ProjectSummary>,
  reviewUrl: string
): LinePushMessage[] {
  if (item.reminderType === "ai_task_pending_review") {
    return buildAiDraftReviewTemplateMessage(getProjectName(item, projects), reviewUrl, {
      id: item.sourceId,
      title: item.title,
      taskType: item.taskType,
      dueDate: item.dueDate
    });
  }

  return [toReminderActionMessage(item, projects)];
}

function formatSection(title: string, items: ReminderItem[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return "";

  const lines = items.slice(0, 8).map((item) => formatReminderLine(item, projects));
  const hiddenCount = items.length - lines.length;

  return [`${title}：${items.length} 件`, ...lines, hiddenCount > 0 ? `- 另有 ${hiddenCount} 件` : ""]
    .filter(Boolean)
    .join("\n");
}

function formatReminderLine(item: ReminderItem, projects: Map<string, ProjectSummary>) {
  const projectName = getProjectName(item, projects);
  const dueDate = item.dueDate ? `（${item.dueDate.replaceAll("-", "/")}）` : "";
  const priority = item.priority === "high" ? "【高優先】" : "";

  return `- ${priority}[${projectName}] ${item.sourceLabel}：${item.title}${dueDate}`;
}

function shouldIncludeInDailyReminder(item: ReminderItem, today: string) {
  if (item.reminderType !== "ai_task_pending_review") return true;
  return Boolean(item.dueDate && item.dueDate < today);
}

function getProjectName(item: ReminderItem, projects: Map<string, ProjectSummary>) {
  const project = projects.get(item.projectId);
  return project ? `${project.name}${project.clientName ? ` / ${project.clientName}` : ""}` : "未綁定案件";
}

function timestampToTaipeiDate(value: unknown) {
  if (value instanceof Timestamp) {
    return taipeiDateString(value.toDate());
  }

  if (value && typeof value === "object" && "toDate" in value) {
    return taipeiDateString((value as { toDate: () => Date }).toDate());
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return "";
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

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
