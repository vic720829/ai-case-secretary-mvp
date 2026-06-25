export type TaskStatus = "todo" | "doing" | "done";
export type TaskSource = "manual" | "line" | "ai" | "voice";
export type RiskLevel = "low" | "medium" | "high";
export type ProjectStageStatus = "todo" | "doing" | "done";
export type LineMessageType = "text" | "image" | "audio";
export type AiTaskType = "promise" | "change" | "followup" | "payment" | "invoice";

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
};

export type ProjectStage = ProjectStageInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MilestoneInput = {
  projectId: string;
  title: string;
  description: string;
  dueDate: string;
  completed: boolean;
  riskLevel: RiskLevel;
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
};

export type MessageInput = {
  projectId: string;
  groupId: string;
  senderId: string;
  senderName: string;
  messageType: LineMessageType;
  text: string;
  fileUrl: string;
  timestamp: Date;
  isProcessed: boolean;
};

export type Message = Omit<MessageInput, "timestamp"> & {
  id: string;
  timestamp: Date | null;
};

export type AiTaskInput = {
  projectId: string;
  sourceMessageId: string;
  title: string;
  description: string;
  taskType: AiTaskType;
  status: TaskStatus;
  assignedTo: string;
  dueDate: Date | null;
  createdByAI: boolean;
};

export type AiTask = Omit<AiTaskInput, "dueDate"> & {
  id: string;
  dueDate: Date | null;
  createdAt: Date | null;
};
