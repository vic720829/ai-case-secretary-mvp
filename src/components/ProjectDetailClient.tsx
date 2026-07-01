"use client";

import { ArrowLeft, BrainCircuit, Edit3, Gauge, ImageIcon, MessageSquareText, NotebookText, Plus, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { PageHeader } from "./PageHeader";
import { ProjectForm } from "./ProjectForm";
import { TaskTable } from "./TaskTable";
import { Button, EmptyState, ErrorMessage, LoadingState, PrimaryLink, SecondaryLink } from "./Ui";
import { useAuth } from "@/components/AuthProvider";
import { toAuditActor } from "@/lib/audit";
import {
  deleteProject,
  deleteTask,
  createProjectMemoFromTask,
  getProject,
  listProjectMemosByProject,
  listTasksByProject,
  updateProject
} from "@/lib/firestore";
import type { Project, ProjectInput, ProjectMemo, Task } from "@/lib/types";

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memos, setMemos] = useState<ProjectMemo[]>([]);
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memoMessage, setMemoMessage] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    const [nextProject, nextTasks, nextMemos] = await Promise.all([
      getProject(projectId),
      listTasksByProject(projectId),
      listProjectMemosByProject(projectId)
    ]);

    setProject(nextProject);
    setTasks(nextTasks);
    setMemos(nextMemos);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSave(value: ProjectInput) {
    await updateProject(projectId, value, toAuditActor(user));
    await loadData();
    setProjectEditorOpen(false);
  }

  async function handleDeleteProject() {
    await deleteProject(projectId, toAuditActor(user));
    router.push("/projects");
  }

  async function handleDeleteTask(task: Task) {
    const confirmed = window.confirm(`確定刪除待辦「${task.title}」？`);
    if (!confirmed) return;

    try {
      await deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "刪除待辦失敗。";
      setError(message);
    }
  }

  async function handleAddTaskMemo(task: Task) {
    setError("");
    setMemoMessage("");

    try {
      await createProjectMemoFromTask(task, user?.displayName || user?.email || "");
      await loadData();
      setMemoMessage(`已加入案件備忘錄：${task.title}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "加入備忘錄失敗。";
      setError(message);
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取案件詳情" />;
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
        title={project.name}
        description={`${project.clientName} / ${project.currentStage}`}
        action={
          <>
            <SecondaryLink href="/projects">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              回案件列表
            </SecondaryLink>
            <Button type="button" variant="secondary" onClick={() => setProjectEditorOpen(true)}>
              <Edit3 className="h-4 w-4" aria-hidden />
              編輯案件
            </Button>
            <SecondaryLink href={`/projects/${projectId}/progress`}>
              <Gauge className="h-4 w-4" aria-hidden />
              工程進度
            </SecondaryLink>
            <SecondaryLink href={`/projects/${projectId}/messages`}>
              <MessageSquareText className="h-4 w-4" aria-hidden />
              LINE 對話
            </SecondaryLink>
            <SecondaryLink href={`/projects/${projectId}/attachments`}>
              <ImageIcon className="h-4 w-4" aria-hidden />
              案件附件
            </SecondaryLink>
            <SecondaryLink href={`/projects/${projectId}/memos`}>
              <NotebookText className="h-4 w-4" aria-hidden />
              案件備忘錄
            </SecondaryLink>
            <SecondaryLink href={`/projects/${projectId}/memory`}>
              <BrainCircuit className="h-4 w-4" aria-hidden />
              案件記憶
            </SecondaryLink>
            <SecondaryLink href={`/projects/${projectId}/summary`}>
              <Sparkles className="h-4 w-4" aria-hidden />
              AI 案件摘要
            </SecondaryLink>
            <ConfirmDeleteButton
              confirmMessage={`確定刪除「${project.name}」？相關待辦也會一起刪除。`}
              onConfirm={handleDeleteProject}
            />
          </>
        }
      />
      <ErrorMessage message={error} />
      {memoMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {memoMessage}
        </div>
      ) : null}
      {projectEditorOpen ? (
        <ProjectEditDialog
          project={project}
          onClose={() => setProjectEditorOpen(false)}
          onSubmit={handleSave}
        />
      ) : null}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-950">此案件待辦</h2>
          <PrimaryLink href={`/tasks/new?projectId=${projectId}`}>
            <Plus className="h-4 w-4" aria-hidden />
            新增待辦
          </PrimaryLink>
        </div>
        {tasks.length ? (
          <TaskTable
            tasks={tasks}
            projects={[project]}
            memoTaskIds={new Set(memos.map((memo) => memo.sourceTaskId).filter((id): id is string => Boolean(id)))}
            onAddMemo={handleAddTaskMemo}
            onDelete={handleDeleteTask}
          />
        ) : (
          <EmptyState
            title="此案件還沒有待辦"
            description="新增待辦時會自動帶入此案件。"
            action={
              <PrimaryLink href={`/tasks/new?projectId=${projectId}`}>
                <Plus className="h-4 w-4" aria-hidden />
                新增待辦
              </PrimaryLink>
            }
          />
        )}
      </section>
    </div>
  );
}

function ProjectEditDialog({
  project,
  onClose,
  onSubmit
}: {
  project: Project;
  onClose: () => void;
  onSubmit: (value: ProjectInput) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-8">
      <section className="w-full max-w-3xl rounded-lg border border-stone-200 bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">編輯案件資料</h2>
            <p className="mt-1 text-sm text-slate-500">修改案件基本資料，儲存後會留下操作紀錄。</p>
          </div>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
            type="button"
            onClick={onClose}
            aria-label="關閉編輯案件"
            title="關閉"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <ProjectForm initialValue={project} submitLabel="儲存修改" onSubmit={onSubmit} />
      </section>
    </div>
  );
}
