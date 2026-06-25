"use client";

import { ArrowLeft, Gauge, MessageSquareText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { PageHeader } from "./PageHeader";
import { ProjectForm } from "./ProjectForm";
import { TaskTable } from "./TaskTable";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink, SecondaryLink } from "./Ui";
import {
  deleteProject,
  deleteTask,
  getProject,
  listTasksByProject,
  updateProject
} from "@/lib/firestore";
import type { Project, ProjectInput, Task } from "@/lib/types";

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    const [nextProject, nextTasks] = await Promise.all([
      getProject(projectId),
      listTasksByProject(projectId)
    ]);

    setProject(nextProject);
    setTasks(nextTasks);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSave(value: ProjectInput) {
    await updateProject(projectId, value);
    await loadData();
  }

  async function handleDeleteProject() {
    await deleteProject(projectId);
    router.push("/projects");
  }

  async function handleDeleteTask(task: Task) {
    const confirmed = window.confirm(`確定刪除任務「${task.title}」？`);
    if (!confirmed) return;

    try {
      await deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "刪除任務失敗。";
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
            <SecondaryLink href={`/projects/${projectId}/progress`}>
              <Gauge className="h-4 w-4" aria-hidden />
              案件進度
            </SecondaryLink>
            <SecondaryLink href={`/projects/${projectId}/messages`}>
              <MessageSquareText className="h-4 w-4" aria-hidden />
              案件訊息
            </SecondaryLink>
            <ConfirmDeleteButton
              confirmMessage={`確定刪除「${project.name}」？相關任務也會一起刪除。`}
              onConfirm={handleDeleteProject}
            />
          </>
        }
      />
      <ErrorMessage message={error} />
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <ProjectForm initialValue={project} submitLabel="儲存案件" onSubmit={handleSave} />
      </section>
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-950">此案件任務</h2>
          <PrimaryLink href={`/tasks/new?projectId=${projectId}`}>
            <Plus className="h-4 w-4" aria-hidden />
            新增任務
          </PrimaryLink>
        </div>
        {tasks.length ? (
          <TaskTable tasks={tasks} projects={[project]} onDelete={handleDeleteTask} />
        ) : (
          <EmptyState
            title="此案件還沒有任務"
            description="新增任務時會自動帶入此案件。"
            action={
              <PrimaryLink href={`/tasks/new?projectId=${projectId}`}>
                <Plus className="h-4 w-4" aria-hidden />
                新增任務
              </PrimaryLink>
            }
          />
        )}
      </section>
    </div>
  );
}
