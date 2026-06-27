import type { User } from "firebase/auth";

type TaskNotificationAction = "manual_created" | "ai_approved";

export async function notifyAdminGroupsAboutTask(input: {
  user: User | null;
  taskId: string;
  action: TaskNotificationAction;
}) {
  if (!input.user || !input.taskId) return;

  const token = await input.user.getIdToken();
  const response = await fetch("/api/tasks/notify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      taskId: input.taskId,
      action: input.action
    })
  });

  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    sent?: number;
    failed?: number;
    error?: string;
  } | null;

  if (!response.ok || result?.ok === false || (result?.sent === 0 && Number(result.failed ?? 0) > 0)) {
    throw new Error(result?.error || "通知公司後台群失敗。");
  }
}
