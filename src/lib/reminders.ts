import { todayInputValue } from "./date";
import type {
  AiTask,
  Milestone,
  ProjectStage,
  ReminderLogInput,
  ReminderSourceType,
  ReminderType,
  Task
} from "./types";

export type ReminderCandidate = ReminderLogInput;

export function createReminderKey(sourceType: ReminderSourceType, sourceId: string, reminderType: ReminderType) {
  return `${sourceType}_${sourceId}_${reminderType}`;
}

export function buildReminderCandidates({
  tasks,
  stages,
  milestones,
  aiTasks,
  today = todayInputValue(),
  now = new Date()
}: {
  tasks: Task[];
  stages: ProjectStage[];
  milestones: Milestone[];
  aiTasks: AiTask[];
  today?: string;
  now?: Date;
}) {
  const candidates: ReminderCandidate[] = [];

  tasks.forEach((task) => {
    if (task.status === "done") return;

    if (task.dueDate === today) {
      candidates.push(toCandidate("task", task.id, "due_today", task.projectId, "任務今天到期", task.title, task.dueDate, today));
    }
    if (task.dueDate && task.dueDate < today) {
      candidates.push(toCandidate("task", task.id, "overdue", task.projectId, "任務已逾期", task.title, task.dueDate, today));
    }
    if (task.riskLevel === "high") {
      candidates.push(toCandidate("task", task.id, "high_risk", task.projectId, "高風險任務", task.title, task.dueDate, today));
    }
  });

  stages.forEach((stage) => {
    if (stage.status === "done") return;

    if (
      stage.startDate &&
      stage.reminderDaysBefore > 0 &&
      dateMinusDays(stage.startDate, stage.reminderDaysBefore) <= today
    ) {
      candidates.push(
        toCandidate(
          "stage",
          stage.id,
          "stage_before_start",
          stage.projectId,
          `進場提醒：${stage.reminderDaysBefore} 天前`,
          stage.stageName,
          stage.startDate,
          today
        )
      );
    }

    if (stage.endDate && stage.endDate < today) {
      candidates.push(toCandidate("stage", stage.id, "overdue", stage.projectId, "工期節點已逾期", stage.stageName, stage.endDate, today));
    }
  });

  milestones.forEach((milestone) => {
    if (milestone.completed) return;

    if (
      milestone.dueDate &&
      milestone.reminderDaysBefore > 0 &&
      dateMinusDays(milestone.dueDate, milestone.reminderDaysBefore) <= today
    ) {
      candidates.push(
        toCandidate(
          "milestone",
          milestone.id,
          "milestone_before_due",
          milestone.projectId,
          `關鍵節點提醒：${milestone.reminderDaysBefore} 天前`,
          milestone.title,
          milestone.dueDate,
          today
        )
      );
    }

    if (milestone.dueDate === today) {
      candidates.push(toCandidate("milestone", milestone.id, "due_today", milestone.projectId, "關鍵節點今天到期", milestone.title, milestone.dueDate, today));
    }
    if (milestone.dueDate && milestone.dueDate < today) {
      candidates.push(toCandidate("milestone", milestone.id, "overdue", milestone.projectId, "關鍵節點已逾期", milestone.title, milestone.dueDate, today));
    }
    if (milestone.riskLevel === "high") {
      candidates.push(toCandidate("milestone", milestone.id, "high_risk", milestone.projectId, "高風險關鍵節點", milestone.title, milestone.dueDate, today));
    }
  });

  aiTasks.forEach((aiTask) => {
    if (aiTask.reviewStatus === "pending") {
      const ageMinutes = getAgeMinutes(aiTask.createdAt, now);
      if (ageMinutes < 30) return;

      const isHighPriority = ageMinutes >= 180;
      candidates.push(
        toCandidate(
          "ai_task",
          aiTask.id,
          "ai_task_pending_review",
          aiTask.projectId,
          isHighPriority ? "AI 草稿高優先：超過 3 小時未審核" : "AI 草稿待審核：超過 30 分鐘",
          aiTask.title,
          dateToInputValue(aiTask.createdAt ?? new Date()),
          today,
          isHighPriority ? "high" : "normal"
        )
      );
      return;
    }

    if (aiTask.reviewStatus !== "approved") return;
    if (aiTask.status === "done") return;

    const dueDate = aiTask.dueDate ? dateToInputValue(aiTask.dueDate) : "";
    if (dueDate === today) {
      candidates.push(toCandidate("ai_task", aiTask.id, "due_today", aiTask.projectId, "AI 任務今天到期", aiTask.title, dueDate, today));
    }
    if (dueDate && dueDate < today) {
      candidates.push(toCandidate("ai_task", aiTask.id, "overdue", aiTask.projectId, "AI 任務已逾期", aiTask.title, dueDate, today));
    }
  });

  return candidates;
}

export function dateMinusDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  if (Number.isNaN(parsed.getTime())) return "";

  parsed.setUTCDate(parsed.getUTCDate() - days);

  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function toCandidate(
  sourceType: ReminderSourceType,
  sourceId: string,
  reminderType: ReminderType,
  projectId: string,
  sourceLabel: string,
  title: string,
  dueDate: string,
  today: string,
  priority: ReminderCandidate["priority"] = "normal"
): ReminderCandidate {
  return {
    key: createReminderKey(sourceType, sourceId, reminderType),
    sourceType,
    sourceId,
    reminderType,
    projectId,
    title,
    sourceLabel,
    dueDate,
    status: "pending",
    priority,
    firstTriggeredOn: today,
    lastRemindedOn: today
  };
}

function getAgeMinutes(createdAt: Date | null, now: Date) {
  if (!createdAt) return 0;
  return Math.floor((now.getTime() - createdAt.getTime()) / 60000);
}

function dateToInputValue(date: Date) {
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
