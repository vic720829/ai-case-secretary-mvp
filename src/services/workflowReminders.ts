import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { createReminderKey } from "../lib/reminders";
import { buildAiDraftReviewTemplateMessage } from "./aiDraftReviewLineMessages";
import { pushLineMessages, type LinePushMessage } from "./line";

type AdminGroup = {
  groupId: string;
};

type ProjectSummary = {
  id: string;
  name: string;
  clientName: string;
};

type AiTaskRow = {
  id: string;
  projectId: string;
  title: string;
  taskType: string;
  status: string;
  reviewStatus: string;
  sourceSenderRole: string;
  dueDate: string;
  createdAt: Date | null;
};

type TaskRow = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  dueDate: string;
};

type StageRow = {
  id: string;
  projectId: string;
  stageName: string;
  status: string;
  startDate: string;
  endDate: string;
};

type MilestoneRow = {
  id: string;
  projectId: string;
  title: string;
  completed: boolean;
  dueDate: string;
};

type WorkflowData = {
  today: string;
  tomorrow: string;
  projects: Map<string, ProjectSummary>;
  aiTasks: AiTaskRow[];
  tasks: TaskRow[];
  stages: StageRow[];
  milestones: MilestoneRow[];
};

export async function sendAfternoonFollowupReminder() {
  const [adminGroups, data] = await Promise.all([listAdminGroups(), loadWorkflowData()]);
  if (!adminGroups.length) return { ok: true, sent: 0, failed: 0, reason: "No admin LINE groups configured" };

  const messages = await buildAfternoonFollowupMessages(data);
  const results = await Promise.allSettled(adminGroups.map((group) => pushLineMessages(group.groupId, messages)));

  return {
    ok: true,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    groups: adminGroups.length
  };
}

export async function sendEveningCloseoutReminder() {
  const [adminGroups, data] = await Promise.all([listAdminGroups(), loadWorkflowData()]);
  if (!adminGroups.length) return { ok: true, sent: 0, failed: 0, reason: "No admin LINE groups configured" };

  const messages = buildEveningCloseoutMessages(data);
  const results = await Promise.allSettled(adminGroups.map((group) => pushLineMessages(group.groupId, messages)));

  return {
    ok: true,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    groups: adminGroups.length
  };
}

async function buildAfternoonFollowupMessages(data: WorkflowData): Promise<LinePushMessage[]> {
  const pendingDrafts = data.aiTasks.filter((task) => task.reviewStatus === "pending" && getAgeMinutes(task.createdAt) >= 30);
  const customerQuestions = data.aiTasks.filter(
    (task) =>
      task.reviewStatus === "pending" &&
      task.taskType === "followup" &&
      isCustomerLikeRole(task.sourceSenderRole) &&
      getAgeMinutes(task.createdAt) >= 120
  );
  const clientFollowups = data.aiTasks.filter(
    (task) =>
      task.taskType === "followup" &&
      isCustomerLikeRole(task.sourceSenderRole) &&
      (task.reviewStatus === "pending" || (task.reviewStatus === "approved" && task.status !== "done"))
  );
  const promiseDueToday = data.aiTasks.filter(
    (task) =>
      task.reviewStatus === "approved" &&
      task.taskType === "promise" &&
      task.status !== "done" &&
      task.dueDate === data.today
  );

  await upsertCustomerFollowupReminderLogs(customerQuestions, data.today);

  const text = [
    "AI案件秘書｜14:00 未回覆檢查",
    `日期：${data.today.replaceAll("-", "/")}`,
    "",
    formatAiTaskSection("客戶問題超過 2 小時未回覆", customerQuestions, data.projects),
    formatAiTaskSection("AI 草稿超過 30 分鐘未審核", pendingDrafts, data.projects),
    formatAiTaskSection("客戶待確認事項", clientFollowups, data.projects),
    formatAiTaskSection("今天應回覆但未完成的承諾", promiseDueToday, data.projects),
    "",
    "優先處理客戶問題與今日承諾，避免看過但忘記回。"
  ]
    .filter(Boolean)
    .join("\n");

  const actionItems = uniqueById([...customerQuestions, ...pendingDrafts]).slice(0, 4);
  const actionMessages = actionItems.flatMap((task) => {
    if (customerQuestions.some((item) => item.id === task.id)) return buildCustomerFollowupActionMessage(task, data.projects);

    return buildAiDraftReviewTemplateMessage(projectName(data.projects.get(task.projectId)), getReviewUrl(), {
      id: task.id,
      title: task.title,
      taskType: task.taskType,
      dueDate: task.dueDate
    });
  });

  const messages: LinePushMessage[] = [{ type: "text" as const, text }, ...actionMessages];

  return messages.slice(0, 5);
}

