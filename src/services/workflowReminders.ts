import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { createReminderKey } from "../lib/reminders";
import type { LineSenderRole } from "../lib/types";
import { buildAiDraftReviewTemplateMessage } from "./aiDraftReviewLineMessages";
import { listAdminNotificationGroups } from "./lineAdminGroups";
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
  sourceMessageId: string;
  title: string;
  taskType: string;
  status: string;
  reviewStatus: string;
  sourceSenderRole: string;
  dueDate: string;
  createdAt: Date | null;
};

type MessageRow = {
  id: string;
  projectId: string;
  groupId: string;
  senderName: string;
  senderRole: LineSenderRole;
  messageType: string;
  text: string;
  timestamp: Date | null;
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
  messages: MessageRow[];
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
  const aiBackedMessageIds = new Set(data.aiTasks.map((task) => task.sourceMessageId).filter(Boolean));
  const customerMessages = findUnansweredCustomerMessages(data.messages, aiBackedMessageIds);
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

  await upsertCustomerMessageReminderLogs(customerMessages, data.today);
  await upsertCustomerFollowupReminderLogs(customerQuestions, data.today);

  const text = [
    "AI案件秘書｜14:00 未回覆檢查",
    `日期：${data.today.replaceAll("-", "/")}`,
    "",
    formatMessageSection("LINE 客戶訊息超過 2 小時未回覆", customerMessages, data.projects),
    formatAiTaskSection("客戶問題超過 2 小時未回覆", customerQuestions, data.projects),
    formatAiTaskSection("AI 草稿超過 30 分鐘未審核", pendingDrafts, data.projects),
    formatAiTaskSection("客戶待確認事項", clientFollowups, data.projects),
    formatAiTaskSection("今天應回覆但未完成的承諾", promiseDueToday, data.projects),
    "",
    "優先處理客戶問題與今日承諾，避免看過但忘記回。"
  ]
    .filter(Boolean)
    .join("\n");

  const aiActionItems = uniqueById([...customerQuestions, ...pendingDrafts]).slice(0, Math.max(0, 4 - customerMessages.length));
  const actionMessages = [
    ...customerMessages.slice(0, 4).flatMap((message) => buildCustomerMessageActionMessage(message, data.projects)),
    ...aiActionItems.flatMap((task) => {
    if (customerQuestions.some((item) => item.id === task.id)) return buildCustomerFollowupActionMessage(task, data.projects);

    return buildAiDraftReviewTemplateMessage(projectName(data.projects.get(task.projectId)), getReviewUrl(), {
      id: task.id,
      title: task.title,
      taskType: task.taskType,
      dueDate: task.dueDate
    });
    })
  ];

  const messages: LinePushMessage[] = [{ type: "text" as const, text }, ...actionMessages];

  return messages.slice(0, 5);
}

function findUnansweredCustomerMessages(messages: MessageRow[], aiBackedMessageIds: Set<string>) {
  return messages
    .filter((message) => isCustomerMessageCandidate(message, aiBackedMessageIds))
    .filter((message) => !hasInternalReplyAfter(messages, message))
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0))
    .slice(0, 12);
}

function isCustomerMessageCandidate(message: MessageRow, aiBackedMessageIds: Set<string>) {
  if (aiBackedMessageIds.has(message.id)) return false;
  if (!message.projectId || !message.groupId) return false;
  if (message.messageType !== "text") return false;
  if (!isCustomerLikeRole(message.senderRole)) return false;
  if (getAgeMinutes(message.timestamp) < 120) return false;
  return isLikelyNeedsReply(message.text);
}

function hasInternalReplyAfter(messages: MessageRow[], message: MessageRow) {
  const messageTime = message.timestamp?.getTime() ?? 0;
  if (!messageTime) return false;

  return messages.some((candidate) => {
    if (candidate.groupId !== message.groupId) return false;
    if (candidate.projectId !== message.projectId) return false;
    if (candidate.senderRole !== "internal") return false;
    const candidateTime = candidate.timestamp?.getTime() ?? 0;
    return candidateTime > messageTime;
  });
}

