import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { pushLineText } from "./line";

type ReminderItem = {
  projectId: string;
  source: string;
  title: string;
  dueDate?: string;
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

  const text = await buildDailyReminderText();
  const results = await Promise.allSettled(adminGroups.map((group) => pushLineText(group.groupId, text)));

  return {
    ok: true,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    groups: adminGroups.length
  };
}

export async function buildDailyReminderText() {
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

  const dueToday: ReminderItem[] = [];
  const stageStartReminders: ReminderItem[] = [];
  const milestoneReminders: ReminderItem[] = [];
  const overdue: ReminderItem[] = [];
  const highRisk: ReminderItem[] = [];

  taskSnapshot.docs.forEach((doc) => {
    const task = doc.data();
    const status = String(task.status ?? "todo");
    const dueDate = String(task.dueDate ?? "");
    const item = toReminderItem(task.projectId, "任務", task.title, dueDate);

    if (status === "done") return;
    if (dueDate === today) dueToday.push(item);
    if (dueDate && dueDate < today) overdue.push(item);
    if (task.riskLevel === "high") highRisk.push(item);
  });

  milestoneSnapshot.docs.forEach((doc) => {
    const milestone = doc.data();
    const completed = Boolean(milestone.completed);
    const dueDate = String(milestone.dueDate ?? "");
    const reminderDaysBefore = Number(milestone.reminderDaysBefore ?? 0);
    const item = toReminderItem(milestone.projectId, "關鍵節點", milestone.title, dueDate);

    if (completed) return;
    if (dueDate === today) dueToday.push(item);
    if (dueDate && dueDate < today) overdue.push(item);
    if (milestone.riskLevel === "high") highRisk.push(item);
    if (dueDate && reminderDaysBefore > 0 && dateMinusDays(dueDate, reminderDaysBefore) === today) {
      milestoneReminders.push(
        toReminderItem(milestone.projectId, `關鍵節點提醒：${reminderDaysBefore} 天後`, milestone.title, dueDate)
      );
    }
  });

  stageSnapshot.docs.forEach((doc) => {
    const stage = doc.data();
    const status = String(stage.status ?? "todo");
    const startDate = String(stage.startDate ?? "");
    const endDate = String(stage.endDate ?? "");
    const reminderDaysBefore = Number(stage.reminderDaysBefore ?? 0);

    if (status !== "done" && endDate && endDate < today) {
      overdue.push(toReminderItem(stage.projectId, "工期節點", stage.stageName, endDate));
    }

    if (status !== "done" && startDate && reminderDaysBefore > 0 && dateMinusDays(startDate, reminderDaysBefore) === today) {
      stageStartReminders.push(
        toReminderItem(stage.projectId, `進場提醒：${reminderDaysBefore} 天後`, stage.stageName, startDate)
      );
    }
  });

  aiTaskSnapshot.docs.forEach((doc) => {
    const aiTask = doc.data();
    const status = String(aiTask.status ?? "todo");
    const dueDate = timestampToTaipeiDate(aiTask.dueDate);

    if (status === "done" || !dueDate) return;
    const item = toReminderItem(aiTask.projectId, `AI ${aiTask.taskType ?? "任務"}`, aiTask.title, dueDate);
    if (dueDate === today) dueToday.push(item);
    if (dueDate < today) overdue.push(item);
  });

  const sections = [
    formatSection("進場提醒", stageStartReminders, projects),
    formatSection("關鍵節點提醒", milestoneReminders, projects),
    formatSection("今天到期", dueToday, projects),
    formatSection("已逾期", overdue, projects),
    formatSection("高風險", highRisk, projects)
  ].filter(Boolean);

  return [
    "AI案件秘書每日提醒",
    `日期：${today.replaceAll("-", "/")}`,
    "",
    sections.length ? sections.join("\n\n") : "目前沒有今天到期、逾期或高風險事項。",
    "",
    "提醒：這則訊息只會發送到公司後台群組。"
  ].join("\n");
}

function toReminderItem(projectId: unknown, source: string, title: unknown, dueDate?: string): ReminderItem {
  return {
    projectId: String(projectId ?? ""),
    source,
    title: String(title ?? "未命名事項"),
    dueDate
  };
}

function formatSection(title: string, items: ReminderItem[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return "";

  const lines = items.slice(0, 8).map((item) => formatReminderLine(item, projects));
  const hiddenCount = items.length - lines.length;

  return [`${title}：${items.length} 項`, ...lines, hiddenCount > 0 ? `- 另有 ${hiddenCount} 項` : ""]
    .filter(Boolean)
    .join("\n");
}

function formatReminderLine(item: ReminderItem, projects: Map<string, ProjectSummary>) {
  const project = projects.get(item.projectId);
  const projectName = project ? `${project.name}${project.clientName ? ` / ${project.clientName}` : ""}` : "未綁定案件";
  const dueDate = item.dueDate ? `（${item.dueDate.replaceAll("-", "/")}）` : "";

  return `- [${projectName}] ${item.source}：${item.title}${dueDate}`;
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

function dateMinusDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return "";

  parsed.setDate(parsed.getDate() - days);
  return taipeiDateString(parsed);
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
