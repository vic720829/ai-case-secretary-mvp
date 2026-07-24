import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as queryLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot
} from "firebase/firestore";
import { db } from "./firebase";
import { canReviewAiDraft } from "./aiReviewPolicy";
import type {
  AiTask,
  AiTaskDraftUpdateInput,
  AiTaskType,
  AiFeedbackEvent,
  AiFeedbackEventInput,
  AuditActor,
  AuditLog,
  CalendarEvent,
  CalendarEventInput,
  Incident,
  IncidentType,
  LearnedRule,
  LearnedRuleInput,
  Milestone,
  MilestoneInput,
  LineGroup,
  LineGroupInput,
  LineNotificationLevel,
  LinePendingGroup,
  LineMember,
  LineMemberInput,
  Message,
  MessageAttachment,
  Project,
  ProjectAiSummary,
  ProjectDocument,
  ProjectDocumentInput,
  ProjectInput,
  ProjectMemo,
  ProjectMemoInput,
  ProjectMemory,
  ProjectMemoryInput,
  ProjectStage,
  ProjectStageInput,
  ReminderLog,
  ReminderLogInput,
  RiskLevel,
  Task,
  TaskInput,
  UserProfile,
  UserProfileInput,
  WebhookLog
} from "./types";

const PROJECTS_COLLECTION = "projects";
const TASKS_COLLECTION = "tasks";
const PROJECT_MEMOS_COLLECTION = "project_memos";
const PROJECT_MEMORIES_COLLECTION = "project_memories";
const PROJECT_SUMMARIES_COLLECTION = "project_summaries";
const PROJECT_DOCUMENTS_COLLECTION = "project_documents";
const PROJECT_STAGES_COLLECTION = "projectStages";
const MILESTONES_COLLECTION = "milestones";
const CALENDAR_EVENTS_COLLECTION = "calendar_events";
const LINE_GROUPS_COLLECTION = "line_groups";
const LINE_PENDING_GROUPS_COLLECTION = "line_pending_groups";
const LINE_MEMBERS_COLLECTION = "line_members";
const MESSAGES_COLLECTION = "messages";
const AI_TASKS_COLLECTION = "ai_tasks";
const INCIDENTS_COLLECTION = "incidents";
const REMINDER_LOGS_COLLECTION = "reminder_logs";
const WEBHOOK_LOGS_COLLECTION = "webhook_logs";
const USERS_COLLECTION = "users";
const AUDIT_LOGS_COLLECTION = "audit_logs";
const AI_FEEDBACK_EVENTS_COLLECTION = "ai_feedback_events";
const LEARNED_RULES_COLLECTION = "learned_rules";
const FINANCE_PROJECT_SETTINGS_COLLECTION = "finance_project_settings";
const FINANCE_PAYMENTS_COLLECTION = "finance_payments";
const FINANCE_ADJUSTMENTS_COLLECTION = "finance_adjustments";
const FINANCE_COSTS_COLLECTION = "finance_costs";
const FINANCE_DRAFTS_COLLECTION = "finance_drafts";
const DEFAULT_RECENT_LIST_LIMIT = 150;
const DEFAULT_REVIEWED_AI_TASK_LIMIT = 80;

function requireDb() {
  if (!db) {
    throw new Error("Firebase 尚未設定，請先填入 .env.local。");
  }

  return db;
}

function readTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

function normalizeRiskLevel(value: unknown, fallback: RiskLevel): RiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : fallback;
}

function normalizeAiTaskType(value: unknown, fallback: AiTaskType): AiTaskType {
  return value === "promise" ||
    value === "change" ||
    value === "followup" ||
    value === "payment" ||
    value === "invoice" ||
    value === "complaint" ||
    value === "schedule" ||
    value === "file"
    ? value
    : fallback;
}

function normalizeIncidentType(value: unknown): IncidentType {
  return value === "unknown" ? "unknown" : normalizeAiTaskType(value, "followup");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function hasFullProjectAccessRole(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "manager";
}

function readAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const attachment = item as Record<string, unknown>;

      return {
        messageId: String(attachment.messageId ?? ""),
        fileUrl: String(attachment.fileUrl ?? ""),
        fileType:
          attachment.fileType === "audio" ||
          attachment.fileType === "image" ||
          attachment.fileType === "text" ||
          attachment.fileType === "file"
            ? attachment.fileType
            : "image",
        senderName: String(attachment.senderName ?? ""),
        senderRole:
          attachment.senderRole === "internal" || attachment.senderRole === "client" || attachment.senderRole === "vendor"
            ? attachment.senderRole
            : "unknown",
        text: String(attachment.text ?? ""),
        createdAt: readTimestamp(attachment.createdAt)
      } satisfies MessageAttachment;
    })
    .filter((attachment): attachment is MessageAttachment => Boolean(attachment?.messageId && attachment.fileUrl));
}

function projectFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Project {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: data.name ?? "",
    clientName: data.clientName ?? "",
    currentStage: data.currentStage ?? "",
    designer: data.designer ?? "",
    assistant: data.assistant ?? "",
    status: data.status ?? "",
    expectedFinishDate: data.expectedFinishDate ?? "",
    memberUserIds: readStringArray(data.memberUserIds),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function userProfileFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): UserProfile {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    email: data.email ?? "",
    displayName: data.displayName ?? "",
    role: data.role ?? "staff",
    active: Boolean(data.active ?? true),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function auditLogFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): AuditLog {
  const data = snapshot.data();
  const rawChanges = Array.isArray(data.changes) ? data.changes : [];

  return {
    id: snapshot.id,
    actorUid: data.actorUid ?? "",
    actorEmail: data.actorEmail ?? "",
    actorName: data.actorName ?? "",
    action: data.action ?? "update",
    resourceType: data.resourceType ?? "",
    resourceId: data.resourceId ?? "",
    resourceName: data.resourceName ?? "",
    changes: rawChanges.map((change) => ({
      field: String(change.field ?? ""),
      before: String(change.before ?? ""),
      after: String(change.after ?? "")
    })),
    createdAt: readTimestamp(data.createdAt)
  };
}

function aiFeedbackEventFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): AiFeedbackEvent {
  const data = snapshot.data();
  const rawChanges = Array.isArray(data.changes) ? data.changes : [];

  return {
    id: snapshot.id,
    source: data.source === "line" ? "line" : "website",
    action: data.action ?? "update_ai_task_draft",
    targetType:
      data.targetType === "reminder" || data.targetType === "task" || data.targetType === "ai_task"
        ? data.targetType
        : "ai_task",
    targetId: data.targetId ?? "",
    targetTitle: data.targetTitle ?? "",
    projectId: data.projectId ?? "",
    actorId: data.actorId ?? "",
    actorName: data.actorName ?? "",
    actorRole: data.actorRole ?? "",
    changes: rawChanges.map((change) => ({
      field: String(change.field ?? ""),
      before: String(change.before ?? ""),
      after: String(change.after ?? "")
    })),
    note: data.note ?? "",
    createdAt: readTimestamp(data.createdAt)
  };
}

function learnedRuleFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): LearnedRule {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: data.name ?? "",
    description: data.description ?? "",
    triggerKeywords: Array.isArray(data.triggerKeywords)
      ? data.triggerKeywords.map((keyword: unknown) => String(keyword)).filter(Boolean)
      : [],
    outcomeTaskType:
      data.outcomeTaskType === "promise" ||
      data.outcomeTaskType === "change" ||
      data.outcomeTaskType === "followup" ||
      data.outcomeTaskType === "payment" ||
      data.outcomeTaskType === "invoice" ||
      data.outcomeTaskType === "complaint" ||
      data.outcomeTaskType === "schedule" ||
      data.outcomeTaskType === "file"
        ? data.outcomeTaskType
        : "",
    outcomeRiskLevel:
      data.outcomeRiskLevel === "low" ||
      data.outcomeRiskLevel === "medium" ||
      data.outcomeRiskLevel === "high" ||
      data.outcomeRiskLevel === "critical"
        ? data.outcomeRiskLevel
        : "",
    notifyPriority: data.notifyPriority === "high" ? "high" : "normal",
    enabled: data.enabled !== false,
    createdBy: data.createdBy ?? "",
    updatedBy: data.updatedBy ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function taskFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Task {
  const data = snapshot.data();
  const attachments = readAttachments(data.attachments);

  return {
    id: snapshot.id,
    title: data.title ?? "",
    description: data.description ?? "",
    projectId: data.projectId ?? "",
    incidentId: data.incidentId ?? "",
    assignee: data.assignee ?? "",
    dueDate: data.dueDate ?? "",
    status: data.status ?? "todo",
    source: data.source ?? "manual",
    riskLevel: normalizeRiskLevel(data.riskLevel, "low"),
    attachments,
    attachmentMessageIds: Array.isArray(data.attachmentMessageIds)
      ? data.attachmentMessageIds.map((id: unknown) => String(id)).filter(Boolean)
      : attachments.map((attachment) => attachment.messageId),
    attachmentCount: Number(data.attachmentCount ?? attachments.length),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function projectMemoFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): ProjectMemo {
  const data = snapshot.data();
  const sourceTaskId = data.sourceTaskId ?? "";
  const attachments = readAttachments(data.attachments);

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    title: data.title ?? "",
    content: data.content ?? "",
    sourceTaskId,
    sourceTaskTitle: data.sourceTaskTitle ?? "",
    sourceTaskStatus: sourceTaskId ? data.sourceTaskStatus ?? "todo" : undefined,
    sourceTaskDueDate: data.sourceTaskDueDate ?? "",
    sourceTaskRiskLevel: sourceTaskId ? normalizeRiskLevel(data.sourceTaskRiskLevel, "low") : undefined,
    attachments,
    attachmentMessageIds: Array.isArray(data.attachmentMessageIds)
      ? data.attachmentMessageIds.map((id: unknown) => String(id)).filter(Boolean)
      : attachments.map((attachment) => attachment.messageId),
    attachmentCount: Number(data.attachmentCount ?? attachments.length),
    createdBy: data.createdBy ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function projectMemoryFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): ProjectMemory {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    title: data.title ?? "",
    content: data.content ?? "",
    memoryType: data.memoryType === "temporary" ? "temporary" : "permanent",
    status: data.status === "archived" ? "archived" : "active",
    importance: data.importance === "high" ? "high" : "normal",
    expiresAt: data.expiresAt ?? "",
    sourceMemoId: data.sourceMemoId ?? "",
    sourceTaskId: data.sourceTaskId ?? "",
    sourceIncidentId: data.sourceIncidentId ?? "",
    createdBy: data.createdBy ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function projectAiSummaryFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): ProjectAiSummary {
  const data = snapshot.data();
  const rawSections = Array.isArray(data.sections) ? data.sections : [];

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    summaryText: data.summaryText ?? "",
    sections: rawSections
      .map((section: unknown) => {
        if (!section || typeof section !== "object") return null;
        const record = section as Record<string, unknown>;

        return {
          title: String(record.title ?? ""),
          items: Array.isArray(record.items) ? record.items.map((item) => String(item)).filter(Boolean) : []
        };
      })
      .filter((section): section is { title: string; items: string[] } => Boolean(section?.title)),
    source: data.source === "ai" ? "ai" : "system",
    model: data.model ?? "",
    refreshedBy: data.refreshedBy ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function projectDocumentFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): ProjectDocument {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    title: data.title ?? "",
    url: data.url ?? "",
    documentType:
      data.documentType === "folder" ||
      data.documentType === "drawing" ||
      data.documentType === "drawing_review_report" ||
      data.documentType === "contract" ||
      data.documentType === "quote" ||
      data.documentType === "photo" ||
      data.documentType === "file"
        ? data.documentType
        : "other",
    description: data.description ?? "",
    updatedBy: data.updatedBy ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function projectStageFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): ProjectStage {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    stageName: data.stageName ?? "",
    startDate: data.startDate ?? "",
    endDate: data.endDate ?? "",
    status: data.status ?? "todo",
    sortOrder: Number(data.sortOrder ?? 0),
    reminderDaysBefore: Number(data.reminderDaysBefore ?? 0),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function milestoneFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Milestone {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    stageId: data.stageId ?? "",
    title: data.title ?? "",
    description: data.description ?? "",
    dueDate: data.dueDate ?? "",
    completed: Boolean(data.completed ?? false),
    riskLevel: normalizeRiskLevel(data.riskLevel, "low"),
    reminderDaysBefore: Number(data.reminderDaysBefore ?? 0),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function calendarEventFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): CalendarEvent {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    title: data.title ?? "",
    description: data.description ?? "",
    projectId: data.projectId ?? "",
    startDate: data.startDate ?? "",
    endDate: data.endDate ?? data.startDate ?? "",
    startTime: data.startTime ?? "",
    endTime: data.endTime ?? "",
    location: data.location ?? "",
    owner: data.owner ?? "",
    counterpartyType:
      data.counterpartyType === "customer" ||
      data.counterpartyType === "vendor" ||
      data.counterpartyType === "internal"
        ? data.counterpartyType
        : "other",
    counterpartyName: data.counterpartyName ?? "",
    contactMethod: data.contactMethod ?? "",
    eventType:
      data.eventType === "site_visit" ||
      data.eventType === "meeting" ||
      data.eventType === "design" ||
      data.eventType === "construction" ||
      data.eventType === "delivery" ||
      data.eventType === "payment"
        ? data.eventType
        : "other",
    status:
      data.status === "done" || data.status === "cancelled"
        ? data.status
        : "scheduled",
    source: data.source === "line" || data.source === "ai" ? data.source : "manual",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function lineGroupFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): LineGroup {
  const data = snapshot.data();
  const groupType = data.groupType ?? "project";

  return {
    id: snapshot.id,
    groupId: data.groupId ?? "",
    projectId: data.projectId ?? "",
    groupName: data.groupName ?? "",
    groupType,
    allowAssistantReplies: Boolean(data.allowAssistantReplies ?? false),
    notificationLevel: normalizeLineNotificationLevel(
      data.notificationLevel,
      groupType === "admin" ? "primary" : "none"
    ),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function normalizeLineNotificationLevel(value: unknown, fallback: LineNotificationLevel): LineNotificationLevel {
  return value === "primary" ||
    value === "secondary" ||
    value === "critical_only" ||
    value === "test" ||
    value === "none"
    ? value
    : fallback;
}

function linePendingGroupFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): LinePendingGroup {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    groupId: data.groupId ?? "",
    groupName: data.groupName ?? "",
    sourceType: data.sourceType ?? "group",
    lastEventType: data.lastEventType ?? "",
    lastMessageText: data.lastMessageText ?? "",
    lastSenderName: data.lastSenderName ?? "",
    messageCount: Number(data.messageCount ?? 0),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt),
    lastSeenAt: readTimestamp(data.lastSeenAt)
  };
}

function lineMemberFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): LineMember {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    lineUserId: data.lineUserId ?? "",
    displayName: data.displayName ?? "",
    role: data.role ?? "client",
    projectId: data.projectId ?? "",
    note: data.note ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function messageFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Message {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    groupId: data.groupId ?? "",
    incidentId: data.incidentId ?? "",
    lineMessageId: data.lineMessageId ?? "",
    senderId: data.senderId ?? "",
    senderName: data.senderName ?? "",
    senderRole: data.senderRole ?? "unknown",
    messageType: data.messageType ?? "text",
    text: data.text ?? "",
    fileUrl: data.fileUrl ?? "",
    timestamp: readTimestamp(data.timestamp),
    isProcessed: Boolean(data.isProcessed ?? false),
    createdAt: readTimestamp(data.createdAt)
  };
}

function aiTaskFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): AiTask {
  const data = snapshot.data();
  const attachments = readAttachments(data.attachments);

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    incidentId: data.incidentId ?? "",
    sourceMessageId: data.sourceMessageId ?? "",
    sourceGroupId: data.sourceGroupId ?? "",
    sourceSenderId: data.sourceSenderId ?? "",
    sourceSenderName: data.sourceSenderName ?? "",
    sourceSenderRole: data.sourceSenderRole ?? "unknown",
    title: data.title ?? "",
    description: data.description ?? "",
    taskType: normalizeAiTaskType(data.taskType, "followup"),
    status: data.status ?? "todo",
    assignedTo: data.assignedTo ?? "",
    dueDate: readTimestamp(data.dueDate),
    createdByAI: Boolean(data.createdByAI ?? true),
    reviewStatus: data.reviewStatus ?? "pending",
    approvedTaskId: data.approvedTaskId ?? "",
    reviewedBy: data.reviewedBy ?? "",
    reviewedAt: readTimestamp(data.reviewedAt),
    resolutionStatus: data.resolutionStatus ?? "open",
    linkedAiTaskId: data.linkedAiTaskId ?? "",
    resolutionHint: data.resolutionHint ?? "",
    resolutionLinkedAt: readTimestamp(data.resolutionLinkedAt),
    attachments,
    attachmentMessageIds: Array.isArray(data.attachmentMessageIds)
      ? data.attachmentMessageIds.map((id: unknown) => String(id)).filter(Boolean)
      : attachments.map((attachment) => attachment.messageId),
    attachmentCount: Number(data.attachmentCount ?? attachments.length),
    createdAt: readTimestamp(data.createdAt)
  };
}

function incidentFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Incident {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    incidentKey: data.incidentKey ?? "",
    projectId: data.projectId ?? "",
    groupId: data.groupId ?? "",
    title: data.title ?? "",
    summary: data.summary ?? "",
    incidentType: normalizeIncidentType(data.incidentType),
    riskLevel: normalizeRiskLevel(data.riskLevel, "low"),
    status: data.status === "resolved" || data.status === "ignored" ? data.status : "open",
    source: data.source === "manual" || data.source === "ai" ? data.source : "line",
    sourceMessageIds: readStringArray(data.sourceMessageIds),
    lineMessageIds: readStringArray(data.lineMessageIds),
    sourceMessageCount: Number(data.sourceMessageCount ?? readStringArray(data.sourceMessageIds).length),
    messageTypes: readStringArray(data.messageTypes)
      .filter((type): type is Incident["messageTypes"][number] => type === "text" || type === "image" || type === "audio"),
    attachmentMessageIds: readStringArray(data.attachmentMessageIds),
    lastMessageText: data.lastMessageText ?? "",
    lastSenderName: data.lastSenderName ?? "",
    lastSenderRole:
      data.lastSenderRole === "internal" || data.lastSenderRole === "client" || data.lastSenderRole === "vendor"
        ? data.lastSenderRole
        : "unknown",
    aiTaskIds: readStringArray(data.aiTaskIds),
    taskIds: readStringArray(data.taskIds),
    firstMessageAt: readTimestamp(data.firstMessageAt),
    lastMessageAt: readTimestamp(data.lastMessageAt),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function reminderLogFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): ReminderLog {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    key: data.key ?? snapshot.id,
    sourceType: data.sourceType ?? "task",
    sourceId: data.sourceId ?? "",
    reminderType: data.reminderType ?? "due_today",
    projectId: data.projectId ?? "",
    title: data.title ?? "",
    sourceLabel: data.sourceLabel ?? "",
    dueDate: data.dueDate ?? "",
    status: data.status ?? "pending",
    priority: data.priority === "high" ? "high" : "normal",
    firstTriggeredOn: data.firstTriggeredOn ?? "",
    lastRemindedOn: data.lastRemindedOn ?? "",
    snoozedUntil: data.snoozedUntil ?? "",
    confirmedBy: data.confirmedBy ?? "",
    actionBy: data.actionBy ?? "",
    lastAction: data.lastAction ?? "",
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt),
    confirmedAt: readTimestamp(data.confirmedAt)
  };
}

function webhookLogFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): WebhookLog {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    eventType: data.eventType ?? "",
    status: data.status ?? "success",
    groupId: data.groupId ?? "",
    userId: data.userId ?? "",
    projectId: data.projectId ?? "",
    messageId: data.messageId ?? "",
    lineMessageId: data.lineMessageId ?? "",
    messageType: data.messageType ?? "",
    senderName: data.senderName ?? "",
    senderRole: data.senderRole ?? "",
    messageText: data.messageText ?? "",
    aiTaskDrafts: Number(data.aiTaskDrafts ?? 0),
    adminNotifications: Number(data.adminNotifications ?? 0),
    adminNotificationFailures: Number(data.adminNotificationFailures ?? 0),
    reason: data.reason ?? "",
    errorMessage: data.errorMessage ?? "",
    createdAt: readTimestamp(data.createdAt)
  };
}

function dateStringToTimestamp(value: string) {
  if (!value) return null;

  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  return Timestamp.fromDate(parsed);
}

function addAuditLogToBatch(
  batch: ReturnType<typeof writeBatch>,
  input: {
    actor?: AuditActor | null;
    action: "create" | "update" | "delete";
    resourceType: string;
    resourceId: string;
    resourceName: string;
    changes: AuditLog["changes"];
  }
) {
  const database = requireDb();
  const ref = doc(collection(database, AUDIT_LOGS_COLLECTION));

  batch.set(ref, {
    actorUid: input.actor?.uid ?? "",
    actorEmail: input.actor?.email ?? "",
    actorName: input.actor?.displayName ?? "",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceName: input.resourceName,
    changes: input.changes,
    createdAt: serverTimestamp()
  });
}

function diffProjectInput(before: ProjectInput | null, after: ProjectInput | null): AuditLog["changes"] {
  const fields: Array<{ key: keyof ProjectInput; label: string }> = [
    { key: "name", label: "案件名稱" },
    { key: "clientName", label: "客戶名稱" },
    { key: "currentStage", label: "目前階段" },
    { key: "designer", label: "負責設計師" },
    { key: "assistant", label: "設計助理" },
    { key: "status", label: "狀態" },
    { key: "expectedFinishDate", label: "預計完工日" },
    { key: "memberUserIds", label: "案件成員" }
  ];

  return fields
    .map(({ key, label }) => ({
      field: label,
      before: formatProjectChangeValue(before?.[key]),
      after: formatProjectChangeValue(after?.[key])
    }))
    .filter((change) => change.before !== change.after);
}

function formatProjectChangeValue(value: ProjectInput[keyof ProjectInput] | undefined) {
  if (Array.isArray(value)) return value.join(", ");

  return value ?? "";
}

export async function listProjects() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECTS_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(projectFromDoc);
}

export async function listProjectsForProfile(profile: Pick<UserProfile, "id" | "role"> | null | undefined) {
  if (!profile) return [];
  if (hasFullProjectAccessRole(profile.role)) return listProjects();

  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECTS_COLLECTION), where("memberUserIds", "array-contains", profile.id))
  );

  return snapshot.docs
    .map(projectFromDoc)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listUserProfiles() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, USERS_COLLECTION));

  return snapshot.docs
    .map(userProfileFromDoc)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-TW") || a.email.localeCompare(b.email));
}

export async function updateUserProfile(id: string, input: UserProfileInput) {
  const database = requireDb();

  await updateDoc(doc(database, USERS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function listAuditLogs() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, AUDIT_LOGS_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(auditLogFromDoc).slice(0, 200);
}

export async function listAiFeedbackEvents(maxItems = 150) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, AI_FEEDBACK_EVENTS_COLLECTION), orderBy("createdAt", "desc"), queryLimit(maxItems))
  );

  return snapshot.docs.map(aiFeedbackEventFromDoc);
}

