import { Timestamp } from "firebase-admin/firestore";
import type { AiTaskType } from "@/lib/types";

export type AiTaskSuggestion = {
  title: string;
  description: string;
  taskType: AiTaskType;
  assignedTo?: string;
  dueDate?: string;
};

const taskTypes: AiTaskType[] = ["promise", "change", "followup", "payment", "invoice"];

export function dateStringToTimestamp(value?: string) {
  if (!value) return null;

  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  return Timestamp.fromDate(parsed);
}

export async function analyzeMessageForAiTasks(text: string): Promise<AiTaskSuggestion[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const openAiSuggestions = await analyzeWithOpenAi(trimmed);
  if (openAiSuggestions.length) return openAiSuggestions;

  return analyzeWithRules(trimmed);
}

async function analyzeWithOpenAi(text: string): Promise<AiTaskSuggestion[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return [];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: `你是室內設計公司案件秘書。請只輸出 JSON array。若訊息沒有任務，輸出 []。每個 item 欄位：title, description, taskType, assignedTo, dueDate。taskType 只能是 promise, change, followup, payment, invoice。dueDate 若無法判斷請省略，若可判斷用 YYYY-MM-DD。\n\nLINE 訊息：${text}`
      })
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const outputText =
      data.output_text ??
      data.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n") ??
      "";
    const parsed = JSON.parse(outputText) as Array<Partial<AiTaskSuggestion>>;

    return parsed
      .filter((item) => item.title && item.taskType && taskTypes.includes(item.taskType))
      .map((item) => ({
        title: String(item.title),
        description: String(item.description ?? text),
        taskType: item.taskType as AiTaskType,
        assignedTo: item.assignedTo ? String(item.assignedTo) : "",
        dueDate: item.dueDate ? String(item.dueDate) : undefined
      }));
  } catch {
    return [];
  }
}

function analyzeWithRules(text: string): AiTaskSuggestion[] {
  const suggestions: AiTaskSuggestion[] = [];

  if (/(確認|回覆|提供|安排|處理|幫您|我再|我明天|明天回覆)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "承諾追蹤"),
      description: text,
      taskType: "promise"
    });
  }

  if (/(改顏色|改尺寸|新增|不做|變更|修改|換成|取消)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "客戶變更"),
      description: text,
      taskType: "change"
    });
  }

  if (/(尚未確認|尚未回覆|再追|追蹤|等客戶|提醒)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "待追蹤事項"),
      description: text,
      taskType: "followup"
    });
  }

  if (/(第二期款|尾款|請款|收款|付款|匯款)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "收款事項"),
      description: text,
      taskType: "payment"
    });
  }

  if (/(發票|統編|報帳|抬頭)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "發票事項"),
      description: text,
      taskType: "invoice"
    });
  }

  return suggestions;
}

function makeTitle(text: string, prefix: string) {
  const compact = text.replace(/\s+/g, " ").slice(0, 28);
  return `${prefix}: ${compact}`;
}
