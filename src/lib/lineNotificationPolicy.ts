import { getAiTaskRiskLevel } from "./riskRules";
import type { AiTaskType } from "./types";

export type AdminNotificationAudiencePolicy = "primary" | "daily" | "critical";

export type AiDraftNotificationSuggestion = {
  title: string;
  taskType: AiTaskType;
};

export type AiDraftCreateResultForNotification = {
  draftIds: string[];
  newDraftIds: string[];
};

export type MergedAiTaskForNotification = {
  title: string;
  taskType: AiTaskType;
};

export function hasCriticalAiDraftSuggestion(suggestions: AiDraftNotificationSuggestion[]) {
  return suggestions.some((suggestion) => getAiTaskRiskLevel(suggestion.taskType, suggestion.title) === "critical");
}

export function getAiDraftImmediateNotificationAudience(
  suggestions: AiDraftNotificationSuggestion[]
): AdminNotificationAudiencePolicy | null {
  return hasCriticalAiDraftSuggestion(suggestions) ? "critical" : null;
}

export function shouldNotifyAiDraftsImmediately(input: {
  result: AiDraftCreateResultForNotification;
  suggestions: AiDraftNotificationSuggestion[];
  reusableDraftAlreadyNotified?: boolean;
}) {
  if (!input.result.draftIds.length) return false;
  if (!hasCriticalAiDraftSuggestion(input.suggestions)) return false;
  if (input.result.newDraftIds.length) return true;

  return !input.reusableDraftAlreadyNotified;
}

export function hasCriticalMergedAiTask(items: MergedAiTaskForNotification[]) {
  return items.some((item) => getAiTaskRiskLevel(item.taskType, item.title) === "critical");
}

export function shouldNotifyMergedAiTasksImmediately(items: MergedAiTaskForNotification[]) {
  return hasCriticalMergedAiTask(items);
}

export function getMergedAiTaskImmediateNotificationAudience(
  items: MergedAiTaskForNotification[]
): AdminNotificationAudiencePolicy | null {
  return hasCriticalMergedAiTask(items) ? "critical" : null;
}
