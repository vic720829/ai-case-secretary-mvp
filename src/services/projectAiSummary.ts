import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { ProjectSummarySection } from "@/lib/types";

type SummaryResult = {
  projectId: string;
  summaryText: string;
  sections: ProjectSummarySection[];
  source: "ai" | "system";
  model: string;
};

type SummarySourceData = {
  project: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  aiTasks: Array<Record<string, unknown>>;
  incidents: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  memos: Array<Record<string, unknown>>;
  memories: Array<Record<string, unknown>>;
  stages: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
};

const summarySectionTitles = [
  "客戶需求整理",
  "已答應變更與決議",
  "尚未確認事項",
  "缺失 / 客訴 / 高風險",
  "工程進度與工期",
  "收款 / 發票",
  "最近 LINE 對話重點",
  "下一步建議"
];

export async function refreshProjectAiSummary(projectId: string, refreshedBy: string): Promise<SummaryResult> {
  const db = getAdminDb();
  const data = await collectProjectSummaryData(projectId);
  const aiSummary = await generateProjectSummaryWithAi(projectId, data).catch(() => null);
  const summary = aiSummary ?? buildSystemProjectSummary(projectId, data);

  const summaryRef = db.collection("project_summaries").doc(projectId);
  const summarySnapshot = await summaryRef.get();
  const payload: Record<string, unknown> = {
    projectId,
    summaryText: summary.summaryText,
    sections: summary.sections,
    source: summary.source,
    model: summary.model,
    refreshedBy,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (!summarySnapshot.exists) {
    payload.createdAt = FieldValue.serverTimestamp();
  }

  await summaryRef.set(payload, { merge: true });

  return summary;
}

async function collectProjectSummaryData(projectId: string): Promise<SummarySourceData> {
  const db = getAdminDb();
  const projectRef = db.collection("projects").doc(projectId);
  const [
    projectSnapshot,
    tasksSnapshot,
    aiTasksSnapshot,
    incidentsSnapshot,
    messagesSnapshot,
    memosSnapshot,
    memoriesSnapshot,
    stagesSnapshot,
    milestonesSnapshot
  ] = await Promise.all([
    projectRef.get(),
    db.collection("tasks").where("projectId", "==", projectId).get(),
    db.collection("ai_tasks").where("projectId", "==", projectId).get(),
    db.collection("incidents").where("projectId", "==", projectId).get(),
    db.collection("messages").where("projectId", "==", projectId).get(),
    db.collection("project_memos").where("projectId", "==", projectId).get(),
    db.collection("project_memories").where("projectId", "==", projectId).get(),
    db.collection("projectStages").where("projectId", "==", projectId).get(),
    db.collection("milestones").where("projectId", "==", projectId).get()
  ]);

  if (!projectSnapshot.exists) {
    throw new Error("PROJECT_NOT_FOUND");
  }

  return {
    project: { id: projectSnapshot.id, ...projectSnapshot.data() },
    tasks: sortByDateDesc(tasksSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "updatedAt").slice(0, 100),
    aiTasks: sortByDateDesc(aiTasksSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "updatedAt").slice(0, 100),
    incidents: sortByDateDesc(incidentsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "updatedAt").slice(0, 80),
    messages: sortByDateDesc(messagesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "timestamp").slice(0, 120),
    memos: sortByDateDesc(memosSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "updatedAt").slice(0, 80),
    memories: sortByDateDesc(memoriesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "updatedAt").slice(0, 80),
    stages: sortByDateAsc(stagesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "startDate").slice(0, 80),
    milestones: sortByDateAsc(milestonesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), "dueDate").slice(0, 80)
  };
}

