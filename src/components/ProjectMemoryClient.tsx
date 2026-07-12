"use client";

import { ArrowLeft, BrainCircuit, CalendarClock, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDateTime, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  archiveProjectMemory,
  createProjectMemory,
  deleteProjectMemory,
  getProject,
  listProjectMemoriesByProject
} from "@/lib/firestore";
import type { Project, ProjectMemory, ProjectMemoryImportance, ProjectMemoryType } from "@/lib/types";

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

export function ProjectMemoryClient({ projectId }: { projectId: string }) {
  const { profile, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [memoryType, setMemoryType] = useState<ProjectMemoryType>("permanent");
  const [importance, setImportance] = useState<ProjectMemoryImportance>("normal");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextMemories] = await Promise.all([
        getProject(projectId),
        listProjectMemoriesByProject(projectId)
      ]);
      setProject(nextProject);
      setMemories(nextMemories);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeMemories = useMemo(
    () => memories.filter((memory) => memory.status === "active" && !isExpired(memory)),
    [memories]
  );
  const inactiveMemories = useMemo(
    () => memories.filter((memory) => memory.status !== "active" || isExpired(memory)),
    [memories]
  );

  async function handleCreateMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setSubmitting(true);

    try {
      const nextTitle = title.trim();
      const nextContent = content.trim();

      if (!nextTitle) throw new Error("請輸入記憶標題。");
      if (!nextContent) throw new Error("請輸入記憶內容。");
      if (memoryType === "temporary" && !expiresAt) throw new Error("暫時記憶請設定到期日。");

      await createProjectMemory({
        projectId,
        title: nextTitle,
        content: nextContent,
        memoryType,
        status: "active",
        importance,
        expiresAt: memoryType === "temporary" ? expiresAt : "",
        createdBy: profile?.displayName || user?.email || ""
      });
      setTitle("");
      setContent("");
      setMemoryType("permanent");
      setImportance("normal");
      setExpiresAt("");
      setSuccessMessage(`已新增 AI 案件記憶：${nextTitle}`);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(memory: ProjectMemory) {
    await archiveProjectMemory(memory.id);
    await loadData();
  }

  async function handleDelete(memory: ProjectMemory) {
    await deleteProjectMemory(memory.id);
    setMemories((current) => current.filter((item) => item.id !== memory.id));
  }

  if (loading) {
    return <LoadingState label="讀取 AI 案件記憶中" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="這個案件可能已被刪除，請回案件列表重新選擇。"
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
        title={`${project.name} AI 案件記憶`}
        description={`${project.clientName} / 給 AI 之後判斷案件背景用，分成永久記憶與暫時記憶。`}
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

      <section className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="有效記憶" value={activeMemories.length} />
        <SummaryCard label="永久記憶" value={activeMemories.filter((memory) => memory.memoryType === "permanent").length} />
        <SummaryCard label="暫時記憶" value={activeMemories.filter((memory) => memory.memoryType === "temporary").length} />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <BrainCircuit className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">新增 AI 案件記憶</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              永久記憶適合放客戶偏好、已確認變更、長期規則；暫時記憶適合放近期要追蹤、到期後不需要一直參考的事項。
            </p>
          </div>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={(event) => void handleCreateMemory(event)}>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">記憶類型</span>
              <select
                className={inputClassName}
                value={memoryType}
                onChange={(event) => {
                  const nextType = event.target.value as ProjectMemoryType;
                  setMemoryType(nextType);
                  if (nextType === "permanent") setExpiresAt("");
                }}
              >
                <option value="permanent">永久記憶</option>
                <option value="temporary">暫時記憶</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">重要性</span>
              <select
                className={inputClassName}
                value={importance}
                onChange={(event) => setImportance(event.target.value as ProjectMemoryImportance)}
              >
                <option value="normal">一般</option>
                <option value="high">重要</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">暫時記憶到期日</span>
              <input
                className={inputClassName}
                type="date"
                min={todayInputValue()}
                value={expiresAt}
                disabled={memoryType === "permanent"}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">標題</span>
            <input
              className={inputClassName}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：客戶指定所有變更要先報價"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">內容</span>
            <textarea
              className={`${inputClassName} min-h-28 resize-y`}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="例如：此案件客戶對追加金額敏感，任何尺寸、材料、收納變更都要先報價並取得確認。"
              required
            />
          </label>

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !title.trim() || !content.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              {submitting ? "新增中" : "新增記憶"}
            </Button>
          </div>
        </form>
      </section>

      <MemorySection
        title="有效 AI 案件記憶"
        description="AI 之後判斷案件背景時，會優先參考這些記憶。"
        memories={activeMemories}
        onArchive={handleArchive}
        onDelete={handleDelete}
      />

      {inactiveMemories.length ? (
        <MemorySection
          title="已封存 / 已過期記憶"
          description="這些記憶保留作查詢，不建議再讓 AI 當成目前背景。"
          memories={inactiveMemories}
          onArchive={handleArchive}
          onDelete={handleDelete}
          muted
        />
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-4 shadow-panel">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function MemorySection({
  title,
  description,
  memories,
  onArchive,
  onDelete,
  muted = false
}: {
  title: string;
  description: string;
  memories: ProjectMemory[];
  onArchive: (memory: ProjectMemory) => Promise<void>;
  onDelete: (memory: ProjectMemory) => Promise<void>;
  muted?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {memories.length ? (
        <div className="grid gap-3">
          {memories.map((memory) => (
            <article
              key={memory.id}
              className={`rounded-lg border border-stone-200 bg-white p-5 shadow-panel ${muted ? "opacity-80" : ""}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-950">{memory.title}</h3>
                    <MemoryBadge memory={memory} />
                    {memory.importance === "high" ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        重要
                      </span>
                    ) : null}
                    {isExpired(memory) ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                        已過期
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{memory.content}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                    {memory.expiresAt ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                        到期：{memory.expiresAt.replaceAll("-", "/")}
                      </span>
                    ) : null}
                    {memory.createdBy ? <span>建立者：{memory.createdBy}</span> : null}
                    <span>更新時間：{formatDateTime(memory.updatedAt ?? memory.createdAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {memory.status === "active" ? (
                    <Button type="button" variant="secondary" onClick={() => void onArchive(memory)}>
                      封存
                    </Button>
                  ) : null}
                  <ConfirmDeleteButton
                    label="刪除"
                    confirmMessage={`確定刪除 AI 案件記憶「${memory.title}」？`}
                    onConfirm={() => onDelete(memory)}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="目前沒有 AI 案件記憶" description="新增後，AI 之後可以把這些內容當成案件背景。" />
      )}
    </section>
  );
}

function MemoryBadge({ memory }: { memory: ProjectMemory }) {
  if (memory.memoryType === "temporary") {
    return (
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
        暫時記憶
      </span>
    );
  }

  return (
    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
      永久記憶
    </span>
  );
}

function isExpired(memory: ProjectMemory) {
  return memory.memoryType === "temporary" && Boolean(memory.expiresAt) && memory.expiresAt < todayInputValue();
}
