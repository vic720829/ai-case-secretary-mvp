"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TaskTable } from "@/components/TaskTable";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink } from "@/components/Ui";
import { getReadableError } from "@/lib/errors";
import { deleteTask, listProjects, listRecentTasks } from "@/lib/firestore";
import type { Project, Task } from "@/lib/types";

const visibleTaskLimit = 150;

export default function TasksPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setError("");

    try {
      const [nextProjects, nextTasks] = await Promise.all([listProjects(), listRecentTasks(visibleTaskLimit)]);
      setProjects(nextProjects);
      setTasks(nextTasks);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleDelete(task: Task) {
    const confirmed = window.confirm(`確定刪除待辦「${task.title}」？`);
    if (!confirmed) return;

    try {
      await deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取待辦" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="待辦列表"
        description="追蹤所有案件待辦，包含來源、負責人、截止日與風險等級。"
        action={
          <PrimaryLink href="/tasks/new">
            <Plus className="h-4 w-4" aria-hidden />
            新增待辦
          </PrimaryLink>
        }
      />
      <ErrorMessage message={error} />
      {!error && tasks.length ? (
        <p className="text-sm text-slate-500">
          目前顯示最新 {visibleTaskLimit} 筆待辦；今日風險與提醒中心仍會完整檢查全部資料。
        </p>
      ) : null}
      {error ? (
        <EmptyState
          title="待辦讀取失敗"
          description="請先確認 Firebase Authentication 已登入，並在 Firestore Rules 發布登入後可讀寫的規則。"
        />
      ) : null}
      {!error && tasks.length ? (
        <TaskTable tasks={tasks} projects={projects} onDelete={handleDelete} />
      ) : null}
      {!error && !tasks.length ? (
        <EmptyState
          title="尚未建立待辦"
          description="新增待辦後，今日風險中心會自動整理高風險、逾期與今天到期項目。"
          action={
            <PrimaryLink href="/tasks/new">
              <Plus className="h-4 w-4" aria-hidden />
              新增待辦
            </PrimaryLink>
          }
        />
      ) : null}
    </div>
  );
}
