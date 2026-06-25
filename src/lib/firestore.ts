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
  Milestone,
  MilestoneInput,
  LineGroup,
  LineGroupInput,
  Message,
  Project,
  ProjectInput,
  ProjectStage,
  ProjectStageInput,
  Task,
  TaskInput
} from "./types";

const PROJECTS_COLLECTION = "projects";
const TASKS_COLLECTION = "tasks";
const PROJECT_STAGES_COLLECTION = "projectStages";
const MILESTONES_COLLECTION = "milestones";
const LINE_GROUPS_COLLECTION = "line_groups";
const MESSAGES_COLLECTION = "messages";
const AI_TASKS_COLLECTION = "ai_tasks";

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
    createdAt: readTimestamp(data.createdAt)
  };
}

function messageFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Message {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    groupId: data.groupId ?? "",
    senderId: data.senderId ?? "",
    senderName: data.senderName ?? "",
    messageType: data.messageType ?? "text",
    text: data.text ?? "",
    fileUrl: data.fileUrl ?? "",
    timestamp: readTimestamp(data.timestamp),
    isProcessed: Boolean(data.isProcessed ?? false)
  };
}

function aiTaskFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): AiTask {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: data.projectId ?? "",
    sourceMessageId: data.sourceMessageId ?? "",
    title: data.title ?? "",
    description: data.description ?? "",
    taskType: data.taskType ?? "followup",
    status: data.status ?? "todo",
    assignedTo: data.assignedTo ?? "",
    dueDate: readTimestamp(data.dueDate),
    createdByAI: Boolean(data.createdByAI ?? true),
    createdAt: readTimestamp(data.createdAt)
  };
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
  const [linkedTasks, linkedStages, linkedMilestones, linkedLineGroups, linkedMessages, linkedAiTasks] = await Promise.all([
    getDocs(query(collection(database, TASKS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, PROJECT_STAGES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, MILESTONES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, LINE_GROUPS_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, MESSAGES_COLLECTION), where("projectId", "==", id))),
    getDocs(query(collection(database, AI_TASKS_COLLECTION), where("projectId", "==", id)))
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
  linkedAiTasks.docs.forEach((aiTaskSnapshot) => {
    batch.delete(aiTaskSnapshot.ref);
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
  await deleteDoc(doc(database, PROJECT_STAGES_COLLECTION, id));
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
    createdAt: serverTimestamp()
  });

  return ref.id;
}

export async function deleteLineGroup(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, LINE_GROUPS_COLLECTION, id));
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
