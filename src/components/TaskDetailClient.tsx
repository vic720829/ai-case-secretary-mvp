"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { PageHeader } from "./PageHeader";
import { TaskForm } from "./TaskForm";
import { EmptyState, LoadingState, SecondaryLink } from "./Ui";
import { deleteTask, getTask, listProjects, updateTask } from "@/lib/firestore";
import type { Project, Task, TaskInput } from "@/lib/types";

export function TaskDetailClient({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [nextProjects, nextTask] = await Promise.all([listProjects(), getTask(taskId)]);
    setProjects(nextProjects);
    setTask(nextTask);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSave(value: TaskInput) {
    await updateTask(taskId, value);
    await loadData();
  }

  async function handleDelete() {
    await deleteTask(taskId);
    router.push("/tasks");
  }

  if (loading) {
    return <LoadingState label="正在讀取任務詳情" />;
  }

  if (!task) {
    return (
      <EmptyState
        title="找不到任務"
        description="這個任務可能已被刪除，請回到任務列表確認。"
        action={
          <SecondaryLink href="/tasks">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回任務列表
          </SecondaryLink>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={task.title}
        description={task.assignee ? `負責人：${task.assignee}` : "尚未指派負責人"}
        action={
          <>
            <SecondaryLink href="/tasks">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              回任務列表
            </SecondaryLink>
            <ConfirmDeleteButton
              confirmMessage={`確定刪除任務「${task.title}」？`}
              onConfirm={handleDelete}
            />
          </>
        }
      />
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <TaskForm projects={projects} initialValue={task} submitLabel="儲存任務" onSubmit={handleSave} />
      </section>
    </div>
  );
}