export async function createAiFeedbackEvent(input: AiFeedbackEventInput) {
  const database = requireDb();

  await addDoc(collection(database, AI_FEEDBACK_EVENTS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp()
  });
}

export async function listLearnedRules() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, LEARNED_RULES_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(learnedRuleFromDoc);
}

export async function createLearnedRule(input: LearnedRuleInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, LEARNED_RULES_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateLearnedRule(id: string, input: LearnedRuleInput) {
  const database = requireDb();

  await updateDoc(doc(database, LEARNED_RULES_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function setLearnedRuleEnabled(id: string, enabled: boolean, updatedBy: string) {
  const database = requireDb();

  await updateDoc(doc(database, LEARNED_RULES_COLLECTION, id), {
    enabled,
    updatedBy,
    updatedAt: serverTimestamp()
  });
}

export async function getProject(id: string) {
  const database = requireDb();
  const snapshot = await getDoc(doc(database, PROJECTS_COLLECTION, id));

  if (!snapshot.exists()) return null;
  return projectFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>);
}

export async function createProject(input: ProjectInput, actor?: AuditActor | null) {
  const database = requireDb();
  const ref = doc(collection(database, PROJECTS_COLLECTION));
  const batch = writeBatch(database);

  batch.set(ref, {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  addAuditLogToBatch(batch, {
    actor,
    action: "create",
    resourceType: "project",
    resourceId: ref.id,
    resourceName: input.name,
    changes: diffProjectInput(null, input)
  });

  await batch.commit();
  return ref.id;
}

export async function updateProject(id: string, input: ProjectInput, actor?: AuditActor | null) {
  const database = requireDb();
  const projectRef = doc(database, PROJECTS_COLLECTION, id);
  const snapshot = await getDoc(projectRef);
  const before = snapshot.exists() ? projectFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>) : null;
  const changes = diffProjectInput(before, input);
  const batch = writeBatch(database);

  batch.update(projectRef, {
    ...input,
    updatedAt: serverTimestamp()
  });
  if (changes.length) {
    addAuditLogToBatch(batch, {
      actor,
      action: "update",
      resourceType: "project",
      resourceId: id,
      resourceName: input.name,
      changes
    });
  }

  await batch.commit();
}

export async function deleteProject(id: string, actor?: AuditActor | null) {
  const database = requireDb();
  const [
    projectSnapshot,
    linkedTasks,
    linkedProjectMemos,
    linkedProjectMemories,
    linkedProjectDocuments,
    projectSummarySnapshot,
    linkedStages,
    linkedMilestones,
    linkedCalendarEvents,
    linkedLineGroups,
    linkedMessages,
    linkedLineMembers,
    linkedAiTasks,
    linkedIncidents,
    linkedReminderLogs,
    linkedWebhookLogs,
    financeSettingsSnapshot,
    linkedFinancePayments,
    linkedFinanceAdjustments,
    linkedFinanceCosts,
    linkedFinanceDrafts
  ] = await Promise.all([
    getDoc(doc(database, PROJECTS_COLLECTION, id)),
    getDocs(query(collection(database, TASKS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, PROJECT_MEMOS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, PROJECT_MEMORIES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, PROJECT_DOCUMENTS_COLLECTION), where("projectId", "==", id))),
    getDoc(doc(database, PROJECT_SUMMARIES_COLLECTION, id)),
    getDocs(query(collection(database, PROJECT_STAGES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, MILESTONES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, CALENDAR_EVENTS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, LINE_GROUPS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, MESSAGES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, LINE_MEMBERS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, AI_TASKS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, INCIDENTS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, REMINDER_LOGS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, WEBHOOK_LOGS_COLLECTION), where("projectId", "==", id))),
    getDoc(doc(database, FINANCE_PROJECT_SETTINGS_COLLECTION, id)),
    getDocs(query(collection(database, FINANCE_PAYMENTS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, FINANCE_ADJUSTMENTS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, FINANCE_COSTS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, FINANCE_DRAFTS_COLLECTION), where("projectId", "==", id)))
  ]);
  const project = projectSnapshot.exists() ? projectFromDoc(projectSnapshot as QueryDocumentSnapshot<DocumentData>) : null;
  const batch = writeBatch(database);

  linkedTasks.docs.forEach((taskSnapshot) => {
    batch.delete(taskSnapshot.ref);
  });
  linkedProjectMemos.docs.forEach((memoSnapshot) => {
    batch.delete(memoSnapshot.ref);
  });
  linkedProjectMemories.docs.forEach((memorySnapshot) => {
    batch.delete(memorySnapshot.ref);
  });
  linkedProjectDocuments.docs.forEach((documentSnapshot) => {
    batch.delete(documentSnapshot.ref);
  });
  if (projectSummarySnapshot.exists()) {
    batch.delete(projectSummarySnapshot.ref);
  }
  linkedStages.docs.forEach((stageSnapshot) => {
    batch.delete(stageSnapshot.ref);
  });
  linkedMilestones.docs.forEach((milestoneSnapshot) => {
    batch.delete(milestoneSnapshot.ref);
  });
  linkedCalendarEvents.docs.forEach((eventSnapshot) => {
    batch.delete(eventSnapshot.ref);
  });
  linkedLineGroups.docs.forEach((lineGroupSnapshot) => {
    batch.delete(lineGroupSnapshot.ref);
  });
  linkedMessages.docs.forEach((messageSnapshot) => {
    batch.delete(messageSnapshot.ref);
  });
  linkedLineMembers.docs.forEach((lineMemberSnapshot) => {
    batch.delete(lineMemberSnapshot.ref);
  });
  linkedAiTasks.docs.forEach((aiTaskSnapshot) => {
    batch.delete(aiTaskSnapshot.ref);
  });
  linkedIncidents.docs.forEach((incidentSnapshot) => {
    batch.delete(incidentSnapshot.ref);
  });
  linkedReminderLogs.docs.forEach((reminderLogSnapshot) => {
    batch.delete(reminderLogSnapshot.ref);
  });
  linkedWebhookLogs.docs.forEach((webhookLogSnapshot) => {
    batch.delete(webhookLogSnapshot.ref);
  });
  if (financeSettingsSnapshot.exists()) {
    batch.delete(financeSettingsSnapshot.ref);
  }
  linkedFinancePayments.docs.forEach((paymentSnapshot) => {
    batch.delete(paymentSnapshot.ref);
  });
  linkedFinanceAdjustments.docs.forEach((adjustmentSnapshot) => {
    batch.delete(adjustmentSnapshot.ref);
  });
  linkedFinanceCosts.docs.forEach((costSnapshot) => {
    batch.delete(costSnapshot.ref);
  });
  linkedFinanceDrafts.docs.forEach((draftSnapshot) => {
    batch.delete(draftSnapshot.ref);
  });
  addAuditLogToBatch(batch, {
    actor,
    action: "delete",
    resourceType: "project",
    resourceId: id,
    resourceName: project?.name ?? id,
    changes: diffProjectInput(project, null)
  });
  batch.delete(doc(database, PROJECTS_COLLECTION, id));

  await batch.commit();
}

export async function listTasks() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, TASKS_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(taskFromDoc);
}

export async function listTasksForProjects(projectIds: string[]) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, TASKS_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(taskFromDoc))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listRecentTasks(maxItems = DEFAULT_RECENT_LIST_LIMIT) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, TASKS_COLLECTION), orderBy("createdAt", "desc"), queryLimit(maxItems))
  );

  return snapshot.docs.map(taskFromDoc);
}

