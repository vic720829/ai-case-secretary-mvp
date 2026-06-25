import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

type ProjectSummary = {
  id: string;
  name: string;
  clientName: string;
  currentStage: string;
};

type TaskSummary = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  dueDate: string;
  riskLevel: string;
};

type MilestoneSummary = {
  id: string;
  projectId: string;
  title: string;
  dueDate: string;
  completed: boolean;
  riskLevel: string;
};

type StageSummary = {
  id: string;
  projectId: string;
  stageName: string;
  startDate: string;
  endDate: string;
  status: string;
  sortOrder: number;
};

type AiTaskSummary = {
  id: string;
  projectId: string;
  title: string;
  taskType: string;
  status: string;
  dueDate: string;
  reviewStatus: string;
};

type AssistantData = {
  today: string;
  tomorrow: string;
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  milestones: MilestoneSummary[];
  stages: StageSummary[];
  aiTasks: AiTaskSummary[];
};

type AssistantIntent =
  | "today"
  | "tomorrow"
  | "risk"
  | "payment"
  | "invoice"
  | "project_progress"
  | "forgotten"
  | "unknown";

type AssistantIntentResult = {
  intent: AssistantIntent;
  projectName: string;
  confidence: number;
};

const assistantIntents: AssistantIntent[] = [
  "today",
  "tomorrow",
  "risk",
  "payment",
  "invoice",
  "project_progress",
  "forgotten",
  "unknown"
];

const conversationalQuestionKeywords = [
  "今天",
  "明天",
  "風險",
  "逾期",
  "高風險",
  "收款",
  "款項",
  "錢",
  "發票",
  "做到哪",
  "做到哪裡",
  "進度",
  "現在怎樣",
  "那邊怎樣",
  "狀況",
  "忘記",
  "沒回",
  "還沒回",
  "確認了嗎",
  "有沒有",
  "要處理",
  "要追"
];

export function shouldAnswerLineQuestion(text: string) {
  const normalized = normalizeText(text);

  if (/[\?？]/.test(text)) return true;
  if (conversationalQuestionKeywords.some((keyword) => normalized.includes(normalizeText(keyword)))) return true;

  return [
    "今天",
    "明天",
    "待辦",
    "事情",
    "風險",
    "款",
    "付款",
    "收款",
    "請款",
    "發票",
    "統編",
    "忘記",
    "逾期",
    "做到哪",
    "做到哪裡",
    "進度",
    "做到",
    "哪裡",
    "有哪些",
    "有什麼",
    "還沒"
  ].some((keyword) => normalized.includes(keyword));
}

export async function answerQuestionFromFirestore(question: string, contextProjectId = "") {
  const data = await loadAssistantData();
  const understood = await understandAssistantIntent(question, data.projects);
  const intent = understood.intent;
  const matchedProject =
    findProjectInQuestion(understood.projectName || question, data.projects, contextProjectId) ??
    findProjectInQuestion(question, data.projects, contextProjectId);

  if (intent === "today") {
    return summarizeDateItems(data, data.today, "今天", matchedProject?.id ?? contextProjectId);
  }

  if (intent === "tomorrow") {
    return summarizeDateItems(data, data.tomorrow, "明天", matchedProject?.id ?? contextProjectId);
  }

  if (intent === "risk") {
    return summarizeRiskProjects(data, matchedProject?.id ?? contextProjectId);
  }

  if (intent === "payment") {
    return summarizeAiTaskType(data, "payment", "款項", matchedProject?.id ?? contextProjectId);
  }

  if (intent === "invoice") {
    return summarizeAiTaskType(data, "invoice", "發票", matchedProject?.id ?? contextProjectId);
  }

  if (intent === "project_progress") {
    if (!matchedProject) {
      return "我還找不到你問的是哪個案件。可以用「案件名稱 + 做到哪裡」，例如：三重元泰做到哪裡？";
    }

    return summarizeProjectProgress(data, matchedProject);
  }

  if (intent === "forgotten") {
    return summarizeForgottenItems(data, matchedProject?.id ?? contextProjectId);
  }

  if (matchedProject) {
    return summarizeProjectProgress(data, matchedProject);
  }

  return [
    "我可以查這幾種問題：",
    "1. 今天有什麼事情？",
    "2. 明天有什麼事情？",
    "3. 有哪些案件有風險？",
    "4. 有哪些款項要收？",
    "5. 有哪些發票還沒開？",
    "6. 某個案件做到哪裡？",
    "7. 最近有哪些事情被忘記？"
  ].join("\n");
}

