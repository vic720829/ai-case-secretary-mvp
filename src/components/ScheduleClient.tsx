"use client";

import { AlertCircle, CalendarDays, Flag, Filter, Gauge } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDate, isDateOverdue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listMilestones, listProjectStages, listProjects } from "@/lib/firestore";
import { getCurrentStage, getProjectProgress } from "@/lib/progress";
import type { Milestone, Project, ProjectStage, ProjectStageStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader } from "./PageHeader";
import { ProjectStageStatusBadge } from "./StatusBadges";

type StageFilter = "all" | "overdue" | ProjectStageStatus;

export function ScheduleClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [designerFilter, setDesignerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StageFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextProjects, nextStages, nextMilestones] = await Promise.all([
          listProjects(),
          listProjectStages(),
          listMilestones()
        ]);
        setProjects(nextProjects);
        setStages(nextStages);
        setMilestones(nextMilestones);
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const stagesByProject = useMemo(() => groupStagesByProject(stages), [stages]);
  const milestonesByStage = useMemo(() => groupMilestonesByStage(milestones), [milestones]);
  const unlinkedMilestones = useMemo(
    () => milestones.filter((milestone) => !milestone.stageId && !milestone.completed),
    [milestones]
  );
  const designerOptions = useMemo(
    () => Array.from(new Set(projects.map((project) => project.designer).filter(Boolean))).sort(),
    [projects]
  );

  const rows = useMemo(() => {
    return stages
      .filter((stage) => {
        const project = projectById.get(stage.projectId);
        const matchProject = !projectFilter || stage.projectId === projectFilter;
        const matchDesigner = !designerFilter || project?.designer === designerFilter;
        const matchStatus =
          statusFilter === "all" ||
          (statusFilter === "overdue" && stage.status !== "done" && isDateOverdue(stage.endDate)) ||
          stage.status === statusFilter;

        return matchProject && matchDesigner && matchStatus;
      })
      .sort((a, b) => {
        const projectA = projectById.get(a.projectId)?.name ?? "";
        const projectB = projectById.get(b.projectId)?.name ?? "";

        return projectA.localeCompare(projectB, "zh-TW") || a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate);
      });
  }, [designerFilter, projectById, projectFilter, stages, statusFilter]);

  const scheduledProjectCount = useMemo(() => new Set(stages.map((stage) => stage.projectId)).size, [stages]);
  const overdueStages = useMemo(
    () => stages.filter((stage) => stage.status !== "done" && isDateOverdue(stage.endDate)),
    [stages]
  );

  if (loading) {
    return <LoadingState label="正在讀取工期總表" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="工期總表"
        description="集中查看全部案件的工期節點、目前階段與關鍵節點，快速找出逾期與風險排程。"
      />

      <ErrorMessage message={error} />
      {error ? (
        <EmptyState
          title="工期總表讀取失敗"
          description="請確認 Firestore Rules 已允許登入者讀取 projects、projectStages 與 milestones。"
        />
      ) : null}

      {!error ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard title="有工期案件" value={scheduledProjectCount} icon={<CalendarDays className="h-5 w-5" aria-hidden />} />
            <MetricCard title="工期節點" value={stages.length} icon={<Gauge className="h-5 w-5" aria-hidden />} />
            <MetricCard title="逾期節點" value={overdueStages.length} tone="red" icon={<AlertCircle className="h-5 w-5" aria-hidden />} />
            <MetricCard title="未掛關鍵節點" value={unlinkedMilestones.length} tone="amber" icon={<Flag className="h-5 w-5" aria-hidden />} />
          </div>

          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Filter className="h-4 w-4 text-teal-700" aria-hidden />
              篩選
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="案件">
                <select className={inputClassName} value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                  <option value="">全部案件</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} / {project.clientName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="設計師">
                <select className={inputClassName} value={designerFilter} onChange={(event) => setDesignerFilter(event.target.value)}>
                  <option value="">全部設計師</option>
                  {designerOptions.map((designer) => (
                    <option key={designer} value={designer}>
                      {designer}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="狀態">
                <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StageFilter)}>
                  <option value="all">全部狀態</option>
                  <option value="todo">尚未開始</option>
                  <option value="doing">進行中</option>
                  <option value="done">已完成</option>
                  <option value="overdue">已逾期</option>
                </select>
              </Field>
            </div>
          </section>

          <ScheduleTable rows={rows} projectById={projectById} milestonesByStage={milestonesByStage} stagesByProject={stagesByProject} />

          <UnlinkedMilestonesSection milestones={unlinkedMilestones} projectById={projectById} />
        </>
      ) : null}
    </div>
  );
}