export async function listRecentTasksForProjects(projectIds: string[], maxItems = DEFAULT_RECENT_LIST_LIMIT) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, TASKS_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(taskFromDoc))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .slice(0, maxItems);
}

export async function listTasksByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, TASKS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(taskFromDoc)
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));
}

export async function getTask(id: string) {
  const database = requireDb();
  const snapshot = await getDoc(doc(database, TASKS_COLLECTION, id));

  if (!snapshot.exists()) return null;
  return taskFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>);
}

export async function createTask(input: TaskInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, TASKS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateTask(id: string, input: TaskInput) {
  const database = requireDb();
  await updateDoc(doc(database, TASKS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteTask(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, TASKS_COLLECTION, id));
}

export async function listProjectMemosByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECT_MEMOS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(projectMemoFromDoc)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function createProjectMemo(input: ProjectMemoInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, PROJECT_MEMOS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function createProjectMemoFromTask(task: Task, createdBy = "") {
  if (!task.projectId) {
    throw new Error("這個待辦沒有綁定案件，無法加入案件備忘錄。");
  }

  const database = requireDb();
  const ref = doc(database, PROJECT_MEMOS_COLLECTION, `task_${task.id}`);
  const attachments = task.attachments ?? [];

  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists() ? snapshot.data() : null;

    transaction.set(
      ref,
      {
        projectId: task.projectId,
        title: task.title,
        content: task.description || "由待辦加入備忘錄，原待辦未填寫內容。",
        sourceTaskId: task.id,
        sourceTaskTitle: task.title,
        sourceTaskStatus: task.status,
        sourceTaskDueDate: task.dueDate,
        sourceTaskRiskLevel: task.riskLevel,
        attachments,
        attachmentMessageIds: attachments.map((attachment) => attachment.messageId),
        attachmentCount: attachments.length,
        createdBy: existing?.createdBy || createdBy,
        createdAt: existing?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  return ref.id;
}

export async function deleteProjectMemo(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, PROJECT_MEMOS_COLLECTION, id));
}

export async function listProjectMemoriesByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECT_MEMORIES_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(projectMemoryFromDoc)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
}

export async function createProjectMemory(input: ProjectMemoryInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, PROJECT_MEMORIES_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateProjectMemory(id: string, input: ProjectMemoryInput) {
  const database = requireDb();
  await updateDoc(doc(database, PROJECT_MEMORIES_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function archiveProjectMemory(id: string) {
  const database = requireDb();
  await updateDoc(doc(database, PROJECT_MEMORIES_COLLECTION, id), {
    status: "archived",
    updatedAt: serverTimestamp()
  });
}

export async function deleteProjectMemory(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, PROJECT_MEMORIES_COLLECTION, id));
}

export async function getProjectAiSummary(projectId: string) {
  const database = requireDb();
  const snapshot = await getDoc(doc(database, PROJECT_SUMMARIES_COLLECTION, projectId));

  return snapshot.exists() ? projectAiSummaryFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>) : null;
}

export async function listProjectDocumentsByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECT_DOCUMENTS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(projectDocumentFromDoc)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
}

export async function createProjectDocument(input: ProjectDocumentInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, PROJECT_DOCUMENTS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateProjectDocument(id: string, input: ProjectDocumentInput) {
  const database = requireDb();
  await updateDoc(doc(database, PROJECT_DOCUMENTS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteProjectDocument(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, PROJECT_DOCUMENTS_COLLECTION, id));
}

export async function listProjectStages() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, PROJECT_STAGES_COLLECTION));

  return snapshot.docs
    .map(projectStageFromDoc)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate));
}

export async function listProjectStagesForProjects(projectIds: string[]) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, PROJECT_STAGES_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(projectStageFromDoc))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate));
}

export async function listProjectStagesByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECT_STAGES_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(projectStageFromDoc)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate));
}