async function understandAssistantIntent(question: string, projects: ProjectSummary[]): Promise<AssistantIntentResult> {
  const fallback: AssistantIntentResult = {
    intent: detectIntent(question),
    projectName: "",
    confidence: 0
  };
  const openAiIntent = await understandAssistantIntentWithOpenAi(question, projects);

  if (!openAiIntent || openAiIntent.intent === "unknown") return fallback;

  return openAiIntent;
}

async function understandAssistantIntentWithOpenAi(
  question: string,
  projects: ProjectSummary[]
): Promise<AssistantIntentResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return null;

  try {
    const projectList = projects
      .slice(0, 80)
      .map((project) => `- ${project.name}${project.clientName ? ` / ${project.clientName}` : ""}`)
      .join("\n");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          "你是室內設計工程公司的 LINE 後台秘書，只做問題意圖分類。",
          "請只回 JSON，不要解釋，也不要回答問題本身。",
          "",
          "可用 intent：today, tomorrow, risk, payment, invoice, project_progress, forgotten, unknown",
          "",
          "分類規則：",
          "- 問今天事項、今天到期：today",
          "- 問明天事項、明天到期：tomorrow",
          "- 問風險、異常、怪怪的、危險案件：risk",
          "- 問款項、收款、付款、錢、尾款、二期款：payment",
          "- 問發票、統編、報帳：invoice",
          "- 問某案件做到哪裡、進度、目前狀況、下一步：project_progress",
          "- 問忘記、逾期、沒回、還沒確認、卡住：forgotten",
          "",
          "projectName 請從案件清單抓最可能的案件名稱或客戶名稱；沒有就空字串。",
          "confidence 用 0 到 1。",
          "",
          "案件清單：",
          projectList || "- 目前沒有案件",
          "",
          `使用者問題：${question}`,
          "",
          'JSON 格式：{"intent":"project_progress","projectName":"三重元泰","confidence":0.8}'
        ].join("\n")
      })
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const parsed = JSON.parse(stripJsonFence(readOpenAiOutputText(data))) as Partial<AssistantIntentResult>;
    const intent = normalizeAssistantIntent(parsed.intent);

    if (!intent) return null;

    return {
      intent,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName : "",
      confidence: clampConfidence(parsed.confidence)
    };
  } catch {
    return null;
  }
}

async function loadAssistantData(): Promise<AssistantData> {
  const db = getAdminDb();
  const today = taipeiDateString();
  const tomorrow = datePlusDays(today, 1);
  const [projectSnapshot, taskSnapshot, milestoneSnapshot, stageSnapshot, aiTaskSnapshot] = await Promise.all([
    db.collection("projects").get(),
    db.collection("tasks").get(),
    db.collection("milestones").get(),
    db.collection("projectStages").get(),
    db.collection("ai_tasks").get()
  ]);

  return {
    today,
    tomorrow,
    projects: projectSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.name ?? ""),
        clientName: String(data.clientName ?? ""),
        currentStage: String(data.currentStage ?? "")
      };
    }),
    tasks: taskSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        title: String(data.title ?? "未命名任務"),
        status: String(data.status ?? "todo"),
        dueDate: String(data.dueDate ?? ""),
        riskLevel: String(data.riskLevel ?? "low")
      };
    }),
    milestones: milestoneSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        title: String(data.title ?? "未命名關鍵節點"),
        dueDate: String(data.dueDate ?? ""),
        completed: Boolean(data.completed ?? false),
        riskLevel: String(data.riskLevel ?? "low")
      };
    }),
    stages: stageSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        stageName: String(data.stageName ?? "未命名工期"),
        startDate: String(data.startDate ?? ""),
        endDate: String(data.endDate ?? ""),
        status: String(data.status ?? "todo"),
        sortOrder: Number(data.sortOrder ?? 0)
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
        dueDate: timestampToTaipeiDate(data.dueDate),
        reviewStatus: String(data.reviewStatus ?? "pending")
      };
    })
  };
}

