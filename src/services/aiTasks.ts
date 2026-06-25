import { Timestamp } from "firebase-admin/firestore";
import type { AiTaskType, LineSenderRole } from "@/lib/types";

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

export async function analyzeMessageForAiTasks(
  text: string,
  senderRole: LineSenderRole = "unknown"
): Promise<AiTaskSuggestion[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const openAiSuggestions = await analyzeWithOpenAi(trimmed, senderRole);
  if (openAiSuggestions.length) return openAiSuggestions;

  return analyzeWithRules(trimmed, senderRole);
}

async function analyzeWithOpenAi(text: string, senderRole: LineSenderRole): Promise<AiTaskSuggestion[]> {
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
        input: [
          "你是室內設計公司的案件秘書，請只回 JSON array。",
          "若訊息不需要追蹤，回 []。",
          "item 欄位只能包含 title, description, taskType, assignedTo, dueDate。",
          "taskType 只能是 promise, change, followup, payment, invoice。",
          "dueDate 若可推論才填 YYYY-MM-DD。",
          `今天日期：${datePlusDays(0)}（Asia/Taipei）`,
          "",
          "判斷規則：",
          "- senderRole=internal：我確認、我回覆、我安排、我提供，通常是公司承諾 promise。",
          "- senderRole=client：我回覆、我確認、我挑好，通常是等待客戶回覆 followup，不是公司承諾。",
          "- senderRole=vendor：我安排、我確認，通常是追蹤廠商承諾 followup。",
          "- 客戶詢問工期表、報價、圖面、進度、什麼時候給，建立 followup。",
          "- 內部人員或身份未登記者回覆「好明天給你」「明天給您」「今晚傳給你」，建立 promise 或 followup。",
          "- 客戶提出改顏色、改尺寸、新增、取消、不要做，建立 change。",
          "- 款項、請款、尾款、二期款建立 payment。",
          "- 發票、統編、報帳建立 invoice。",
          "",
          `senderRole: ${senderRole}`,
          `LINE 訊息: ${text}`
        ].join("\n")
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
    const parsed = JSON.parse(stripJsonFence(outputText)) as Array<Partial<AiTaskSuggestion>>;

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

function analyzeWithRules(text: string, senderRole: LineSenderRole): AiTaskSuggestion[] {
  const suggestions: AiTaskSuggestion[] = [];
  const dueDate = inferDueDate(text);

  if (/(發票|統編|報帳|收據)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "發票事項"),
      description: text,
      taskType: "invoice",
      dueDate
    });
  }

  if (/(請款|付款|收款|尾款|二期款|第二期|訂金|款項)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "收款事項"),
      description: text,
      taskType: "payment",
      dueDate
    });
  }

  if (/(改|變更|新增|取消|不要|不做|顏色|尺寸|抽屜|電視牆|門片|磁磚|木地板|特殊塗料)/.test(text)) {
    suggestions.push({
      title: makeTitle(text, "客戶變更"),
      description: text,
      taskType: "change",
      dueDate
    });
  }

  if (isClientRequestQuestion(text)) {
    suggestions.push({
      title: makeTitle(text, senderRole === "client" ? "待回覆客戶" : "待追蹤需求"),
      description: text,
      taskType: "followup",
      dueDate
    });
  }

  if (hasCommitmentWords(text)) {
    if (senderRole === "internal") {
      suggestions.push({
        title: makeTitle(text, "公司承諾"),
        description: text,
        taskType: "promise",
        dueDate
      });
    } else if (senderRole === "client") {
      suggestions.push({
        title: makeTitle(text, "等待客戶回覆"),
        description: text,
        taskType: "followup",
        dueDate
      });
    } else if (senderRole === "vendor") {
      suggestions.push({
        title: makeTitle(text, "追蹤廠商承諾"),
        description: text,
        taskType: "followup",
        dueDate
      });
    } else {
      suggestions.push({
        title: makeTitle(text, "待判斷承諾"),
        description: text,
        taskType: "followup",
        dueDate
      });
    }
  }

  return dedupeSuggestions(suggestions);
}