export async function createProjectStage(input: ProjectStageInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, PROJECT_STAGES_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateProjectStage(id: string, input: ProjectStageInput) {
  const database = requireDb();
  await updateDoc(doc(database, PROJECT_STAGES_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteProjectStage(id: string) {
  const database = requireDb();
  const linkedMilestones = await getDocs(
    query(collection(database, MILESTONES_COLLECTION), where("stageId", "==", id))
  );
  const batch = writeBatch(database);

  linkedMilestones.docs.forEach((milestoneSnapshot) => {
    batch.update(milestoneSnapshot.ref, {
      stageId: "",
      updatedAt: serverTimestamp()
    });
  });

  batch.delete(doc(database, PROJECT_STAGES_COLLECTION, id));
  await batch.commit();
}

export async function listMilestones() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, MILESTONES_COLLECTION));

  return snapshot.docs
    .map(milestoneFromDoc)
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));
}

export async function listMilestonesForProjects(projectIds: string[]) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, MILESTONES_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(milestoneFromDoc))
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));
}

export async function listMilestonesByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, MILESTONES_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(milestoneFromDoc)
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));
}

export async function createMilestone(input: MilestoneInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, MILESTONES_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateMilestone(id: string, input: MilestoneInput) {
  const database = requireDb();
  await updateDoc(doc(database, MILESTONES_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteMilestone(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, MILESTONES_COLLECTION, id));
}

export async function listCalendarEvents() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, CALENDAR_EVENTS_COLLECTION));

  return snapshot.docs
    .map(calendarEventFromDoc)
    .sort((a, b) => {
      const dateOrder = (a.startDate || "9999-99-99").localeCompare(b.startDate || "9999-99-99");
      if (dateOrder) return dateOrder;

      return (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
    });
}

export async function listCalendarEventsForProjects(projectIds: string[]) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, CALENDAR_EVENTS_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(calendarEventFromDoc))
    .sort((a, b) => {
      const dateOrder = (a.startDate || "9999-99-99").localeCompare(b.startDate || "9999-99-99");
      if (dateOrder) return dateOrder;

      return (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
    });
}

export async function createCalendarEvent(input: CalendarEventInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, CALENDAR_EVENTS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateCalendarEvent(id: string, input: CalendarEventInput) {
  const database = requireDb();
  await updateDoc(doc(database, CALENDAR_EVENTS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteCalendarEvent(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, CALENDAR_EVENTS_COLLECTION, id));
}

export async function listLineGroups() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, LINE_GROUPS_COLLECTION));

  return snapshot.docs
    .map(lineGroupFromDoc)
    .sort((a, b) => a.groupName.localeCompare(b.groupName));
}

export async function listLineGroupsByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, LINE_GROUPS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(lineGroupFromDoc)
    .sort((a, b) => a.groupName.localeCompare(b.groupName));
}

export async function listLinePendingGroups() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, LINE_PENDING_GROUPS_COLLECTION));

  return snapshot.docs
    .map(linePendingGroupFromDoc)
    .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
}

async function deleteLinePendingGroupsByGroupId(groupId: string) {
  const database = requireDb();
  const normalized = groupId.trim();
  if (!normalized) return;

  const snapshot = await getDocs(
    query(collection(database, LINE_PENDING_GROUPS_COLLECTION), where("groupId", "==", normalized))
  );

  await Promise.all(snapshot.docs.map((pendingGroup) => deleteDoc(pendingGroup.ref)));
}

export async function createLineGroup(input: LineGroupInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, LINE_GROUPS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await deleteLinePendingGroupsByGroupId(input.groupId);

  return ref.id;
}

export async function updateLineGroup(id: string, input: LineGroupInput) {
  const database = requireDb();
  await updateDoc(doc(database, LINE_GROUPS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
  await deleteLinePendingGroupsByGroupId(input.groupId);
}

export async function deleteLineGroup(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, LINE_GROUPS_COLLECTION, id));
}

export async function listLineMembers() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, LINE_MEMBERS_COLLECTION));

  return snapshot.docs
    .map(lineMemberFromDoc)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-TW"));
}

export async function createLineMember(input: LineMemberInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, LINE_MEMBERS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateLineMember(id: string, input: LineMemberInput) {
  const database = requireDb();
  await updateDoc(doc(database, LINE_MEMBERS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteLineMember(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, LINE_MEMBERS_COLLECTION, id));
}

export async function listMessages() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, MESSAGES_COLLECTION), orderBy("timestamp", "desc"))
  );

  return snapshot.docs.map(messageFromDoc);
}

export async function listRecentMessages(maxItems = DEFAULT_RECENT_LIST_LIMIT) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, MESSAGES_COLLECTION), orderBy("timestamp", "desc"), queryLimit(maxItems))
  );

  return snapshot.docs.map(messageFromDoc);
}

export async function listMessagesByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, MESSAGES_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(messageFromDoc)
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));
}

export async function listAiTasks() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, AI_TASKS_COLLECTION));

  return snapshot.docs
    .map(aiTaskFromDoc)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listAiTasksForProjects(projectIds: string[]) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, AI_TASKS_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(aiTaskFromDoc))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listAiTasksForReview(maxReviewedItems = DEFAULT_REVIEWED_AI_TASK_LIMIT) {
  const database = requireDb();
  const [pendingSnapshot, recentSnapshot] = await Promise.all([
    getDocs(query(collection(database, AI_TASKS_COLLECTION), where("reviewStatus", "==", "pending"))),
    getDocs(
      query(
        collection(database, AI_TASKS_COLLECTION),
        orderBy("createdAt", "desc"),
        queryLimit(maxReviewedItems)
      )
    )
  ]);
  const taskById = new Map<string, AiTask>();

  [...pendingSnapshot.docs, ...recentSnapshot.docs].forEach((snapshot) => {
    taskById.set(snapshot.id, aiTaskFromDoc(snapshot));
  });

  return [...taskById.values()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listAiTasksByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, AI_TASKS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(aiTaskFromDoc)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listIncidents(maxItems = DEFAULT_RECENT_LIST_LIMIT) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, INCIDENTS_COLLECTION), orderBy("updatedAt", "desc"), queryLimit(maxItems))
  );

  return snapshot.docs.map(incidentFromDoc);
}

