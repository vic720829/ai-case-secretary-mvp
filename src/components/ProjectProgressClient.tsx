"use client";

import { ArrowLeft, CalendarDays, Flag, Gauge } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MilestoneForm } from "./MilestoneForm";
import { MilestoneTable } from "./MilestoneTable";
import { PageHeader } from "./PageHeader";
import { ProjectScheduleCalendar } from "./ProjectScheduleCalendar";
import { ProjectStageForm } from "./ProjectStageForm";
import { ProjectStageTable } from "./ProjectStageTable";
import { EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "./Ui";
import { getReadableError } from "@/lib/errors";
import {
  createMilestone,
  createProjectStage,
  deleteMilestone,
  deleteProjectStage,
  getProject,
  listMilestonesByProject,
  listProjectStagesByProject,
  updateMilestone,
  updateProjectStage
} from "@/lib/firestore";
import { getCurrentStage, getProjectProgress } from "@/lib/progress";
import type { Milestone, MilestoneInput, Project, ProjectStage, ProjectStageInput } from "@/lib/types";

export function ProjectProgressClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [editingStage, setEditingStage] = useState<ProjectStage | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextStages, nextMilestones] = await Promise.all([
        getProject(projectId),
        listProjectStagesByProject(projectId),
        listMilestonesByProject(projectId)
      ]);

      setProject(nextProject);
      setStages(nextStages);
      setMilestones(nextMilestones);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const progress = useMemo(() => getProjectProgress(stages), [stages]);
  const currentStage = useMemo(
    () => (project ? getCurrentStage(project, stages) : "未設定"),
    [project, stages]
  );

  async function handleCreateStage(value: ProjectStageInput) {
    await createProjectStage(value);
    await loadData();
  }

  async function handleUpdateStage(value: ProjectStageInput) {
    if (!editingStage) return;

    await updateProjectStage(editingStage.id, value);
    setEditingStage(null);
    await loadData();
  }

  async function handleDeleteStage(stage: ProjectStage) {
    const confirmed = window.confirm(`確定刪除工期節點「${stage.stageName}」？`);
    if (!confirmed) return;

    await deleteProjectStage(stage.id);
    await loadData();
  }

  async function handleCreateMilestone(value: MilestoneInput) {
    await createMilestone(value);
    await loadData();
  }

  async function handleUpdateMilestone(value: MilestoneInput) {
    if (!editingMilestone) return;

    await updateMilestone(editingMilestone.id, value);
    setEditingMilestone(null);
    await loadData();
  }

  async function handleDeleteMilestone(milestone: Milestone) {
    const confirmed = window.confirm(`確定刪除關鍵節點「${milestone.title}」？`);
    if (!confirmed) return;

    await deleteMilestone(milestone.id);
    await loadData();
  }

  if (loading) {
    return <LoadingState label="正在讀取案件進度" />;
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
        title={`${project.name} 進度`}
        description={`${project.clientName} / 工期節點與關鍵里程碑管理`}
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <ProgressCard
          title="目前階段"
          value={currentStage}
          icon={<Flag className="h-5 w-5" aria-hidden />}
        />
        <ProgressCard
          title="完成百分比"
          value={`${progress}%`}
          icon={<Gauge className="h-5 w-5" aria-hidden />}
        />
        <ProgressCard
          title="工期節點"
          value={`${stages.length} 個`}
          icon={<CalendarDays className="h-5 w-5" aria-hidden />}
        />
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">完成百分比</h2>
            <p className="mt-1 text-sm text-slate-600">依工期節點完成數自動計算。</p>
          </div>
          <div className="text-2xl font-semibold text-slate-950">{progress}%</div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full bg-teal-700" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">施工工期表</h2>
        <ProjectScheduleCalendar projectId={projectId} stages={stages} onCreateStage={handleCreateStage} />
      </section>

      {editingStage ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">編輯工期節點</h2>
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <ProjectStageForm
              projectId={projectId}
              initialValue={editingStage}
              submitLabel="儲存工期節點"
              onCancel={() => setEditingStage(null)}
              onSubmit={handleUpdateStage}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">所有工期節點</h2>
        {stages.length ? (
          <ProjectStageTable stages={stages} onEdit={setEditingStage} onDelete={handleDeleteStage} />
        ) : (
          <EmptyState title="尚未建立工期節點" description="先新增丈量、設計、報價、施工等節點來追蹤案件進度。" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">新增關鍵節點</h2>
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <MilestoneForm
            projectId={projectId}
            stages={stages}
            submitLabel="建立關鍵節點"
            onSubmit={handleCreateMilestone}
          />
        </div>
      </section>

      {editingMilestone ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">編輯關鍵節點</h2>
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <MilestoneForm
              projectId={projectId}
              stages={stages}
              initialValue={editingMilestone}
              submitLabel="儲存關鍵節點"
              onCancel={() => setEditingMilestone(null)}
              onSubmit={handleUpdateMilestone}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">關鍵節點</h2>
        {milestones.length ? (
          <MilestoneTable
            milestones={milestones}
            projects={[project]}
            stages={stages}
            onEdit={setEditingMilestone}
            onDelete={handleDeleteMilestone}
          />
        ) : (
          <EmptyState title="尚未建立關鍵節點" description="新增簽約、圖面確認、進場、驗收等里程碑來追蹤風險。" />
        )}
      </section>
    </div>
  );
}

function ProgressCard({
  title,
  value,
  icon
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-3 text-xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
          {icon}
        </div>
      </div>
    </section>
  );
}
