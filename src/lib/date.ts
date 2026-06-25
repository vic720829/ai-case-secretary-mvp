import type { TaskStatus } from "./types";

export function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDate(value: string) {
  if (!value) return "未設定";
  return value.replaceAll("-", "/");
}

export function formatDateTime(value: Date | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

export function isTaskOverdue(dueDate: string, status: TaskStatus) {
  if (!dueDate || status === "done") return false;
  return dueDate < todayInputValue();
}

export function isTaskDueToday(dueDate: string, status: TaskStatus) {
  if (!dueDate || status === "done") return false;
  return dueDate === todayInputValue();
}

export function isDateOverdue(date: string) {
  if (!date) return false;
  return date < todayInputValue();
}

export function isDateDueSoon(date: string, daysAhead = 7) {
  if (!date) return false;

  const today = todayInputValue();
  const target = new Date(today);
  target.setDate(target.getDate() + daysAhead);

  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const limit = `${year}-${month}-${day}`;

  return date >= today && date <= limit;
}