function readOpenAiOutputText(data: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  return (
    data.output_text ??
    data.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n") ??
    ""
  );
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeAssistantIntent(value: unknown): AssistantIntent | null {
  if (typeof value !== "string") return null;
  const intent = value.trim() as AssistantIntent;
  return assistantIntents.includes(intent) ? intent : null;
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function detectIntent(question: string): AssistantIntent {
  const normalized = normalizeText(question);

  if (/(明天|明日)/.test(normalized)) return "tomorrow";
  if (/(今天|今日)/.test(normalized)) return "today";
  if (/(收款|款項|付款|尾款|二期款|錢|請款)/.test(normalized)) return "payment";
  if (/(發票|統編|報帳)/.test(normalized)) return "invoice";
  if (/(忘記|逾期|沒回|還沒回|尚未回|還沒確認|尚未確認|卡住)/.test(normalized)) return "forgotten";
  if (/(風險|高風險|異常|怪怪|危險|預警)/.test(normalized)) return "risk";
  if (/(做到哪|做到哪裡|進度|目前狀況|現在怎樣|那邊怎樣|下一步|目前階段)/.test(normalized)) {
    return "project_progress";
  }

  if (normalized.includes("明天")) return "tomorrow";
  if (normalized.includes("今天")) return "today";
  if (/(款|付款|收款|請款|尾款|訂金|二期款|第二期)/.test(normalized)) return "payment";
  if (/(發票|統編|報帳|收據)/.test(normalized)) return "invoice";
  if (/(忘記|漏掉|逾期|沒做|還沒處理)/.test(normalized)) return "forgotten";
  if (/(風險|危險|卡住|延誤)/.test(normalized)) return "risk";
  if (/(做到哪|做到哪裡|進度|目前階段|到哪裡|做到什麼)/.test(normalized)) return "project_progress";

  return "unknown";
}

function summarizeDateItems(data: AssistantData, date: string, label: string, projectId = "") {
  const tasks = data.tasks
    .filter((task) => isActiveStatus(task.status))
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => task.dueDate === date);
  const milestones = data.milestones
    .filter((milestone) => !milestone.completed)
    .filter((milestone) => !projectId || milestone.projectId === projectId)
    .filter((milestone) => milestone.dueDate === date);
  const startingStages = data.stages
    .filter((stage) => stage.status !== "done")
    .filter((stage) => !projectId || stage.projectId === projectId)
    .filter((stage) => stage.startDate === date);
  const endingStages = data.stages
    .filter((stage) => stage.status !== "done")
    .filter((stage) => !projectId || stage.projectId === projectId)
    .filter((stage) => stage.endDate === date);

  const lines = [
    ...tasks.map((task) => `任務：${task.title}${projectSuffix(task.projectId, data.projects)}`),
    ...milestones.map((milestone) => `關鍵節點：${milestone.title}${projectSuffix(milestone.projectId, data.projects)}`),
    ...startingStages.map((stage) => `工期進場：${stage.stageName}${projectSuffix(stage.projectId, data.projects)}`),
    ...endingStages.map((stage) => `工期結束：${stage.stageName}${projectSuffix(stage.projectId, data.projects)}`)
  ];

  if (!lines.length) {
    return `${label}沒有查到到期任務、關鍵節點或工期提醒。`;
  }

  return [`${label}有 ${lines.length} 件事：`, ...lines.slice(0, 12), moreLine(lines.length, 12)].filter(Boolean).join("\n");
}

function summarizeRiskProjects(data: AssistantData, projectId = "") {
  const targetProjects = data.projects.filter((project) => !projectId || project.id === projectId);
  const riskRows = targetProjects
    .map((project) => {
      const reasons = getProjectRiskReasons(data, project.id);
      return { project, reasons };
    })
    .filter((row) => row.reasons.length);

  if (!riskRows.length) {
    return projectId ? "這個案件目前沒有查到高風險、逾期任務或逾期關鍵節點。" : "目前沒有查到高風險案件。";
  }

  return [
    `目前有 ${riskRows.length} 個風險案件：`,
    ...riskRows.slice(0, 8).map((row) => `- ${projectName(row.project)}：${row.reasons.join("、")}`),
    moreLine(riskRows.length, 8)
  ].filter(Boolean).join("\n");
}

function summarizeAiTaskType(data: AssistantData, taskType: string, label: string, projectId = "") {
  const items = data.aiTasks
    .filter((task) => task.taskType === taskType)
    .filter((task) => task.reviewStatus !== "rejected")
    .filter((task) => isActiveStatus(task.status))
    .filter((task) => !projectId || task.projectId === projectId)
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));

  if (!items.length) {
    return `目前沒有查到待處理的${label}事項。`;
  }

  return [
    `目前有 ${items.length} 個${label}事項：`,
    ...items.slice(0, 10).map((item) => {
      const reviewLabel = item.reviewStatus === "approved" ? "已核准" : "待審核";
      return `- ${item.title}${item.dueDate ? `（${formatDate(item.dueDate)}）` : ""}${projectSuffix(item.projectId, data.projects)}｜${reviewLabel}`;
    }),
    moreLine(items.length, 10)
  ].filter(Boolean).join("\n");
}

