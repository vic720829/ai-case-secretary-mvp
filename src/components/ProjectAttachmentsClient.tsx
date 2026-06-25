"use client";

import { ArrowLeft, CheckSquare, ImageIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { getProject, listMessagesByProject, listTasksByProject } from "@/lib/firestore";
import type { Message, Project, Task } from "@/lib/types";

export function ProjectAttachmentsClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextMessages, nextTasks] = await Promise.all([
        getProject(projectId),
        listMessagesByProject(projectId),
        listTasksByProject(projectId)
      ]);
      setProject(nextProject);
      setMessages(nextMessages);
      setTasks(nextTasks);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const attachmentMessages = useMemo(
    () => messages.filter((message) => message.fileUrl && message.messageType === "image"),
    [messages]
  );
  const tasksByMessageId = useMemo(() => {
    const next = new Map<string, Task[]>();

    tasks.forEach((task) => {
      (task.attachmentMessageIds ?? []).forEach((messageId) => {
        next.set(messageId, [...(next.get(messageId) ?? []), task]);
      });
    });

    return next;
  }, [tasks]);

  if (loading) {
    return <LoadingState label="正在讀取案件附件" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="這個案件可能已被刪除，請回到案件列表確認。"
        action={
          <SecondaryLink href="/projects">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件列表
          </SecondaryLink>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} 案件附件`}
        description={`${project.clientName} / 集中查看 LINE 圖片、照片證據與已掛待辦。`}
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <ErrorMessage message={error} />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <ImageIcon className="h-4 w-4 text-teal-700" aria-hidden />
          LINE 圖片附件
        </div>

        {attachmentMessages.length ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {attachmentMessages.map((message) => {
              const linkedTasks = tasksByMessageId.get(message.id) ?? [];

              return (
                <article key={message.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                  <a href={message.fileUrl} target="_blank" rel="noreferrer" title="開啟原圖">
                    <Image
                      className="aspect-video w-full bg-stone-100 object-cover"
                      src={message.fileUrl}
                      alt="LINE 圖片附件"
                      width={640}
                      height={360}
                      unoptimized
                    />
                  </a>
                  <div className="space-y-3 p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">{message.senderName || "LINE 使用者"}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(message.timestamp ?? message.createdAt)}</div>
                    </div>
                    {linkedTasks.length ? (
                      <div className="rounded-md bg-teal-50 p-3 text-xs text-teal-800">
                        <div className="mb-2 flex items-center gap-1.5 font-semibold">
                          <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                          已掛到待辦
                        </div>
                        <div className="space-y-1">
                          {linkedTasks.map((task) => (
                            <Link key={task.id} className="block hover:text-teal-950" href={`/tasks/${task.id}`}>
                              {task.title}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md bg-amber-50 p-3 text-xs font-medium text-amber-800">
                        尚未掛到正式待辦
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="此案件尚無圖片附件" description="客戶或團隊在 LINE 傳送圖片後，會集中顯示在這裡。" />
        )}
      </section>
    </div>
  );
}