async function generateProjectSummaryWithAi(projectId: string, data: SummarySourceData): Promise<SummaryResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        "你是室內設計公司的案件整理秘書。",
        "請根據同一案件的 LINE 對話、待辦、事件、備忘錄、AI 案件記憶、工期與關鍵節點，整理成內部使用的案件摘要。",
        "不要編造資料；沒有資料就寫「目前沒有明確紀錄」。",
        "不要寫給客戶看的話術，不要替公司承諾任何事。",
        "請只回 JSON，不要 markdown。",
        "JSON 格式：",
        '{"summaryText":"一段 120 字內總摘要","sections":[{"title":"客戶需求整理","items":["..."]}]}',
        `固定 sections title：${summarySectionTitles.join("、")}`,
        "Source integrity rules:",
        "- Keep LINE messages as the original source of truth.",
        "- Incidents are an organizing layer only; never treat them as a replacement for original LINE messages.",
        "- Use tasks, AI drafts, incidents, memos, project memories, stages, and milestones together.",
        "- If an incident summarizes several LINE messages, mention the conclusion but preserve uncertainty when original messages are unclear.",
        "- Write the final answer in Traditional Chinese.",
        "",
        JSON.stringify(compactSummaryData(data))
      ].join("\n")
    })
  });

  if (!response.ok) return null;

  const result = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const outputText =
    result.output_text ??
    result.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n") ??
    "";
  const parsed = JSON.parse(stripJsonFence(outputText)) as Partial<SummaryResult>;
  const sections = normalizeSections(parsed.sections);
  const summaryText = String(parsed.summaryText ?? "").trim() || buildSystemProjectSummary(projectId, data).summaryText;

  return {
    projectId,
    summaryText,
    sections: sections.length ? sections : buildSystemProjectSummary(projectId, data).sections,
    source: "ai",
    model
  };
}

function buildSystemProjectSummary(projectId: string, data: SummarySourceData): SummaryResult {
  const projectName = String(data.project.name ?? "未命名案件");
  const openTasks = data.tasks.filter((task) => String(task.status ?? "") !== "done");
  const highRiskTasks = openTasks.filter((task) => ["high", "critical"].includes(String(task.riskLevel ?? "")));
  const pendingAiTasks = data.aiTasks.filter((task) => String(task.reviewStatus ?? "pending") === "pending");
  const openIncidents = data.incidents.filter((incident) => String(incident.status ?? "open") === "open");
  const activeStages = data.stages.filter((stage) => String(stage.status ?? "") !== "done");
  const openMilestones = data.milestones.filter((milestone) => !Boolean(milestone.completed));
  const recentMessages = data.messages.slice(0, 8);

  const sections = normalizeSections([
    {
      title: "客戶需求整理",
      items: [
        ...data.memories.slice(0, 5).map((memory) => `${safeText(memory.title)}：${safeText(memory.content)}`),
        ...data.memos.slice(0, 5).map((memo) => `${safeText(memo.title)}：${safeText(memo.content)}`)
      ]
    },
    {
      title: "已答應變更與決議",
      items: data.aiTasks
        .filter((task) => ["change", "promise"].includes(String(task.taskType ?? "")) && String(task.reviewStatus ?? "") === "approved")
        .slice(0, 8)
        .map((task) => `${safeText(task.title)}${task.dueDate ? `，截止 ${formatUnknownDate(task.dueDate)}` : ""}`)
    },
    {
      title: "尚未確認事項",
      items: [
        ...pendingAiTasks.slice(0, 6).map((task) => `待審草稿：${safeText(task.title)}`),
        ...openTasks.slice(0, 6).map((task) => `待辦：${safeText(task.title)}`)
      ]
    },
    {
      title: "缺失 / 客訴 / 高風險",
      items: [
        ...highRiskTasks.slice(0, 8).map((task) => `${safeText(task.title)}（${safeText(task.riskLevel)}）`),
        ...openIncidents.slice(0, 8).map((incident) => `${safeText(incident.title)}（${safeText(incident.riskLevel)}）`)
      ]
    },
    {
      title: "工程進度與工期",
      items: [
        ...activeStages.slice(0, 8).map((stage) => `${safeText(stage.stageName)}：${safeText(stage.startDate)} 至 ${safeText(stage.endDate)}，${safeText(stage.status)}`),
        ...openMilestones.slice(0, 8).map((milestone) => `關鍵節點：${safeText(milestone.title)}，${safeText(milestone.dueDate)}`)
      ]
    },
    {
      title: "收款 / 發票",
      items: data.aiTasks
        .filter((task) => ["payment", "invoice"].includes(String(task.taskType ?? "")))
        .slice(0, 8)
        .map((task) => `${safeText(task.title)}（${safeText(task.taskType)} / ${safeText(task.reviewStatus)}）`)
    },
    {
      title: "最近 LINE 對話重點",
      items: recentMessages.map((message) => `${safeText(message.senderName)}：${safeText(message.text, 70)}`)
    },
    {
      title: "下一步建議",
      items: [
        pendingAiTasks.length ? `先處理 ${pendingAiTasks.length} 件待審草稿。` : "",
        highRiskTasks.length ? `優先處理 ${highRiskTasks.length} 件高風險待辦。` : "",
        openMilestones.length ? `確認 ${openMilestones.length} 個未完成關鍵節點。` : "",
        !pendingAiTasks.length && !highRiskTasks.length && !openMilestones.length ? "目前沒有明確高優先事項，建議持續更新工期與待辦。" : ""
      ]
    }
  ]);

  return {
    projectId,
    summaryText: `${projectName} 目前有 ${openTasks.length} 件未完成待辦、${pendingAiTasks.length} 件待審草稿、${openIncidents.length} 件未結事件。`,
    sections,
    source: "system",
    model: "system-fallback"
  };
}