function summarizeProjectProgress(data: AssistantData, project: ProjectSummary) {
  const stages = data.stages
    .filter((stage) => stage.projectId === project.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate));
  const milestones = data.milestones.filter((milestone) => milestone.projectId === project.id);
  const currentStage = getCurrentStage(project, stages);
  const progress = getProjectProgress(stages);
  const nextStage = stages.find((stage) => stage.status !== "done" && stage.stageName !== currentStage);
  const nextMilestone = milestones
    .filter((milestone) => !milestone.completed)
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"))[0];
  const riskReasons = getProjectRiskReasons(data, project.id);

  return [
    `${projectName(project)} 目前狀態：`,
    `目前階段：${currentStage}`,
    `完成比例：${progress}%`,
    `下一階段：${nextStage ? formatStage(nextStage) : "尚未設定或已全部完成"}`,
    `下一個關鍵節點：${nextMilestone ? `${nextMilestone.title}${nextMilestone.dueDate ? `（${formatDate(nextMilestone.dueDate)}）` : ""}` : "尚未設定"}`,
    `目前風險：${riskReasons.length ? riskReasons.join("、") : "未查到明顯風險"}`
  ].join("\n");
}

function summarizeForgottenItems(data: AssistantData, projectId = "") {
  const overdueTasks = data.tasks
    .filter((task) => isActiveStatus(task.status))
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => isOverdue(task.dueDate, data.today));
  const overdueMilestones = data.milestones
    .filter((milestone) => !milestone.completed)
    .filter((milestone) => !projectId || milestone.projectId === projectId)
    .filter((milestone) => isOverdue(milestone.dueDate, data.today));
  const overdueStages = data.stages
    .filter((stage) => stage.status !== "done")
    .filter((stage) => !projectId || stage.projectId === projectId)
    .filter((stage) => isOverdue(stage.endDate, data.today));
  const overdueAiTasks = data.aiTasks
    .filter((task) => task.reviewStatus === "approved")
    .filter((task) => isActiveStatus(task.status))
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => isOverdue(task.dueDate, data.today));

  const lines = [
    ...overdueTasks.map((task) => `任務逾期：${task.title}${projectSuffix(task.projectId, data.projects)}`),
    ...overdueMilestones.map((milestone) => `關鍵節點逾期：${milestone.title}${projectSuffix(milestone.projectId, data.projects)}`),
    ...overdueStages.map((stage) => `工期逾期：${stage.stageName}${projectSuffix(stage.projectId, data.projects)}`),
    ...overdueAiTasks.map((task) => `AI任務逾期：${task.title}${projectSuffix(task.projectId, data.projects)}`)
  ];

  if (!lines.length) {
    return "目前沒有查到逾期或可能被忘記的事項。";
  }

  return [`最近可能被忘記的事項有 ${lines.length} 件：`, ...lines.slice(0, 12), moreLine(lines.length, 12)]
    .filter(Boolean)
    .join("\n");
}

