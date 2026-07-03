import type { AiTaskType, RiskLevel } from "./types";

const complaintOrRepairPattern =
  /(客訴|抱怨|不滿意|很爛|太爛|爛|品質不好|品質很差|品質差|做得不好|做不好|有問題|不OK|不ok|不行|缺失|瑕疵|缺點|修補|修繕|補漆|補土|補強|漏水|滲水|裂縫|刮傷|破損|脫落|歪掉|歪斜|不平|粗糙|收邊不好)/;

const explicitCriticalKeywordPattern =
  /(客訴|缺失|修補|很爛|品質不好|漏水|漏電|瑕疵|破裂|裂開|壞掉|發霉|不滿意|急件|嚴重|危險|設計修改|要修改|這邊要改|這裡要改|要改)/;

const riskByAiTaskType: Record<AiTaskType, RiskLevel> = {
  promise: "medium",
  change: "high",
  followup: "medium",
  payment: "high",
  invoice: "high",
  complaint: "critical",
  schedule: "high",
  file: "medium"
};

export function hasComplaintOrRepairRisk(title = "") {
  return explicitCriticalKeywordPattern.test(title) || complaintOrRepairPattern.test(title);
}

export function getAiTaskRiskLevel(taskType: AiTaskType, title = ""): RiskLevel {
  if (hasComplaintOrRepairRisk(title)) return "critical";

  return riskByAiTaskType[taskType];
}

export function isHighOrCriticalRisk(riskLevel: RiskLevel) {
  return riskLevel === "high" || riskLevel === "critical";
}
