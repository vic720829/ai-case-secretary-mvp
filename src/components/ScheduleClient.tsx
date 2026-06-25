"use client";

import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Flag, Filter, Gauge, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDate, isDateOverdue, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { createProjectStage, listMilestones, listProjectStages, listProjects } from "@/lib/firestore";
import { getCurrentStage, getProjectProgress } from "@/lib/progress";
import { commonStageNames } from "@/lib/stageNames";
import type { Milestone, Project, ProjectStage, ProjectStageStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader } from "./PageHeader";
import { StageNameInput } from "./StageNameInput";
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

  const loadData = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  async function handleCreateStage(input: {
    projectId: string;
    stageName: string;
    startDate: string;
    endDate: string;
    reminderDaysBefore: number;
  }) {
    const projectStages = stagesByProject.get(input.projectId) ?? [];
    const nextSortOrder = Math.max(0, ...projectStages.map((stage) => stage.sortOrder)) + 1;

    await createProjectStage({
      projectId: input.projectId,
      stageName: input.stageName,
      startDate: input.startDate,
      endDate: input.endDate,
      status: "todo",
      sortOrder: nextSortOrder,
      reminderDaysBefore: input.reminderDaysBefore
    });
    await loadData();
  }

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
          <ScheduleCalendarCreator projects={projects} stages={stages} onCreateStage={handleCreateStage} />

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

function ScheduleCalendarCreator({
  projects,
  stages,
  onCreateStage
}: {
  projects: Project[];
  stages: ProjectStage[];
  onCreateStage: (input: {
    projectId: string;
    stageName: string;
    startDate: string;
    endDate: string;
    reminderDaysBefore: number;
  }) => Promise<void>;
}) {
  const [monthDate, setMonthDate] = useState(() => monthStartFromDateString(todayInputValue()));
  const [projectId, setProjectId] = useState("");
  const [stageName, setStageName] = useState(commonStageNames[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const calendarDays = useMemo(() => buildCalendarDays(monthDate), [monthDate]);
  const stagesByDate = useMemo(() => groupStagesByDate(stages), [stages]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  function changeMonth(offset: number) {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function handleDateClick(date: string) {
    if (!startDate || (startDate && endDate)) {
      setStartDate(date);
      setEndDate("");
      return;
    }

    if (date < startDate) {
      setEndDate(startDate);
      setStartDate(date);
      return;
    }

    setEndDate(date);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (!projectId) throw new Error("請先選擇案件。");
      if (!stageName.trim()) throw new Error("請填寫工程名稱。");
      if (!startDate) throw new Error("請在月曆選擇開始日。");

      await onCreateStage({
        projectId,
        stageName: stageName.trim(),
        startDate,
        endDate: endDate || startDate,
        reminderDaysBefore
      });
      setStageName(commonStageNames[0]);
      setStartDate("");
      setEndDate("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "新增工期失敗。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <form className="w-full space-y-4 lg:max-w-sm" onSubmit={handleSubmit}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <CalendarDays className="h-4 w-4 text-teal-700" aria-hidden />
            月曆新增工程表
          </div>
          <ErrorMessage message={error} />
          <Field label="案件">
            <select className={inputClassName} value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
              <option value="">選擇案件</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} / {project.clientName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="工程名稱">
            <StageNameInput
              className={inputClassName}
              value={stageName}
              onChange={setStageName}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日">
              <input className={inputClassName} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label="結束日">
              <input className={inputClassName} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </Field>
          </div>
          <Field label="進場前提醒">
            <div className="flex items-center gap-2">
              <input
                className={inputClassName}
                min={0}
                type="number"
                value={reminderDaysBefore}
                onChange={(event) => setReminderDaysBefore(Number(event.target.value))}
              />
              <span className="shrink-0 text-sm text-slate-600">天</span>
            </div>
          </Field>
          <Button type="submit" disabled={submitting}>
            <Plus className="h-4 w-4" aria-hidden />
            {submitting ? "新增中" : "新增工程"}
          </Button>
        </form>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              type="button"
              onClick={() => changeMonth(-1)}
              aria-label="上一個月"
              title="上一個月"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <div className="text-sm font-semibold text-slate-950">
              {monthDate.getFullYear()} 年 {monthDate.getMonth() + 1} 月
            </div>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              type="button"
              onClick={() => changeMonth(1)}
              aria-label="下一個月"
              title="下一個月"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
            {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
              <div key={weekday} className="py-2">
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dayStages = stagesByDate.get(day.date) ?? [];
              const selected = isDateSelected(day.date, startDate, endDate || startDate);

              return (
                <button
                  key={day.date}
                  className={cn(
                    "min-h-24 rounded-md border p-2 text-left transition hover:border-teal-400 hover:bg-teal-50",
                    day.inCurrentMonth ? "border-stone-200 bg-white" : "border-stone-100 bg-stone-50 text-slate-400",
                    selected && "border-teal-600 bg-teal-50 ring-1 ring-teal-600"
                  )}
                  type="button"
                  onClick={() => handleDateClick(day.date)}
                >
                  <div className="text-xs font-semibold">{Number(day.date.slice(-2))}</div>
                  <div className="mt-2 space-y-1">
                    {dayStages.slice(0, 2).map((stage) => {
                      const project = projectById.get(stage.projectId);

                      return (
                        <div key={stage.id} className="truncate rounded bg-stone-100 px-1.5 py-1 text-[11px] text-slate-700">
                          {stage.stageName}
                          {project ? ` / ${project.name}` : ""}
                        </div>
                      );
                    })}
                    {dayStages.length > 2 ? <div className="text-[11px] text-slate-500">+{dayStages.length - 2}</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
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
              <th className="px-4 py-3">提醒</th>
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
                  <td className="px-4 py-4 align-top text-slate-600">
                    {stage.reminderDaysBefore > 0 ? `進場前 ${stage.reminderDaysBefore} 天` : "不提醒"}
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
      <div className="mt-1 text-slate-500">
        {formatDate(milestone.dueDate)}
        {milestone.reminderDaysBefore > 0 ? ` · 前 ${milestone.reminderDaysBefore} 天提醒` : ""}
      </div>
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

function monthStartFromDateString(date: string) {
  const parsed = parseDateString(date);
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function buildCalendarDays(monthDate: Date) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      date: toDateInputValue(date),
      inCurrentMonth: date.getMonth() === monthDate.getMonth()
    };
  });
}

function groupStagesByDate(stages: ProjectStage[]) {
  const groups = new Map<string, ProjectStage[]>();

  stages.forEach((stage) => {
    if (!stage.startDate) return;

    const start = parseDateString(stage.startDate);
    const end = stage.endDate ? parseDateString(stage.endDate) : start;
    const maxDays = 120;

    for (let index = 0; index < maxDays; index += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() + index);
      if (current > end) break;

      const key = toDateInputValue(current);
      const currentStages = groups.get(key) ?? [];
      currentStages.push(stage);
      groups.set(key, currentStages);
    }
  });

  return groups;
}

function isDateSelected(date: string, startDate: string, endDate: string) {
  if (!startDate) return false;
  return date >= startDate && date <= endDate;
}

function parseDateString(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