function getProjectRiskReasons(data: AssistantData, projectId: string) {
  const reasons: string[] = [];
  const overdueTasks = data.tasks.filter(
    (task) => task.projectId === projectId && isActiveStatus(task.status) && isOverdue(task.dueDate, data.today)
  );
  const highRiskTasks = data.tasks.filter(
    (task) => task.projectId === projectId && isActiveStatus(task.status) && task.riskLevel === "high"
  );
  const overdueMilestones = data.milestones.filter(
    (milestone) => milestone.projectId === projectId && !milestone.completed && isOverdue(milestone.dueDate, data.today)
  );
  const highRiskMilestones = data.milestones.filter(
    (milestone) => milestone.projectId === projectId && !milestone.completed && milestone.riskLevel === "high"
  );
  const overdueStages = data.stages.filter(
    (stage) => stage.projectId === projectId && stage.status !== "done" && isOverdue(stage.endDate, data.today)
  );

  if (overdueTasks.length) reasons.push(`逾期任務 ${overdueTasks.length} 件`);
  if (highRiskTasks.length) reasons.push(`高風險任務 ${highRiskTasks.length} 件`);
  if (overdueMilestones.length) reasons.push(`逾期關鍵節點 ${overdueMilestones.length} 件`);
  if (highRiskMilestones.length) reasons.push(`高風險關鍵節點 ${highRiskMilestones.length} 件`);
  if (overdueStages.length) reasons.push(`工期逾期 ${overdueStages.length} 件`);

  return reasons;
}

function findProjectInQuestion(question: string, projects: ProjectSummary[], contextProjectId: string) {
  if (contextProjectId) {
    const contextProject = projects.find((project) => project.id === contextProjectId);
    if (contextProject) return contextProject;
  }

  const normalizedQuestion = normalizeText(question);
  const sortedProjects = [...projects].sort((a, b) => {
    const aLength = `${a.name}${a.clientName}`.length;
    const bLength = `${b.name}${b.clientName}`.length;
    return bLength - aLength;
  });

  return sortedProjects.find((project) => {
    const names = [project.name, project.clientName].filter(Boolean).map(normalizeText);
    return names.some(
      (name) => name && (normalizedQuestion.includes(name) || (normalizedQuestion.length >= 2 && name.includes(normalizedQuestion)))
    );
  });
}

function getProjectProgress(stages: StageSummary[]) {
  if (!stages.length) return 0;
  return Math.round((stages.filter((stage) => stage.status === "done").length / stages.length) * 100);
}

function getCurrentStage(project: ProjectSummary, stages: StageSummary[]) {
  const doingStage = stages.find((stage) => stage.status === "doing");
  if (doingStage) return doingStage.stageName;

  const nextStage = stages.find((stage) => stage.status !== "done");
  if (nextStage) return nextStage.stageName;

  const lastStage = stages[stages.length - 1];
  return lastStage?.stageName || project.currentStage || "未設定";
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

function isActiveStatus(status: string) {
  return status !== "done";
}

function isOverdue(date: string, today: string) {
  return Boolean(date && date < today);
}

function formatDate(date: string) {
  return date.replaceAll("-", "/");
}

function formatStage(stage: StageSummary) {
  const dates = [stage.startDate, stage.endDate].filter(Boolean).map(formatDate).join(" - ");
  return dates ? `${stage.stageName}（${dates}）` : stage.stageName;
}

function projectName(project: ProjectSummary) {
  return project.clientName ? `${project.name} / ${project.clientName}` : project.name;
}

function projectSuffix(projectId: string, projects: ProjectSummary[]) {
  const project = projects.find((item) => item.id === projectId);
  return project ? `｜${project.name}` : "";
}

function moreLine(total: number, shown: number) {
  const hidden = total - shown;
  return hidden > 0 ? `另有 ${hidden} 件未列出。` : "";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}