function isLikelyNeedsReply(text: string) {
  const value = text.trim();
  if (!value) return false;

  const keywords = [
    "?",
    "？",
    "嗎",
    "呢",
    "請問",
    "怎麼",
    "如何",
    "是否",
    "可以",
    "能不能",
    "要不要",
    "有沒有",
    "什麼",
    "哪裡",
    "何時",
    "幾點",
    "工期",
    "報價",
    "請款",
    "發票",
    "統編",
    "修改",
    "變更",
    "改",
    "修補",
    "缺失",
    "很爛",
    "品質不好",
    "不好",
    "漏水"
  ];

  return keywords.some((keyword) => value.includes(keyword));
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
      ["change", "payment", "invoice", "complaint", "schedule", "file"].includes(task.taskType) &&
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
    formatAiTaskSection("今日新增風險草稿", newRiskDrafts, data.projects),
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

function buildCustomerMessageActionMessage(message: MessageRow, projects: Map<string, ProjectSummary>): LinePushMessage[] {
  const siteUrl = getSiteUrl();
  const project = projects.get(message.projectId);
  const key = createReminderKey("message", message.id, "customer_message_unanswered");
  const encodedKey = encodeURIComponent(key);
  const actions: Extract<LinePushMessage, { type: "template" }>["template"]["actions"] = [
    {
      type: "postback",
      label: "已回覆",
      data: `action=confirm_reminder&key=${encodedKey}`,
      displayText: `已回覆：${shortText(message.text, 40)}`
    },
    {
      type: "postback",
      label: "明天追蹤",
      data: `action=snooze_reminder&key=${encodedKey}&days=1`,
      displayText: `明天追蹤：${shortText(message.text, 40)}`
    }
  ];

  if (siteUrl) {
    actions.push({
      type: "uri",
      label: "打開訊息",
      uri: message.projectId ? `${siteUrl}/projects/${encodeURIComponent(message.projectId)}/messages` : `${siteUrl}/messages`
    });
  }

  return [
    {
      type: "template",
      altText: `客戶訊息未回覆：${shortText(message.text, 80)}`,
      template: {
        type: "buttons",
        title: "客戶訊息未回覆",
        text: `[${projectName(project)}] ${shortText(message.text, 120)}`.slice(0, 160),
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

async function upsertCustomerMessageReminderLogs(items: MessageRow[], today: string) {
  const db = getAdminDb();

  await Promise.all(
    items.map((item) => {
      const key = createReminderKey("message", item.id, "customer_message_unanswered");
      return db.collection("reminder_logs").doc(key).set(
        {
          key,
          sourceType: "message",
          sourceId: item.id,
          reminderType: "customer_message_unanswered",
          projectId: item.projectId,
          title: shortText(item.text, 80),
          sourceLabel: "LINE 客戶訊息超過 2 小時未回覆",
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
  return listAdminNotificationGroups(db, "daily");
}

async function loadWorkflowData(): Promise<WorkflowData> {
  const db = getAdminDb();
  const today = taipeiDateString();
  const tomorrow = datePlusDays(today, 1);
  const [projectSnapshot, taskSnapshot, stageSnapshot, milestoneSnapshot, aiTaskSnapshot, messageSnapshot] = await Promise.all([
    db.collection("projects").get(),
    db.collection("tasks").get(),
    db.collection("projectStages").get(),
    db.collection("milestones").get(),
    db.collection("ai_tasks").get(),
    db.collection("messages").get()
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
    messages: messageSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        groupId: String(data.groupId ?? ""),
        senderName: String(data.senderName ?? ""),
        senderRole: normalizeSenderRole(String(data.senderRole ?? "unknown")),
        messageType: String(data.messageType ?? "text"),
        text: String(data.text ?? ""),
        timestamp: timestampToDate(data.timestamp) ?? timestampToDate(data.createdAt)
      };
    }),
    tasks: taskSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        title: String(data.title ?? "未命名待辦"),
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
        sourceMessageId: String(data.sourceMessageId ?? ""),
        title: String(data.title ?? "未命名 AI 待辦"),
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

function formatMessageSection(title: string, items: MessageRow[], projects: Map<string, ProjectSummary>) {
  if (!items.length) return `${title}：0 件`;

  return [
    `${title}：${items.length} 件`,
    ...items.slice(0, 8).map((item) => `- [${projectName(projects.get(item.projectId))}] ${shortText(item.text, 42)}`),
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

function normalizeSenderRole(role: string): LineSenderRole {
  if (role === "internal" || role === "client" || role === "vendor") return role;
  return "unknown";
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

function shortText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function getReviewUrl() {
  const siteUrl = getSiteUrl();
  return siteUrl ? `${siteUrl}/ai-tasks` : "";
}

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
}
