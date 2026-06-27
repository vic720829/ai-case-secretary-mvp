import type { AiTaskType } from "../lib/types";
import type { LinePushMessage } from "./line";

export type AiDraftReviewLineItem = {
  id: string;
  title: string;
  taskType?: AiTaskType | string;
  dueDate?: string;
};

export function buildAiDraftReviewLineMessages(input: {
  summaryText: string;
  projectName: string;
  reviewUrl: string;
  items: AiDraftReviewLineItem[];
}): LinePushMessage[] {
  const messages: LinePushMessage[] = [
    { type: "text" as const, text: input.summaryText },
    ...input.items.slice(0, 4).flatMap((item) => buildAiDraftReviewTemplateMessage(input.projectName, input.reviewUrl, item))
  ];

  return messages.slice(0, 5);
}

export function buildAiDraftReviewTemplateMessage(
  projectName: string,
  reviewUrl: string,
  item: AiDraftReviewLineItem
): LinePushMessage[] {
  if (!item.id) return [];

  const safeReviewUrl = normalizeHttpUrl(reviewUrl);
  const editUrl = safeReviewUrl ? appendQueryParam(safeReviewUrl, "draftId", item.id) : "";
  const dueDate = item.dueDate ? `截止：${item.dueDate.replaceAll("-", "/")}` : "截止：未設定";
  const typeLabel = item.taskType ? String(item.taskType) : "待判斷";
  const actions: Extract<LinePushMessage, { type: "template" }>["template"]["actions"] = [
    {
      type: "postback",
      label: "通過建立待辦",
      data: `action=approve_ai_task&key=${item.id}`,
      displayText: `通過 AI 草稿：${item.title}`
    },
    {
      type: "postback",
      label: "拒絕草稿",
      data: `action=reject_ai_task&key=${item.id}`,
      displayText: `拒絕 AI 草稿：${item.title}`
    }
  ];

  if (editUrl) {
    actions.push({
      type: "uri",
      label: "網站編輯",
      uri: editUrl
    });
  }

  return [
    {
      type: "template",
      altText: `AI 草稿待審核：${item.title}`,
      template: {
        type: "buttons",
        title: `AI 草稿：${projectName}`.slice(0, 40),
        text: `${item.title}\n${typeLabel}｜${dueDate}`,
        actions
      }
    }
  ];
}

function normalizeHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("/")) return "";

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";

    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function appendQueryParam(url: string, key: string, value: string) {
  const nextUrl = new URL(url);
  nextUrl.searchParams.set(key, value);
  return nextUrl.toString();
}
