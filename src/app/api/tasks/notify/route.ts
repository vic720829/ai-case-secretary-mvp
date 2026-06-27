import type { DocumentData } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { pushLineMessages, type LinePushMessage } from "@/services/line";
import type { RiskLevel, TaskSource, TaskStatus, UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaskNotificationAction = "manual_created" | "ai_approved";

type TaskNotificationBody = {
  taskId?: string;
  action?: TaskNotificationAction;
};

type TaskNotificationCaller = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
};

type StoredTask = {
  title: string;
  description: string;
  projectId: string;
  assignee: string;
  dueDate: string;
  status: TaskStatus;
  source: TaskSource;
  riskLevel: RiskLevel;
  attachmentCount: number;
};

const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "待辦",
  doing: "進行中",
  done: "完成"
};

const taskSourceLabels: Record<TaskSource, string> = {
  manual: "手動",
  line: "LINE",
  ai: "AI",
  voice: "語音"
};

const riskLevelLabels: Record<RiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

export async function POST(request: Request) {
  try {
    const caller = await verifyTaskNotificationCaller(request);
    if (!caller.ok) {
      return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
    }

    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      return NextResponse.json({ ok: false, error: "LINE Channel Access Token 尚未設定。" }, { status: 500 });
    }

    const body = (await request.json()) as TaskNotificationBody;
    const taskId = String(body.taskId ?? "").trim();
    const action = body.action === "ai_approved" ? "ai_approved" : "manual_created";

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "缺少待辦 ID。" }, { status: 400 });
    }

    const db = getAdminDb();
    const taskSnapshot = await db.collection("tasks").doc(taskId).get();

    if (!taskSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "找不到這筆待辦。" }, { status: 404 });
    }

    const task = normalizeTask(taskSnapshot.data() ?? {});
    const adminGroupIds = await listAssistantAdminGroupIds();

    if (!adminGroupIds.length) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, reason: "目前沒有可通知的公司後台群。" });
    }

    const projectSnapshot = task.projectId ? await db.collection("projects").doc(task.projectId).get() : null;
    const project = projectSnapshot?.exists ? projectSnapshot.data() ?? {} : {};
    const messages = buildTaskNotificationMessages({
      action,
      taskId,
      task,
      projectName: String(project.name ?? ""),
      clientName: String(project.clientName ?? ""),
      caller: caller.value
    });
    const results = await Promise.allSettled(adminGroupIds.map((groupId) => pushLineMessages(groupId, messages)));
    const failed = results.filter((result) => result.status === "rejected").length;

    return NextResponse.json({
      ok: true,
      sent: results.length - failed,
      failed
    });
  } catch (caught) {
    return NextResponse.json(
      { ok: false, error: caught instanceof Error ? caught.message : "通知公司後台群失敗。" },
      { status: 500 }
    );
  }
}

async function verifyTaskNotificationCaller(request: Request): Promise<
  | { ok: true; value: TaskNotificationCaller }
  | { ok: false; status: number; error: string }
> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return { ok: false, status: 401, error: "尚未登入，請重新登入後再試。" };
  }

  try {
    const auth = await getAdminAuth();
    const decoded = await auth.verifyIdToken(token);
    const userSnapshot = await getAdminDb().collection("users").doc(decoded.uid).get();
    const user = userSnapshot.data();
    const role = normalizeRole(user?.role);
    const active = user?.active !== false;

    if (!userSnapshot.exists || !active || !role || role === "viewer") {
      return { ok: false, status: 403, error: "目前帳號沒有建立待辦通知權限。" };
    }

    return {
      ok: true,
      value: {
        uid: decoded.uid,
        email: String(user?.email ?? decoded.email ?? ""),
        displayName: String(user?.displayName ?? decoded.name ?? ""),
        role
      }
    };
  } catch {
    return { ok: false, status: 401, error: "登入驗證失效，請重新登入後再試。" };
  }
}

async function listAssistantAdminGroupIds() {
  const snapshot = await getAdminDb().collection("line_groups").where("groupType", "==", "admin").get();

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((group) => group.allowAssistantReplies !== false)
    .map((group) => String(group.groupId ?? "").trim())
    .filter(Boolean);
}

function buildTaskNotificationMessages(input: {
  action: TaskNotificationAction;
  taskId: string;
  task: StoredTask;
  projectName: string;
  clientName: string;
  caller: TaskNotificationCaller;
}): LinePushMessage[] {
  const siteUrl = getSiteUrl();
  const projectLabel = input.projectName || input.clientName
    ? `${input.projectName || "未命名案件"} / ${input.clientName || "未填客戶"}`
    : "未綁定案件";
  const title = input.action === "ai_approved" ? "網站核准 AI 草稿並建立待辦" : "網站新增待辦";
  const actor = input.caller.displayName || input.caller.email || input.caller.uid;
  const lines = [
    title,
    `案件：${projectLabel}`,
    `待辦：${input.task.title || "未命名待辦"}`,
    `負責人：${input.task.assignee || "未指定"}`,
    `截止日：${input.task.dueDate || "未設定"}`,
    `狀態：${taskStatusLabels[input.task.status] ?? input.task.status}`,
    `風險：${riskLevelLabels[input.task.riskLevel] ?? input.task.riskLevel}`,
    `來源：${taskSourceLabels[input.task.source] ?? input.task.source}`,
    input.task.attachmentCount ? `附件：${input.task.attachmentCount} 張` : "",
    `建立者：${actor}`,
    siteUrl ? `查看待辦：${siteUrl}/tasks/${input.taskId}` : ""
  ].filter(Boolean);

  return [{ type: "text", text: lines.join("\n") }];
}

function normalizeTask(data: DocumentData): StoredTask {
  return {
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    projectId: String(data.projectId ?? ""),
    assignee: String(data.assignee ?? ""),
    dueDate: String(data.dueDate ?? ""),
    status: normalizeTaskStatus(data.status),
    source: normalizeTaskSource(data.source),
    riskLevel: normalizeRiskLevel(data.riskLevel),
    attachmentCount: Number(data.attachmentCount ?? 0)
  };
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  if (value === "todo" || value === "doing" || value === "done") return value;
  return "todo";
}

function normalizeTaskSource(value: unknown): TaskSource {
  if (value === "manual" || value === "line" || value === "ai" || value === "voice") return value;
  return "manual";
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "low";
}

function normalizeRole(value: unknown): UserRole | null {
  if (value === "owner" || value === "admin" || value === "staff" || value === "viewer") return value;
  return null;
}

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
}
