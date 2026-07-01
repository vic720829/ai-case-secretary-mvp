import { isDateOverdue } from "./date";
import { isHighOrCriticalRisk } from "./riskRules";
import type { Milestone, Project, ProjectStage } from "./types";

export function getProjectProgress(stages: ProjectStage[]) {
  if (!stages.length) return 0;

  const completed = stages.filter((stage) => stage.status === "done").length;
  return Math.round((completed / stages.length) * 100);
}

export function getCurrentStage(project: Project, stages: ProjectStage[]) {
  const doingStage = stages.find((stage) => stage.status === "doing");
  if (doingStage) return doingStage.stageName;

  const nextStage = stages.find((stage) => stage.status !== "done");
  if (nextStage) return nextStage.stageName;

  const lastStage = stages[stages.length - 1];
  return lastStage?.stageName || project.currentStage || "未設定";
}

export function getProjectRiskReasons(stages: ProjectStage[], milestones: Milestone[]) {
  const reasons: string[] = [];

  const overdueMilestones = milestones.filter(
    (milestone) => !milestone.completed && isDateOverdue(milestone.dueDate)
  );
  const overdueStages = stages.filter(
    (stage) => stage.status !== "done" && isDateOverdue(stage.endDate)
  );
  const highRiskMilestones = milestones.filter(
    (milestone) => !milestone.completed && isHighOrCriticalRisk(milestone.riskLevel)
  );

  if (overdueMilestones.length) {
    reasons.push(`里程碑已逾期 ${overdueMilestones.length} 項`);
  }

  if (overdueStages.length) {
    reasons.push(`工期節點逾期未完成 ${overdueStages.length} 項`);
  }

  if (highRiskMilestones.length) {
    reasons.push(`高/重大風險標記 ${highRiskMilestones.length} 項`);
  }

  return reasons;
}
