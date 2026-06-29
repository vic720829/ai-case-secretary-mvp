"use client";

import { ArrowLeft, ExternalLink, NotebookText, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDate, formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { createProjectMemo, deleteProjectMemo, getProject, listProjectMemosByProject } from "@/lib/firestore";
import type { Project, ProjectMemo } from "@/lib/types";
import { RiskBadge, TaskStatusBadge } from "./StatusBadges";

export function ProjectMemosClient({ projectId }: { projectId: string }) {
  const { profile, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [memos, setMemos] = useState<ProjectMemo[]>([]);
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextMemos] = await Promise.all([
        getProject(projectId),
        listProjectMemosByProject(projectId)
      ]);
      setProject(nextProject);
      setMemos(nextMemos);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleDeleteMemo(memo: ProjectMemo) {
    await deleteProjectMemo(memo.id);
    setMemos((current) => current.filter((item) => item.id !== memo.id));
  }

  async function handleCreateMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setSubmitting(true);

    try {
      const title = memoTitle.trim();
      const content = memoContent.trim();

      if (!title) throw new Error("請輸入備忘錄標題。");
      if (!content) throw new Error("請輸入備忘錄內容。");

      await createProjectMemo({
        projectId,
        title,
        content,
        createdBy: profile?.displayName || user?.email || ""
      });
      setMemoTitle("");
      setMemoContent("");
      setSuccessMessage(`已新增備忘錄：${title}`);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取案件備忘錄" />;
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
        title={`${project.name} 案件備忘錄`}
        description={`${project.clientName} / 集中記錄已答應客戶的變更、尺寸、做法與重要承諾。`}
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <ErrorMessage message={error} />
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700">
            <NotebookText className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">備忘錄用途</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              待辦完成代表事情處理完；備忘錄保留當初答應過客戶什麼，例如改尺寸、改顏色、增加施工項目或後續承諾。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Plus className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">新增備忘錄</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              不一定要從待辦轉入，也可以手動記錄客戶同意、現場變更、尺寸調整或之後查案會用到的重點。
            </p>
          </div>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={(event) => void handleCreateMemo(event)}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">標題</span>
            <input
              className={inputClassName}
              value={memoTitle}
              onChange={(event) => setMemoTitle(event.target.value)}
              placeholder="例如：客戶同意主臥衣櫃改尺寸"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">內容</span>
            <textarea
              className={`${inputClassName} min-h-28 resize-y`}
              value={memoContent}
              onChange={(event) => setMemoContent(event.target.value)}
              placeholder="記錄答應過什麼、誰提出、什麼時間、後續要注意什麼。"
              required
            />
          </label>

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !memoTitle.trim() || !memoContent.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              {submitting ? "儲存中" : "新增備忘錄"}
            </Button>
          </div>
        </form>
      </section>

      {memos.length ? (
        <section className="space-y-3">
          {memos.map((memo) => (
            <article key={memo.id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-950">{memo.title}</h2>
                    {memo.sourceTaskStatus ? <TaskStatusBadge status={memo.sourceTaskStatus} /> : null}
                    {memo.sourceTaskRiskLevel ? <RiskBadge risk={memo.sourceTaskRiskLevel} /> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{memo.content}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                    {memo.sourceTaskId ? (
                      <Link
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800"
                        href={`/tasks/${memo.sourceTaskId}`}
                      >
                        原待辦：{memo.sourceTaskTitle || memo.sourceTaskId}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </Link>
                    ) : null}
                    {memo.sourceTaskDueDate ? <span>原截止日：{formatDate(memo.sourceTaskDueDate)}</span> : null}
                    {memo.createdBy ? <span>建立者：{memo.createdBy}</span> : null}
                    <span>建立時間：{formatDateTime(memo.createdAt)}</span>
                  </div>
                </div>
                <ConfirmDeleteButton
                  label="移除"
                  confirmMessage={`確定移除備忘錄「${memo.title}」？原待辦不會被刪除。`}
                  onConfirm={() => handleDeleteMemo(memo)}
                />
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="尚未建立案件備忘錄"
          description="在案件待辦或今日風險中心按「加入備忘錄」，就會把重要承諾與變更保存到這裡。"
        />
      )}
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";
