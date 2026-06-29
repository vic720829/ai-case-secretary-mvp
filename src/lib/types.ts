export type TaskStatus = "todo" | "doing" | "done";
export type TaskSource = "manual" | "line" | "ai" | "voice";
export type RiskLevel = "low" | "medium" | "high";
export type ProjectStageStatus = "todo" | "doing" | "done";
export type LineMessageType = "text" | "image" | "audio";
export type LineMemberRole = "internal" | "client" | "vendor";
export type LineSenderRole = LineMemberRole | "unknown";
export type AiTaskType = "promise" | "change" | "followup" | "payment" | "invoice";
export type AiTaskReviewStatus = "pending" | "approved" | "rejected";
export type AiTaskResolutionStatus = "open" | "maybe_answered" | "confirmed_resolved";
export type ReminderSourceType = "task" | "stage" | "milestone" | "ai_task" | "message";
export type ReminderPriority = "normal" | "high";
export type ReminderType =
  | "stage_before_start"
  | "milestone_before_due"
  | "ai_task_pending_review"
  | "customer_followup_unanswered"
  | "customer_message_unanswered"
  | "due_today"
  | "overdue"
  | "high_risk";
export type ReminderStatus = "pending" | "confirmed";
export type WebhookLogStatus = "success" | "skipped" | "error";
export type CalendarEventType =
  | "site_visit"
  | "meeting"
  | "design"
  | "construction"
  | "delivery"
  | "payment"
  | "other";
export type CalendarEventStatus = "scheduled" | "done" | "cancelled";
export type CalendarEventSource = "manual" | "line" | "ai";
export type CalendarEventCounterpartyType = "customer" | "vendor" | "internal" | "other";
export type UserRole = "owner" | "admin" | "staff" | "viewer";
export type AuditAction = "create" | "update" | "delete";
export type AiFeedbackSource = "website" | "line";
export type AiFeedbackAction =
  | "approve_ai_task"
  | "reject_ai_task"
  | "update_ai_task_draft"
  | "confirm_reminder"
  | "snooze_reminder"
  | "keep_reminder"
  | "resolve_ai_followup"
  | "snooze_ai_followup"
  | "complete_task";
export type AiFeedbackTargetType = "ai_task" | "reminder" | "task";

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

export type UserProfileInput = {
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
};

export type UserProfile = UserProfileInput & {
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
  attachments?: MessageAttachment[];
  attachmentMessageIds?: string[];
  attachmentCount?: number;
};

export type Task = TaskInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type ProjectMemoInput = {
  projectId: string;
  title: string;
  content: string;
  sourceTaskId?: string;
  sourceTaskTitle?: string;
  sourceTaskStatus?: TaskStatus;
  sourceTaskDueDate?: string;
  sourceTaskRiskLevel?: RiskLevel;
  createdBy?: string;
};

export type ProjectMemo = ProjectMemoInput & {
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

export type CalendarEventInput = {
  title: string;
  description: string;
  projectId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  owner: string;
  counterpartyType: CalendarEventCounterpartyType;
  counterpartyName: string;
  contactMethod: string;
  eventType: CalendarEventType;
  status: CalendarEventStatus;
  source: CalendarEventSource;
};

export type CalendarEvent = CalendarEventInput & {
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

export type LinePendingGroup = {
  id: string;
  groupId: string;
  groupName: string;
  sourceType: string;
  lastEventType: string;
  lastMessageText: string;
  lastSenderName: string;
  messageCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastSeenAt: Date | null;
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
  lineMessageId: string;
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

export type MessageAttachment = {
  messageId: string;
  fileUrl: string;
  fileType: LineMessageType;
  senderName: string;
  senderRole: LineSenderRole;
  text: string;
  createdAt: Date | null;
};

export type AiTaskInput = {
  projectId: string;
  sourceMessageId: string;
  sourceGroupId: string;
  sourceSenderId?: string;
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
  resolutionStatus: AiTaskResolutionStatus;
  linkedAiTaskId: string;
  resolutionHint: string;
  resolutionLinkedAt: Date | null;
  attachments?: MessageAttachment[];
  attachmentMessageIds?: string[];
  attachmentCount?: number;
};

export type AiTask = Omit<AiTaskInput, "dueDate" | "reviewedAt" | "resolutionLinkedAt"> & {
  id: string;
  dueDate: Date | null;
  reviewedAt: Date | null;
  resolutionLinkedAt: Date | null;
  createdAt: Date | null;
};

export type AiTaskDraftUpdateInput = {
  projectId: string;
  title: string;
  description: string;
  taskType: AiTaskType;
  status: TaskStatus;
  assignedTo: string;
  dueDate: string;
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
  priority?: ReminderPriority;
  firstTriggeredOn: string;
  lastRemindedOn: string;
  snoozedUntil?: string;
};

export type ReminderLog = ReminderLogInput & {
  id: string;
  priority: ReminderPriority;
  confirmedBy: string;
  actionBy: string;
  lastAction: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  confirmedAt: Date | null;
};

export type WebhookLog = {
  id: string;
  eventType: string;
  status: WebhookLogStatus;
  groupId: string;
  userId: string;
  projectId: string;
  messageId: string;
  lineMessageId: string;
  messageType: string;
  senderName: string;
  senderRole: string;
  messageText: string;
  aiTaskDrafts: number;
  adminNotifications: number;
  adminNotificationFailures: number;
  reason: string;
  errorMessage: string;
  createdAt: Date | null;
};

export type AuditActor = {
  uid: string;
  email: string;
  displayName: string;
};

export type AuditLog = {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  changes: Array<{
    field: string;
    before: string;
    after: string;
  }>;
  createdAt: Date | null;
};

export type AiFeedbackChange = {
  field: string;
  before: string;
  after: string;
};

export type AiFeedbackEventInput = {
  source: AiFeedbackSource;
  action: AiFeedbackAction;
  targetType: AiFeedbackTargetType;
  targetId: string;
  targetTitle: string;
  projectId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  changes: AiFeedbackChange[];
  note: string;
};

export type AiFeedbackEvent = AiFeedbackEventInput & {
  id: string;
  createdAt: Date | null;
};

export type LearnedRuleInput = {
  name: string;
  description: string;
  triggerKeywords: string[];
  outcomeTaskType: AiTaskType | "";
  outcomeRiskLevel: RiskLevel | "";
  notifyPriority: ReminderPriority;
  enabled: boolean;
  createdBy: string;
  updatedBy: string;
};

export type LearnedRule = LearnedRuleInput & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};