function ScheduleTable({
  rows,
  projectById,
  milestonesByStage,
  stagesByProject
}: {
  rows: ProjectStage[];
  projectById: Map<string, Project>;
  milestonesByStage: Map<string, Milestone[]>;
  stagesByProject: Map<string, ProjectStage[]>;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="沒有符合條件的工期節點"
        description="可以調整篩選條件，或先到案件進度頁建立工期節點。"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">設計師</th>
              <th className="px-4 py-3">工期節點</th>
              <th className="px-4 py-3">日期</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">關鍵節點</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {rows.map((stage) => {
              const project = projectById.get(stage.projectId);
              const projectStages = stagesByProject.get(stage.projectId) ?? [];
              const progress = project ? getProjectProgress(projectStages) : 0;
              const currentStage = project ? getCurrentStage(project, projectStages) : "未設定";
              const linkedMilestones = milestonesByStage.get(stage.id) ?? [];
              const overdue = stage.status !== "done" && isDateOverdue(stage.endDate);

              return (
                <tr key={stage.id} className="hover:bg-stone-50">
                  <td className="min-w-56 px-4 py-4 align-top">
                    {project ? (
                      <div>
                        <Link className="font-semibold text-slate-950 hover:text-teal-700" href={`/projects/${project.id}/progress`}>
                          {project.name}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">{project.clientName}</div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                          <span>{currentStage}</span>
                          <span className="h-1 w-1 rounded-full bg-slate-300" />
                          <span>{progress}%</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-500">未綁定案件</span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">{project?.designer || "未設定"}</td>
                  <td className="min-w-48 px-4 py-4 align-top">
                    <div className="text-xs text-slate-500">#{stage.sortOrder}</div>
                    <div className="mt-1 font-semibold text-slate-950">{stage.stageName}</div>
                  </td>
                  <td className="min-w-44 px-4 py-4 align-top">
                    <div className="text-slate-600">{formatDate(stage.startDate)} - {formatDate(stage.endDate)}</div>
                    {overdue ? <div className="mt-1 text-xs font-semibold text-red-700">逾期未完成</div> : null}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <ProjectStageStatusBadge status={stage.status} />
                  </td>
                  <td className="min-w-64 px-4 py-4 align-top">
                    {linkedMilestones.length ? (
                      <div className="space-y-2">
                        {linkedMilestones.slice(0, 3).map((milestone) => (
                          <MilestonePill key={milestone.id} milestone={milestone} />
                        ))}
                        {linkedMilestones.length > 3 ? (
                          <div className="text-xs text-slate-500">另有 {linkedMilestones.length - 3} 個關鍵節點</div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">尚未掛關鍵節點</span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top text-right">
                    {project ? (
                      <Link
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        href={`/projects/${project.id}/progress`}
                      >
                        編輯
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MilestonePill({ milestone }: { milestone: Milestone }) {
  const overdue = !milestone.completed && isDateOverdue(milestone.dueDate);

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        overdue || milestone.riskLevel === "high"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-stone-200 bg-stone-50 text-slate-700"
      )}
    >
      <div className="font-semibold">{milestone.title}</div>
      <div className="mt-1 text-slate-500">{formatDate(milestone.dueDate)}</div>
    </div>
  );
}

function UnlinkedMilestonesSection({
  milestones,
  projectById
}: {
  milestones: Milestone[];
  projectById: Map<string, Project>;
}) {
  if (!milestones.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-950">未掛工期的關鍵節點</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {milestones.slice(0, 8).map((milestone) => {
          const project = projectById.get(milestone.projectId);

          return (
            <div key={milestone.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-950">{milestone.title}</div>
              <div className="mt-1 text-xs text-amber-800">
                {project ? `${project.name} / ${project.clientName}` : "未綁定案件"} · {formatDate(milestone.dueDate)}
              </div>
              {project ? (
                <Link className="mt-3 inline-flex text-xs font-semibold text-teal-800 hover:text-teal-900" href={`/projects/${project.id}/progress`}>
                  去掛工期節點
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({
  title,
  value,
  icon,
  tone = "teal"
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone?: "teal" | "amber" | "red";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700 ring-teal-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    red: "bg-red-50 text-red-700 ring-red-100"
  }[tone];

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-md ring-1 ring-inset ${toneClass}`}>
          {icon}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function groupStagesByProject(stages: ProjectStage[]) {
  const groups = new Map<string, ProjectStage[]>();

  stages.forEach((stage) => {
    const nextStages = groups.get(stage.projectId) ?? [];
    nextStages.push(stage);
    groups.set(stage.projectId, nextStages);
  });

  groups.forEach((projectStages, projectId) => {
    groups.set(
      projectId,
      projectStages.sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate))
    );
  });

  return groups;
}

function groupMilestonesByStage(milestones: Milestone[]) {
  const groups = new Map<string, Milestone[]>();

  milestones.forEach((milestone) => {
    if (!milestone.stageId) return;

    const nextMilestones = groups.get(milestone.stageId) ?? [];
    nextMilestones.push(milestone);
    groups.set(milestone.stageId, nextMilestones);
  });

  groups.forEach((stageMilestones, stageId) => {
    groups.set(
      stageId,
      stageMilestones.sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"))
    );
  });

  return groups;
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