function buildEveningCloseoutMessages(data: WorkflowData): LinePushMessage[] {
  const dueTodayTasks = data.tasks.filter((task) => task.status !== "done" && task.dueDate === data.today);
  const overdueTasks = data.tasks.filter((task) => task.status !== "done" && task.dueDate && task.dueDate < data.today);
  const dueTodayAiTasks = data.aiTasks.filter(
    (task) => task.reviewStatus === "approved" && task.status !== "done" && task.dueDate === data.today
  );
  const promiseDueToday = dueTodayAiTasks.filter((task) => task.taskType === "promise");
  const tomorrowStages = data.stages.filter((stage) => stage.status !== "done" && stage.startDate === data.tomorrow);
  const tomorrowMilestones = data.milestones.filter((milestone) => !milestone.completed && milestone.dueDate === data.tomorrow);
  const newRiskDrafts = data.aiTasks.filter(
    (task) =>
      task.reviewStatus === "pending" &&
      ["change", "payment", "invoice"].includes(task.taskType) &&
      timestampToTaipeiDate(task.createdAt) === data.today
  );

  const text = [
    "AI案件秘書｜18:30 收尾提醒",
    `日期：${data.today.replaceAll("-", "/")}`,
    "",
    formatTaskSection("今天到期但未完成", dueTodayTasks, data.projects),
    formatAiTaskSection("今天承諾回覆但未完成", promiseDueToday, data.projects),
    formatStageSection("明天進場前置提醒", tomorrowStages, data.projects),
    formatMilestoneSection("明天到期關鍵節點", tomorrowMilestones, data.projects),
    formatAiTaskSection("今日新增變更 / 收款 / 發票草稿", newRiskDrafts, data.projects),
    overdueTasks.length ? formatTaskSection("仍逾期未處理", overdueTasks, data.projects) : "",
    "",
    "建議下班前把今天承諾、明天進場、變更與收款發票先收乾淨。"
  ]
    .filter(Boolean)
    .join("\n");

  const messages: LinePushMessage[] = [
    { type: "text" as const, text },
    toUriActionMessage("收尾處理", "打開提醒中心", `${getSiteUrl()}/reminders`, "打開風險中心", `${getSiteUrl()}/risk-center`)
  ];

  return messages.slice(0, 5);
}

function buildCustomerFollowupActionMessage(task: AiTaskRow, projects: Map<string, ProjectSummary>): LinePushMessage[] {
  const siteUrl = getSiteUrl();
  const project = projects.get(task.projectId);
  const encodedId = encodeURIComponent(task.id);
  const actions: Extract<LinePushMessage, { type: "template" }>["template"]["actions"] = [
    {
      type: "postback",
      label: "已回覆",
      data: `action=resolve_ai_followup&key=${encodedId}`,
      displayText: `已回覆：${task.title}`
    },
    {
      type: "postback",
      label: "明天追蹤",
      data: `action=snooze_ai_followup&key=${encodedId}&days=1`,
      displayText: `明天追蹤：${task.title}`
    }
  ];

  if (siteUrl) {
    actions.push({
      type: "uri",
      label: "指派處理",
      uri: `${siteUrl}/ai-tasks?draftId=${encodedId}`
    });
    actions.push({
      type: "uri",
      label: "打開訊息",
      uri: task.projectId ? `${siteUrl}/projects/${encodeURIComponent(task.projectId)}/messages` : `${siteUrl}/messages`
    });
  }

  return [
    {
      type: "template",
      altText: `客戶未回覆檢查：${task.title}`,
      template: {
        type: "buttons",
        title: "客戶未回覆檢查",
        text: `[${projectName(project)}] ${task.title}`.slice(0, 160),
        actions: actions.slice(0, 4)
      }
    }
  ];
}

function toUriActionMessage(title: string, firstLabel: string, firstUrl: string, secondLabel: string, secondUrl: string): LinePushMessage {
  const actions: Extract<LinePushMessage, { type: "template" }>["template"]["actions"] = [];

  if (firstUrl) actions.push({ type: "uri", label: firstLabel, uri: firstUrl });
  if (secondUrl) actions.push({ type: "uri", label: secondLabel, uri: secondUrl });

  return {
    type: "template",
    altText: title,
    template: {
      type: "buttons",
      title,
      text: "下班前快速打開網站補齊未完成事項。",
      actions
    }
  };
}

