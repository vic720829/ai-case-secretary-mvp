import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
import type {
  AiTask,
  AiTaskDraftUpdateInput,
  AuditActor,
  AuditLog,
  Milestone,
  MilestoneInput,
  LineGroup,
  LineGroupInput,
  LinePendingGroup,
  LineMember,
  LineMemberInput,
  Message,
  MessageAttachment,
  Project,
  ProjectInput,
  ProjectStage,
  ProjectStageInput,
  ReminderLog,
  ReminderLogInput,
  Task,
  TaskInput,
  UserProfile,
  UserProfileInput,
  WebhookLog
} from "./types";

const PROJECTS_COLLECTION = "projects";
const TASKS_COLLECTION = "tasks";
const PROJECT_STAGES_COLLECTION = "projectStages";
const MILESTONES_COLLECTION = "milestones";
const LINE_GROUPS_COLLECTION = "line_groups";
const LINE_PENDING_GROUPS_COLLECTION = "line_pending_groups";
const LINE_MEMBERS_COLLECTION = "line_members";
const MESSAGES_COLLECTION = "messages";
const AI_TASKS_COLLECTION = "ai_tasks";
const REMINDER_LOGS_COLLECTION = "reminder_logs";
const WEBHOOK_LOGS_COLLECTION = "webhook_logs";
const USERS_COLLECTION = "users";
const AUDIT_LOGS_COLLECTION = "audit_logs";

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
          attachment.fileType === "audio" || attachment.fileType === "image" || attachment.fileType === "text"
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

function taskFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Task {
  const data = snapshot.data();
  const attachments = readAttachments(data.attachments);

  return {
    id: snapshot.id,
    title: data.title ?? "",
    description: data.description ?? "",
    projectId: data.projectId ?? "",
    assignee: data.assignee ?? "",
    dueDate: data.dueDate ?? "",
    status: data.status ?? "todo",
    source: data.source ?? "manual",
    riskLevel: data.riskLevel ?? "low",
    attachments,
    attachmentMessageIds: Array.isArray(data.attachmentMessageIds)
      ? data.attachmentMessageIds.map((id: unknown) => String(id)).filter(Boolean)
      : attachments.map((attachment) => attachment.messageId),
    attachmentCount: Number(data.attachmentCount ?? attachments.length),
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
    riskLevel: data.riskLevel ?? "low",
    reminderDaysBefore: Number(data.reminderDaysBefore ?? 0),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function lineGroupFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): LineGroup {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    groupId: data.groupId ?? "",
    projectId: data.projectId ?? "",
    groupName: data.groupName ?? "",
    groupType: data.groupType ?? "project",
    allowAssistantReplies: Boolean(data.allowAssistantReplies ?? false),
    createdAt: readTimestamp(data.createdAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
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
    sourceMessageId: data.sourceMessageId ?? "",
    sourceGroupId: data.sourceGroupId ?? "",
    sourceSenderId: data.sourceSenderId ?? "",
    sourceSenderName: data.sourceSenderName ?? "",
    sourceSenderRole: data.sourceSenderRole ?? "unknown",
    title: data.title ?? "",
    description: data.description ?? "",
    taskType: data.taskType ?? "followup",
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
    { key: "expectedFinishDate", label: "預計完工日" }
  ];

  return fields
    .map(({ key, label }) => ({
      field: label,
      before: before?.[key] ?? "",
      after: after?.[key] ?? ""
    }))
    .filter((change) => change.before !== change.after);
}

export async function listProjects() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECTS_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(projectFromDoc);
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
    linkedStages,
    linkedMilestones,
    linkedLineGroups,
    linkedMessages,
    linkedLineMembers,
    linkedAiTasks,
    linkedReminderLogs,
    linkedWebhookLogs
  ] = await Promise.all([
    getDoc(doc(database, PROJECTS_COLLECTION, id)),
    getDocs(query(collection(database, TASKS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, PROJECT_STAGES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, MILESTONES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, LINE_GROUPS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, MESSAGES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, LINE_MEMBERS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, AI_TASKS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, REMINDER_LOGS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, WEBHOOK_LOGS_COLLECTION), where("projectId", "==", id)))
  ]);
  const project = projectSnapshot.exists() ? projectFromDoc(projectSnapshot as QueryDocumentSnapshot<DocumentData>) : null;
  const batch = writeBatch(database);

  linkedTasks.docs.forEach((taskSnapshot) => {
    batch.delete(taskSnapshot.ref);
  });
  linkedStages.docs.forEach((stageSnapshot) => {
    batch.delete(stageSnapshot.ref);
  });
  linkedMilestones.docs.forEach((milestoneSnapshot) => {
    batch.delete(milestoneSnapshot.ref);
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
  linkedReminderLogs.docs.forEach((reminderLogSnapshot) => {
    batch.delete(reminderLogSnapshot.ref);
  });
  linkedWebhookLogs.docs.forEach((webhookLogSnapshot) => {
    batch.delete(webhookLogSnapshot.ref);
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

export async function listProjectStages() {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, PROJECT_STAGES_COLLECTION));

  return snapshot.docs
    .map(projectStageFromDoc)
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

export async function listAiTasksByProject(projectId: string) {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, AI_TASKS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(aiTaskFromDoc)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
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
    if (reviewStatus !== "pending") {
      throw new Error("這筆 AI 草稿已經審核過。");
    }
    const aiTaskData = aiTaskSnapshot.data();
    const attachments = readAttachments(aiTaskData.attachments).length
      ? readAttachments(aiTaskData.attachments)
      : readAttachments(input.attachments);

    transaction.set(taskRef, {
      ...input,
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
    if (reviewStatus !== "pending") {
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