function compactSummaryData(data: SummarySourceData) {
  return {
    sourceInventory: {
      lineMessages: data.messages.length,
      tasks: data.tasks.length,
      aiTaskDrafts: data.aiTasks.length,
      incidents: data.incidents.length,
      memos: data.memos.length,
      memories: data.memories.length,
      stages: data.stages.length,
      milestones: data.milestones.length,
      sourceRule: "LINE messages are preserved as original records. Incidents only organize and merge related messages."
    },
    project: pickFields(data.project, ["name", "clientName", "currentStage", "designer", "assistant", "status", "expectedFinishDate"]),
    tasks: data.tasks.slice(0, 80).map((item) => pickFields(item, ["title", "description", "assignee", "dueDate", "status", "source", "riskLevel"])),
    aiTasks: data.aiTasks.slice(0, 80).map((item) => pickFields(item, ["title", "description", "taskType", "status", "assignedTo", "dueDate", "reviewStatus"])),
    incidents: data.incidents.slice(0, 60).map((item) =>
      pickFields(item, [
        "title",
        "summary",
        "incidentType",
        "riskLevel",
        "status",
        "sourceMessageCount",
        "sourceMessageIds",
        "lineMessageIds",
        "lastMessageText",
        "lastSenderName",
        "lastSenderRole",
        "aiTaskIds",
        "taskIds",
        "attachmentMessageIds"
      ])
    ),
    messages: data.messages.slice(0, 80).map((item) => pickFields(item, ["senderName", "senderRole", "messageType", "text", "timestamp"])),
    memos: data.memos.slice(0, 60).map((item) => pickFields(item, ["title", "content", "createdBy"])),
    memories: data.memories.slice(0, 60).map((item) => pickFields(item, ["title", "content", "memoryType", "importance", "status"])),
    stages: data.stages.slice(0, 60).map((item) => pickFields(item, ["stageName", "startDate", "endDate", "status", "sortOrder"])),
    milestones: data.milestones.slice(0, 60).map((item) => pickFields(item, ["title", "description", "dueDate", "completed", "riskLevel"]))
  };
}

function pickFields(record: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.map((field) => [field, serializeValue(record[field])]));
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

function normalizeSections(value: unknown): ProjectSummarySection[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((section) => {
      if (!section || typeof section !== "object") return null;
      const record = section as Record<string, unknown>;
      const title = String(record.title ?? "").trim();
      const items = Array.isArray(record.items)
        ? record.items.map((item) => String(item).trim()).filter(Boolean)
        : [];

      if (!title) return null;
      return { title, items: items.length ? items : ["目前沒有明確紀錄"] };
    })
    .filter((section): section is ProjectSummarySection => Boolean(section));
}

function stripJsonFence(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function sortByDateDesc(items: Array<Record<string, unknown>>, field: string) {
  return [...items].sort((a, b) => getTime(b[field]) - getTime(a[field]));
}

function sortByDateAsc(items: Array<Record<string, unknown>>, field: string) {
  return [...items].sort((a, b) => getTime(a[field]) - getTime(b[field]));
}

function getTime(value: unknown) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return 0;
}

function safeText(value: unknown, maxLength = 90) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "未記錄";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatUnknownDate(value: unknown) {
  const serialized = serializeValue(value);
  return String(serialized ?? "").slice(0, 10);
}
