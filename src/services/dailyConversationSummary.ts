import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import type { LinePushMessage } from "./line";

type ProjectSummary = {
  name: string;
  clientName: string;
};

type MessageRow = {
  id: string;
  projectId: string;
  senderName: string;
  senderRole: string;
  messageType: string;
  text: string;
  fileUrl: string;
  timestamp: Date | null;
};

export async function buildDailyConversationSummaryMessages(now = new Date()): Promise<LinePushMessage[]> {
  const db = getAdminDb();
  const today = taipeiDateString(now);
  const yesterday = datePlusDays(today, -1);
  const [projects, messages] = await Promise.all([loadProjects(db), loadRecentMessages(db, today)]);
  const grouped = groupMessagesForYesterdayProjects(messages, yesterday);

  if (!grouped.size) return [];

  const fallback = buildFallbackSummary(grouped, projects, yesterday);
  const aiSummary = await buildOpenAiSummary(grouped, projects, yesterday);
  const text = aiSummary || fallback;

  return [
    {
      type: "text",
      text: truncate(text, 4800)
    }
  ];
}

async function loadProjects(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection("projects").get();
  const projects = new Map<string, ProjectSummary>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    projects.set(doc.id, {
      name: String(data.name ?? "未命名案件"),
      clientName: String(data.clientName ?? "")
    });
  });

  return projects;
}

async function loadRecentMessages(db: FirebaseFirestore.Firestore, today: string) {
  const since = taipeiDateTime(datePlusDays(today, -7), 0, 0);
  const snapshot = await db.collection("messages").where("timestamp", ">=", Timestamp.fromDate(since)).get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        senderName: String(data.senderName ?? ""),
        senderRole: String(data.senderRole ?? "unknown"),
        messageType: String(data.messageType ?? "text"),
        text: String(data.text ?? ""),
        fileUrl: String(data.fileUrl ?? ""),
        timestamp: timestampToDate(data.timestamp) ?? timestampToDate(data.createdAt)
      };
    })
    .filter((message) => message.projectId && Boolean(message.timestamp))
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));
}

function groupMessagesForYesterdayProjects(messages: MessageRow[], yesterday: string) {
  const projectsWithYesterdayMessages = new Set(
    messages
      .filter((message) => message.timestamp && taipeiDateString(message.timestamp) === yesterday)
      .map((message) => message.projectId)
  );
  const grouped = new Map<string, MessageRow[]>();

  messages.forEach((message) => {
    if (!projectsWithYesterdayMessages.has(message.projectId)) return;
    grouped.set(message.projectId, [...(grouped.get(message.projectId) ?? []), message]);
  });

  return grouped;
}

async function buildOpenAiSummary(
  grouped: Map<string, MessageRow[]>,
  projects: Map<string, ProjectSummary>,
  yesterday: string
) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return "";

  const input = buildConversationContext(grouped, projects);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          "你是室內設計公司的案件秘書。請用繁體中文整理 LINE 案件對話摘要。",
          "只根據提供的對話內容，不要自行猜測。",
          "每個段落都必須寫案件名稱。",
          "重點整理：客戶需求、已回覆/承諾、變更事項、風險或未決事項。",
          "如果只有一般閒聊或無實質結論，也要簡短寫明。",
          "請控制在 3500 字以內，適合直接發到 LINE 後台群。",
          "",
          `摘要日期：${yesterday.replaceAll("-", "/")}（整理前 7 天對話作為上下文，聚焦昨天的新對話）`,
          "",
          input
        ].join("\n")
      })
    });

    if (!response.ok) return "";

    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const outputText =
      data.output_text ??
      data.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n") ??
      "";

    return outputText.trim() ? `AI案件秘書｜昨日 LINE 對話摘要\n日期：${yesterday.replaceAll("-", "/")}\n\n${outputText.trim()}` : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackSummary(
  grouped: Map<string, MessageRow[]>,
  projects: Map<string, ProjectSummary>,
  yesterday: string
) {
  const sections = [...grouped.entries()].map(([projectId, messages]) => {
    const yesterdayMessages = messages.filter((message) => message.timestamp && taipeiDateString(message.timestamp) === yesterday);
    const lines = yesterdayMessages.slice(-8).map((message) => {
      const sender = message.senderName || senderRoleLabel(message.senderRole);
      return `- ${formatTime(message.timestamp)} ${sender}：${messageText(message)}`;
    });

    return [`【${projectName(projects.get(projectId))}】`, `昨日新訊息：${yesterdayMessages.length} 則`, ...lines].join("\n");
  });

  return [
    "AI案件秘書｜昨日 LINE 對話摘要",
    `日期：${yesterday.replaceAll("-", "/")}`,
    "",
    "目前未能使用 AI 生成摘要，先列出昨日有新對話的案件與訊息重點：",
    "",
    sections.join("\n\n")
  ].join("\n");
}

function buildConversationContext(grouped: Map<string, MessageRow[]>, projects: Map<string, ProjectSummary>) {
  return truncate(
    [...grouped.entries()]
      .map(([projectId, messages]) => {
        const lines = messages.slice(-80).map((message) => {
          const sender = message.senderName || senderRoleLabel(message.senderRole);
          return `- ${taipeiDateString(message.timestamp!)} ${formatTime(message.timestamp)}｜${sender}（${senderRoleLabel(
            message.senderRole
          )}）：${messageText(message)}`;
        });

        return [`案件：${projectName(projects.get(projectId))}`, ...lines].join("\n");
      })
      .join("\n\n"),
    12000
  );
}

function messageText(message: MessageRow) {
  const text = message.text.trim();
  if (text) return text;
  if (message.messageType === "image") return message.fileUrl ? "圖片訊息（有附件）" : "圖片訊息";
  if (message.messageType === "audio") return message.fileUrl ? "語音訊息（有附件）" : "語音訊息";
  return "LINE 訊息";
}

function senderRoleLabel(role: string) {
  if (role === "internal") return "內部人員";
  if (role === "client") return "客戶";
  if (role === "vendor") return "廠商";
  return "身份未登記";
}

function projectName(project?: ProjectSummary) {
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

function formatTime(date: Date | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

function taipeiDateTime(dateString: string, hour: number, minute: number) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateString}T${hh}:${mm}:00+08:00`);
}

function datePlusDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
