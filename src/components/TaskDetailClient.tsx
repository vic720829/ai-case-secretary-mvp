"use client";

import { ArrowLeft, ImageIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { PageHeader } from "./PageHeader";
import { TaskForm } from "./TaskForm";
import { EmptyState, LoadingState, SecondaryLink } from "./Ui";
import { useAuth } from "@/components/AuthProvider";
import { deleteTask, getTask, listProjectsForProfile, updateTask } from "@/lib/firestore";
import type { Project, Task, TaskInput } from "@/lib/types";

export function TaskDetailClient({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [nextProjects, nextTask] = await Promise.all([listProjectsForProfile(profile), getTask(taskId)]);
    setProjects(nextProjects);
    setTask(nextTask);
    setLoading(false);
  }, [profile, taskId]);

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
    return <LoadingState label="正在讀取待辦詳情" />;
  }

  if (!task) {
    return (
      <EmptyState
        title="找不到待辦"
        description="這個待辦可能已被刪除，請回到待辦列表確認。"
        action={
          <SecondaryLink href="/tasks">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回待辦列表
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
              回待辦列表
            </SecondaryLink>
            <ConfirmDeleteButton
              confirmMessage={`確定刪除待辦「${task.title}」？`}
              onConfirm={handleDelete}
            />
          </>
        }
      />
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <TaskForm projects={projects} initialValue={task} submitLabel="儲存待辦" onSubmit={handleSave} />
      </section>
      <TaskAttachmentSection task={task} />
    </div>
  );
}

function TaskAttachmentSection({ task }: { task: Task }) {
  const attachments = task.attachments ?? [];
  if (!attachments.length) return null;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <ImageIcon className="h-4 w-4 text-teal-700" aria-hidden />
        相關照片 / LINE 附件
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {attachments.map((attachment) => (
          <a
            key={attachment.messageId}
            className="group overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
            href={attachment.fileUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Image
              className="aspect-video w-full bg-stone-100 object-cover"
              src={attachment.fileUrl}
              alt="LINE 附件"
              width={640}
              height={360}
              unoptimized
            />
            <div className="p-3 text-xs text-slate-500">
              <div className="font-medium text-slate-700">{attachment.senderName || "LINE 使用者"}</div>
              <div className="mt-1">點擊開啟原圖</div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