function hasCommitmentWords(text: string) {
  return /(我|我們|這邊|師傅|廠商).{0,8}(確認|回覆|提供|安排|處理|報價|給你|給您|傳給你|傳給您|再看|挑好)|(?:好)?(?:今天|明天|後天|今晚|等一下|稍後).{0,8}(確認|回覆|提供|安排|處理|報價|給你|給您|傳給你|傳給您|補給你|補給您)|會.{0,8}(確認|回覆|提供|安排|處理|報價|給你|給您|傳給你|傳給您)/.test(text);
}

function isClientRequestQuestion(text: string) {
  return /(工期表|工程表|排程|時程|進度表|報價|估價|圖面|平面圖|立面圖|效果圖|合約|請款單|發票).{0,12}(呢|嗎|了嗎|\?|？|什麼時候|何時)|(?:我的|我們的).{0,8}(工期表|工程表|排程|時程|進度表|報價|估價|圖面)/.test(text);
}

function inferDueDate(text: string) {
  const explicitDate = inferExplicitDate(text);
  if (explicitDate) return explicitDate;
  if (/下月底/.test(text)) return endOfMonth(1);
  if (/月底|本月底|這月底/.test(text)) return endOfMonth(0);
  if (/大後天/.test(text)) return datePlusDays(3);
  if (/今天|等一下|稍後/.test(text)) return datePlusDays(0);
  if (/明天/.test(text)) return datePlusDays(1);
  if (/後天/.test(text)) return datePlusDays(2);
  const weekdayDate = inferWeekdayDate(text);
  if (weekdayDate) return weekdayDate;
  return undefined;
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function inferExplicitDate(text: string) {
  const slashMatch = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  const zhMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  const match = zhMatch ?? slashMatch;
  if (!match) return undefined;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!isValidMonthDay(month, day)) return undefined;

  const today = taipeiTodayDate();
  let date = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (date < today) {
    date = new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  }

  return toDateString(date);
}

function inferWeekdayDate(text: string) {
  const match = text.match(/(下週|下星期|下禮拜|本週|這週|這星期|這禮拜|週|星期|禮拜)([一二三四五六日天])/);
  if (!match) return undefined;

  const prefix = match[1];
  const targetWeekday = weekdayNumber(match[2]);
  if (targetWeekday < 0) return undefined;

  const today = taipeiTodayDate();
  const todayWeekday = today.getUTCDay();
  const baseDays = targetWeekday - todayWeekday;
  const isNextWeek = prefix.startsWith("下");
  let offset = baseDays;

  if (isNextWeek) {
    offset = baseDays + 7;
    if (offset <= 0) offset += 7;
  } else if (offset < 0) {
    offset += 7;
  }

  const date = new Date(today);
  date.setUTCDate(today.getUTCDate() + offset);
  return toDateString(date);
}

function datePlusDays(days: number) {
  const date = taipeiTodayDate();
  date.setUTCDate(date.getUTCDate() + days);

  return toDateString(date);
}

function taipeiTodayDate() {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");

  return new Date(Date.UTC(year, month - 1, day));
}

function endOfMonth(monthOffset: number) {
  const today = taipeiTodayDate();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthOffset + 1, 0));
  return toDateString(date);
}

function isValidMonthDay(month: number, day: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(2024, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function weekdayNumber(value: string) {
  return {
    日: 0,
    天: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6
  }[value] ?? -1;
}

function toDateString(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function dedupeSuggestions(suggestions: AiTaskSuggestion[]) {
  const seen = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = `${suggestion.taskType}-${suggestion.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeTitle(text: string, prefix: string) {
  const compact = text.replace(/\s+/g, " ").slice(0, 28);
  return `${prefix}: ${compact}`;
}