async function upsertCustomerFollowupReminderLogs(items: AiTaskRow[], today: string) {
  const db = getAdminDb();

  await Promise.all(
    items.map((item) => {
      const key = createReminderKey("ai_task", item.id, "customer_followup_unanswered");
      return db.collection("reminder_logs").doc(key).set(
        {
          key,
          sourceType: "ai_task",
          sourceId: item.id,
          reminderType: "customer_followup_unanswered",
          projectId: item.projectId,
          title: item.title,
          sourceLabel: "客戶問題超過 2 小時未回覆",
          dueDate: today,
          status: "pending",
          priority: "high",
          firstTriggeredOn: today,
          lastRemindedOn: today,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    })
  );
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

async function loadWorkflowData(): Promise<WorkflowData> {
  const db = getAdminDb();
  const today = taipeiDateString();
  const tomorrow = datePlusDays(today, 1);
  const [projectSnapshot, taskSnapshot, stageSnapshot, milestoneSnapshot, aiTaskSnapshot] = await Promise.all([
    db.collection("projects").get(),
    db.collection("tasks").get(),
    db.collection("projectStages").get(),
    db.collection("milestones").get(),
    db.collection("ai_tasks").get()
  ]);
  const projects = new Map<string, ProjectSummary>();

  projectSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    projects.set(doc.id, {
      id: doc.id,
      name: String(data.name ?? "未命名案件"),
      clientName: String(data.clientName ?? "")
    });
  });

  return {
    today,
    tomorrow,
    projects,
    tasks: taskSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        title: String(data.title ?? "未命名任務"),
        status: String(data.status ?? "todo"),
        dueDate: String(data.dueDate ?? "")
      };
    }),
    stages: stageSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        stageName: String(data.stageName ?? "未命名工期"),
        status: String(data.status ?? "todo"),
        startDate: String(data.startDate ?? ""),
        endDate: String(data.endDate ?? "")
      };
    }),
    milestones: milestoneSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        title: String(data.title ?? "未命名關鍵節點"),
        completed: Boolean(data.completed ?? false),
        dueDate: String(data.dueDate ?? "")
      };
    }),
    aiTasks: aiTaskSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        title: String(data.title ?? "未命名 AI 任務"),
        taskType: String(data.taskType ?? "followup"),
        status: String(data.status ?? "todo"),
        reviewStatus: String(data.reviewStatus ?? "pending"),
        sourceSenderRole: String(data.sourceSenderRole ?? "unknown"),
        dueDate: timestampToTaipeiDate(data.dueDate),
        createdAt: timestampToDate(data.createdAt)
      };
    })
  };
}

function formatTaskSection(title: string, items: TaskRow[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return `${title}：0 件`;

  return [
    `${title}：${items.length} 件`,
    ...items.slice(0, 8).map((item) => `- [${projectName(projects.get(item.projectId))}] ${item.title}`),
    moreLine(items.length, 8)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAiTaskSection(title: string, items: AiTaskRow[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return `${title}：0 件`;

  return [
    `${title}：${items.length} 件`,
    ...items.slice(0, 8).map((item) => `- [${projectName(projects.get(item.projectId))}] ${item.title}`),
    moreLine(items.length, 8)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatStageSection(title: string, items: StageRow[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return `${title}：0 件`;

  return [
    `${title}：${items.length} 件`,
    ...items.slice(0, 8).map((item) => `- [${projectName(projects.get(item.projectId))}] ${item.stageName}`),
    moreLine(items.length, 8)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMilestoneSection(title: string, items: MilestoneRow[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return `${title}：0 件`;

  return [
    `${title}：${items.length} 件`,
    ...items.slice(0, 8).map((item) => `- [${projectName(projects.get(item.projectId))}] ${item.title}`),
    moreLine(items.length, 8)
  ]
    .filter(Boolean)
    .join("\n");
}

function uniqueById(items: AiTaskRow[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isCustomerLikeRole(role: string) {
  return role === "client" || role === "unknown";
}

function getAgeMinutes(createdAt: Date | null) {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - createdAt.getTime()) / 60000);
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

function projectName(project?: ProjectSummary) {
  if (!project) return "未綁定案件";
  return project.clientName ? `${project.name} / ${project.clientName}` : project.name;
}

function moreLine(total: number, shown: number) {
  return total > shown ? `- 另有 ${total - shown} 件` : "";
}

function getReviewUrl() {
  const siteUrl = getSiteUrl();
  return siteUrl ? `${siteUrl}/ai-tasks` : "";
}

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
}
