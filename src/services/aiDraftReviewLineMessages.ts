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

  const editUrl = reviewUrl ? `${reviewUrl}?draftId=${encodeURIComponent(item.id)}` : "";
  const dueDate = item.dueDate ? `截止：${item.dueDate.replaceAll("-", "/")}` : "截止：未設定";
  const typeLabel = item.taskType ? String(item.taskType) : "待判斷";
  const actions: Extract<LinePushMessage, { type: "template" }>["template"]["actions"] = [
    {
      type: "postback",
      label: "通過建立任務",
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
