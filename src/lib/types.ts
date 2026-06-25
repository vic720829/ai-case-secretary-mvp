export type TaskStatus = "todo" | "doing" | "done";
export type TaskSource = "manual" | "line" | "ai" | "voice";
export type RiskLevel = "low" | "medium" | "high";
export type ProjectStageStatus = "todo" | "doing" | "done";
export type LineMessageType = "text" | "image" | "audio";
export type LineMemberRole = "internal" | "client" | "vendor";
export type LineSenderRole = LineMemberRole | "unknown";
export type AiTaskType = "promise" | "change" | "followup" | "payment" | "invoice";
export type AiTaskReviewStatus = "pending" | "approved" | "rejected";
export type ReminderSourceType = "task" | "stage" | "milestone" | "ai_task";
export type ReminderType =
  | "stage_before_start"
  | "milestone_before_due"
  | "due_today"
  | "overdue"
  | "high_risk";
export type ReminderStatus = "pending" | "confirmed";

export type ProjectInput = {
  name: string;
  clientName: string;
  currentStage: string;
  designer: string;
  assistant: string;
  status: string;
  expectedFinishDate: string;
};

export type Project = ProjectInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type TaskInput = {
  title: string;
  description: string;
  projectId: string;
  assignee: string;
  dueDate: string;
  status: TaskStatus;
  source: TaskSource;
  riskLevel: RiskLevel;
};

export type Task = TaskInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type ProjectStageInput = {
  projectId: string;
  stageName: string;
  startDate: string;
  endDate: string;
  status: ProjectStageStatus;
  sortOrder: number;
  reminderDaysBefore: number;
};

export type ProjectStage = ProjectStageInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MilestoneInput = {
  projectId: string;
  stageId?: string;
  title: string;
  description: string;
  dueDate: string;
  completed: boolean;
  riskLevel: RiskLevel;
  reminderDaysBefore: number;
};

export type Milestone = MilestoneInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type LineGroupInput = {
  groupId: string;
  projectId: string;
  groupName: string;
  groupType?: "project" | "admin";
  allowAssistantReplies?: boolean;
};

export type LineGroup = LineGroupInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type LineMemberInput = {
  lineUserId: string;
  displayName: string;
  role: LineMemberRole;
  projectId: string;
  note: string;
};

export type LineMember = LineMemberInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MessageInput = {
  projectId: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderRole: LineSenderRole;
  messageType: LineMessageType;
  text: string;
  fileUrl: string;
  timestamp: Date;
  isProcessed: boolean;
};

export type Message = Omit<MessageInput, "timestamp"> & {
  id: string;
  timestamp: Date | null;
  createdAt: Date | null;
};

export type AiTaskInput = {
  projectId: string;
  sourceMessageId: string;
  sourceGroupId: string;
  sourceSenderName: string;
  sourceSenderRole: LineSenderRole;
  title: string;
  description: string;
  taskType: AiTaskType;
  status: TaskStatus;
  assignedTo: string;
  dueDate: Date | null;
  createdByAI: boolean;
  reviewStatus: AiTaskReviewStatus;
  approvedTaskId: string;
  reviewedBy: string;
  reviewedAt: Date | null;
};

export type AiTask = Omit<AiTaskInput, "dueDate" | "reviewedAt"> & {
  id: string;
  dueDate: Date | null;
  reviewedAt: Date | null;
  createdAt: Date | null;
};

export type ReminderLogInput = {
  key: string;
  sourceType: ReminderSourceType;
  sourceId: string;
  reminderType: ReminderType;
  projectId: string;
  title: string;
  sourceLabel: string;
  dueDate: string;
  status: ReminderStatus;
  firstTriggeredOn: string;
  lastRemindedOn: string;
  snoozedUntil?: string;
};

export type ReminderLog = ReminderLogInput & {
  id: string;
  confirmedBy: string;
  actionBy: string;
  lastAction: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  confirmedAt: Date | null;
};