export async function listIncidentsByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, INCIDENTS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(incidentFromDoc)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
}

export async function updateAiTaskDraft(id: string, input: AiTaskDraftUpdateInput) {
  const database = requireDb();

  await updateDoc(doc(database, AI_TASKS_COLLECTION, id), {
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    taskType: input.taskType,
    status: input.status,
    assignedTo: input.assignedTo,
    dueDate: dateStringToTimestamp(input.dueDate),
    updatedAt: serverTimestamp()
  });
}

export async function approveAiTask(id: string, input: TaskInput, reviewedBy: string) {
  const database = requireDb();
  const aiTaskRef = doc(database, AI_TASKS_COLLECTION, id);
  const taskRef = doc(collection(database, TASKS_COLLECTION));
  const pendingReviewReminderRef = doc(database, REMINDER_LOGS_COLLECTION, `ai_task_${id}_ai_task_pending_review`);

  await runTransaction(database, async (transaction) => {
    const aiTaskSnapshot = await transaction.get(aiTaskRef);
    if (!aiTaskSnapshot.exists()) {
      throw new Error("找不到這筆 AI 草稿。");
    }

    const reviewStatus = String(aiTaskSnapshot.data().reviewStatus ?? "pending");
    if (!canReviewAiDraft(reviewStatus)) {
      throw new Error("這筆 AI 草稿已經審核過。");
    }
    const aiTaskData = aiTaskSnapshot.data();
    const attachments = readAttachments(aiTaskData.attachments).length
      ? readAttachments(aiTaskData.attachments)
      : readAttachments(input.attachments);
    const incidentId = String(aiTaskData.incidentId ?? input.incidentId ?? "");

    transaction.set(taskRef, {
      ...input,
      incidentId,
      attachments,
      attachmentMessageIds: attachments.map((attachment) => attachment.messageId),
      attachmentCount: attachments.length,
      source: "ai",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.update(aiTaskRef, {
      status: input.status,
      assignedTo: input.assignee,
      reviewStatus: "approved",
      approvedTaskId: taskRef.id,
      reviewedBy,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(
      pendingReviewReminderRef,
      {
        status: "confirmed",
        confirmedBy: reviewedBy,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastAction: "approved_ai_task"
      },
      { merge: true }
    );
    if (incidentId) {
      transaction.set(
        doc(database, INCIDENTS_COLLECTION, incidentId),
        {
          aiTaskIds: arrayUnion(id),
          taskIds: arrayUnion(taskRef.id),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }
  });

  return taskRef.id;
}

export async function rejectAiTask(id: string, reviewedBy: string) {
  const database = requireDb();
  const aiTaskRef = doc(database, AI_TASKS_COLLECTION, id);
  const pendingReviewReminderRef = doc(database, REMINDER_LOGS_COLLECTION, `ai_task_${id}_ai_task_pending_review`);

  await runTransaction(database, async (transaction) => {
    const aiTaskSnapshot = await transaction.get(aiTaskRef);
    if (!aiTaskSnapshot.exists()) {
      throw new Error("找不到這筆 AI 草稿。");
    }

    const reviewStatus = String(aiTaskSnapshot.data().reviewStatus ?? "pending");
    if (!canReviewAiDraft(reviewStatus)) {
      throw new Error("這筆 AI 草稿已經審核過。");
    }

    transaction.update(aiTaskRef, {
      reviewStatus: "rejected",
      reviewedBy,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(
      pendingReviewReminderRef,
      {
        status: "confirmed",
        confirmedBy: reviewedBy,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastAction: "rejected_ai_task"
      },
      { merge: true }
    );
  });
}

export async function listReminderLogs() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, REMINDER_LOGS_COLLECTION));

  return snapshot.docs
    .map(reminderLogFromDoc)
    .sort((a, b) => {
      const statusOrder = a.status.localeCompare(b.status);
      if (statusOrder) return statusOrder;
      if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
      return (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99");
    });
}

export async function listReminderLogsForProjects(projectIds: string[]) {
  const database = requireDb();
  const normalizedProjectIds = projectIds.filter(Boolean);
  if (!normalizedProjectIds.length) return [];

  const snapshots = await Promise.all(
    chunkArray(normalizedProjectIds, 10).map((chunk) =>
      getDocs(query(collection(database, REMINDER_LOGS_COLLECTION), where("projectId", "in", chunk)))
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map(reminderLogFromDoc))
    .sort((a, b) => {
      const statusOrder = a.status.localeCompare(b.status);
      if (statusOrder) return statusOrder;
      if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
      return (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99");
    });
}

export async function upsertPendingReminderLog(input: ReminderLogInput) {
  const database = requireDb();
  const ref = doc(database, REMINDER_LOGS_COLLECTION, input.key);
  const snapshot = await getDoc(ref);

  if (snapshot.exists() && snapshot.data().status === "confirmed") {
    return;
  }

  await setDoc(
    ref,
    {
      ...input,
      status: "pending",
      updatedAt: serverTimestamp(),
      createdAt: snapshot.exists() ? snapshot.data().createdAt ?? serverTimestamp() : serverTimestamp()
    },
    { merge: true }
  );
}

export async function confirmReminderLog(input: ReminderLogInput, confirmedBy: string) {
  const database = requireDb();
  const ref = doc(database, REMINDER_LOGS_COLLECTION, input.key);
  const snapshot = await getDoc(ref);

  await setDoc(
    ref,
    {
      ...input,
      status: "confirmed",
      confirmedBy,
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAt: snapshot.exists() ? snapshot.data().createdAt ?? serverTimestamp() : serverTimestamp()
    },
    { merge: true }
  );
}

export async function listWebhookLogs() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, WEBHOOK_LOGS_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(webhookLogFromDoc);
}
