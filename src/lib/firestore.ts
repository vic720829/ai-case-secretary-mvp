import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
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
  Milestone,
  MilestoneInput,
  LineGroup,
  LineGroupInput,
  LineMember,
  LineMemberInput,
  Message,
  Project,
  ProjectInput,
  ProjectStage,
  ProjectStageInput,
  ReminderLog,
  ReminderLogInput,
  Task,
  TaskInput,
  WebhookLog
} from "./types";

const PROJECTS_COLLECTION = "projects";
const TASKS_COLLECTION = "tasks";
const PROJECT_STAGES_COLLECTION = "projectStages";
const MILESTONES_COLLECTION = "milestones";
const LINE_GROUPS_COLLECTION = "line_groups";
const LINE_MEMBERS_COLLECTION = "line_members";
const MESSAGES_COLLECTION = "messages";
const AI_TASKS_COLLECTION = "ai_tasks";
const REMINDER_LOGS_COLLECTION = "reminder_logs";
const WEBHOOK_LOGS_COLLECTION = "webhook_logs";

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

function taskFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Task {
  const data = snapshot.data();

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

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    sourceMessageId: data.sourceMessageId ?? "",
    sourceGroupId: data.sourceGroupId ?? "",
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
    aiTaskDrafts: Number(data.aiTaskDrafts ?? 0),
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

export async function listProjects() {
  const database = requireDb();
  const snapshot = await getDocs(
    query(collection(database, PROJECTS_COLLECTION), orderBy("createdAt", "desc"))
  );

  return snapshot.docs.map(projectFromDoc);
}

export async function getProject(id: string) {
  const database = requireDb();
  const snapshot = await getDoc(doc(database, PROJECTS_COLLECTION, id));

  if (!snapshot.exists()) return null;
  return projectFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>);
}

export async function createProject(input: ProjectInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, PROJECTS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateProject(id: string, input: ProjectInput) {
  const database = requireDb();
  await updateDoc(doc(database, PROJECTS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export async function deleteProject(id: string) {
  const database = requireDb();
  const [
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

export async function createLineGroup(input: LineGroupInput) {
  const database = requireDb();
  const ref = await addDoc(collection(database, LINE_GROUPS_COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateLineGroup(id: string, input: LineGroupInput) {
  const database = requireDb();
  await updateDoc(doc(database, LINE_GROUPS_COLLECTION, id), {
    ...input,
    updatedAt: serverTimestamp()
  });
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
  const batch = writeBatch(database);

  batch.set(taskRef, {
    ...input,
    source: "ai",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.update(aiTaskRef, {
    status: input.status,
    assignedTo: input.assignee,
    reviewStatus: "approved",
    approvedTaskId: taskRef.id,
    reviewedBy,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  return taskRef.id;
}

export async function rejectAiTask(id: string, reviewedBy: string) {
  const database = requireDb();

  await updateDoc(doc(database, AI_TASKS_COLLECTION, id), {
    reviewStatus: "rejected",
    reviewedBy,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
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
