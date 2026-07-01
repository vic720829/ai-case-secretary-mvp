"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, Pencil, Timer } from "lucide-react";
import { EmptyState } from "@/components/Ui";
import { formatDate, isDateOverdue, todayInputValue } from "@/lib/date";
import { isHighOrCriticalRisk } from "@/lib/riskRules";
import type { Milestone, Project, ProjectStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProjectStageStatusBadge } from "./StatusBadges";

type GanttTimeline = {
  startDate: string;
  endDate: string;
  dates: string[];
  dayWidth: number;
  width: number;
  todayOffset: number | null;
};

export function ProjectGanttChart({
  project,
  stages,
  milestones,
  onEditStage
}: {
  project: Project;
  stages: ProjectStage[];
  milestones: Milestone[];
  onEditStage?: (stage: ProjectStage) => void;
}) {
  const datedStages = stages.filter((stage) => stage.startDate);

  if (!datedStages.length) {
    return (
      <EmptyState
        title="還沒有工期資料"
        description="先建立丈量、設計、備料、施工等階段，並填入開始日期，甘特圖就會自動生成。"
      />
    );
  }

  const orderedStages = [...datedStages].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate)
  );
  const timeline = buildTimeline(project, orderedStages, milestones);
  const milestonesByStage = groupMilestonesByStage(milestones);
  const unlinkedMilestones = milestones.filter((milestone) => !milestone.stageId);
  const overdueStages = orderedStages.filter((stage) => stage.status !== "done" && isDateOverdue(stage.endDate));
  const completedStages = orderedStages.filter((stage) => stage.status === "done").length;
  const totalDays = daysBetween(timeline.startDate, timeline.endDate) + 1;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Timer className="h-4 w-4 text-teal-700" aria-hidden />
            案子甘特圖
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {project.name} / {formatDate(timeline.startDate)} - {formatDate(timeline.endDate)}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:w-[520px]">
          <GanttMetric title="總工期" value={`${totalDays} 天`} icon={<CalendarDays className="h-4 w-4" aria-hidden />} />
          <GanttMetric title="已完成" value={`${completedStages}/${orderedStages.length}`} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} />
          <GanttMetric title="逾期階段" value={`${overdueStages.length}`} tone="red" icon={<AlertTriangle className="h-4 w-4" aria-hidden />} />
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-stone-200">
        <div className="min-w-full" style={{ width: timeline.width + 260 }}>
          <div className="grid grid-cols-[260px_minmax(0,1fr)] border-b border-stone-200 bg-stone-50">
            <div className="border-r border-stone-200 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-slate-500">
              階段
            </div>
            <div className="relative h-12" style={{ width: timeline.width }}>
              <TimelineHeader timeline={timeline} />
              <TodayLine timeline={timeline} />
            </div>
          </div>

          <div className="divide-y divide-stone-100">
            {orderedStages.map((stage) => (
              <GanttStageRow
                key={stage.id}
                stage={stage}
                timeline={timeline}
                milestones={milestonesByStage.get(stage.id) ?? []}
                onEditStage={onEditStage}
              />
            ))}
            {unlinkedMilestones.length ? (
              <GanttMilestoneRow timeline={timeline} milestones={unlinkedMilestones} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
        <LegendDot className="bg-slate-400" label="待處理" />
        <LegendDot className="bg-teal-600" label="進行中" />
        <LegendDot className="bg-emerald-600" label="完成" />
        <LegendDot className="bg-red-600" label="逾期" />
        <LegendDot className="bg-amber-500" label="關鍵節點" />
      </div>
    </section>
  );
}

function GanttStageRow({
  stage,
  timeline,
  milestones,
  onEditStage
}: {
  stage: ProjectStage;
  timeline: GanttTimeline;
  milestones: Milestone[];
  onEditStage?: (stage: ProjectStage) => void;
}) {
  const startOffset = Math.max(0, daysBetween(timeline.startDate, stage.startDate));
  const duration = Math.max(1, daysBetween(stage.startDate, stage.endDate || stage.startDate) + 1);
  const left = startOffset * timeline.dayWidth;
  const width = Math.max(28, duration * timeline.dayWidth);
  const overdue = stage.status !== "done" && isDateOverdue(stage.endDate);

  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] bg-white">
      <div className="border-r border-stone-200 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">{stage.stageName}</div>
            <div className="mt-1 text-xs text-slate-500">
              #{stage.sortOrder} · {formatDate(stage.startDate)} - {formatDate(stage.endDate)}
            </div>
            <div className="mt-2">
              <ProjectStageStatusBadge status={stage.status} />
            </div>
          </div>
          {onEditStage ? (
            <button
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
              type="button"
              onClick={() => onEditStage(stage)}
              aria-label={`編輯 ${stage.stageName}`}
              title="編輯"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative h-[76px]" style={{ width: timeline.width }}>
        <TimelineGrid timeline={timeline} />
        <TodayLine timeline={timeline} />
        <div
          className={cn(
            "absolute top-6 flex h-7 items-center rounded-md px-3 text-xs font-semibold text-white shadow-sm",
            overdue ? "bg-red-600" : getStageBarClassName(stage)
          )}
          style={{ left, width }}
          title={`${stage.stageName} / ${formatDate(stage.startDate)} - ${formatDate(stage.endDate)}`}
        >
          <span className="truncate">{stage.stageName}</span>
        </div>
        {milestones.map((milestone) => (
          <MilestoneMarker key={milestone.id} milestone={milestone} timeline={timeline} />
        ))}
      </div>
    </div>
  );
}

function GanttMilestoneRow({ timeline, milestones }: { timeline: GanttTimeline; milestones: Milestone[] }) {
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] bg-amber-50/40">
      <div className="border-r border-stone-200 px-4 py-4">
        <div className="text-sm font-semibold text-slate-950">未綁定階段的節點</div>
        <div className="mt-1 text-xs text-slate-500">{milestones.length} 筆關鍵日期</div>
      </div>
      <div className="relative h-[64px]" style={{ width: timeline.width }}>
        <TimelineGrid timeline={timeline} />
        <TodayLine timeline={timeline} />
        {milestones.map((milestone) => (
          <MilestoneMarker key={milestone.id} milestone={milestone} timeline={timeline} topClassName="top-6" />
        ))}
      </div>
    </div>
  );
}

function TimelineHeader({ timeline }: { timeline: GanttTimeline }) {
  return (
    <div className="absolute inset-0 flex">
      {timeline.dates.map((date, index) => {
        const parsed = parseDateString(date);
        const showLabel = index === 0 || parsed.getDate() === 1 || parsed.getDay() === 1;

        return (
          <div
            key={date}
            className={cn("h-full border-r border-stone-100 px-1 py-2 text-[11px] text-slate-500", showLabel && "bg-white/60")}
            style={{ width: timeline.dayWidth }}
          >
            {showLabel ? (
              <div className="whitespace-nowrap">
                {parsed.getMonth() + 1}/{parsed.getDate()}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TimelineGrid({ timeline }: { timeline: GanttTimeline }) {
  return (
    <div className="absolute inset-0 flex">
      {timeline.dates.map((date) => {
        const parsed = parseDateString(date);
        const isWeekend = parsed.getDay() === 0 || parsed.getDay() === 6;

        return (
          <div
            key={date}
            className={cn("h-full border-r border-stone-100", isWeekend && "bg-stone-50")}
            style={{ width: timeline.dayWidth }}
          />
        );
      })}
    </div>
  );
}

function TodayLine({ timeline }: { timeline: GanttTimeline }) {
  if (timeline.todayOffset === null) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-500"
      style={{ left: timeline.todayOffset * timeline.dayWidth + timeline.dayWidth / 2 }}
      title="今天"
    />
  );
}

function MilestoneMarker({
  milestone,
  timeline,
  topClassName = "top-3"
}: {
  milestone: Milestone;
  timeline: GanttTimeline;
  topClassName?: string;
}) {
  if (!milestone.dueDate) return null;

  const offset = daysBetween(timeline.startDate, milestone.dueDate);
  if (offset < 0 || offset >= timeline.dates.length) return null;

  const highRisk = isHighOrCriticalRisk(milestone.riskLevel) || (!milestone.completed && isDateOverdue(milestone.dueDate));

  return (
    <div
      className={cn(
        "absolute z-20 h-4 w-4 -translate-x-1/2 rotate-45 rounded-sm border-2 border-white shadow-sm",
        topClassName,
        highRisk ? "bg-red-600" : "bg-amber-500"
      )}
      style={{ left: offset * timeline.dayWidth + timeline.dayWidth / 2 }}
      title={`${milestone.title} / ${formatDate(milestone.dueDate)}`}
    />
  );
}

function GanttMetric({
  title,
  value,
  icon,
  tone = "teal"
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  tone?: "teal" | "red";
}) {
  const toneClass = tone === "red" ? "bg-red-50 text-red-700 ring-red-100" : "bg-teal-50 text-teal-700 ring-teal-100";

  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
        </div>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-inset", toneClass)}>{icon}</div>
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}

function buildTimeline(project: Project, stages: ProjectStage[], milestones: Milestone[]): GanttTimeline {
  const dates = [
    ...stages.flatMap((stage) => [stage.startDate, stage.endDate || stage.startDate]),
    ...milestones.map((milestone) => milestone.dueDate),
    project.expectedFinishDate,
    todayInputValue()
  ].filter(Boolean);
  const sortedDates = dates.sort((a, b) => a.localeCompare(b));
  const firstDate = sortedDates[0] ?? todayInputValue();
  const lastDate = sortedDates[sortedDates.length - 1] ?? todayInputValue();
  const startDate = toDateInputValue(addDays(parseDateString(firstDate), -3));
  const endDate = toDateInputValue(addDays(parseDateString(lastDate), 7));
  const totalDays = daysBetween(startDate, endDate) + 1;
  const dayWidth = totalDays > 180 ? 8 : totalDays > 100 ? 10 : totalDays > 60 ? 12 : 18;
  const timelineDates = Array.from({ length: totalDays }, (_, index) => toDateInputValue(addDays(parseDateString(startDate), index)));
  const today = todayInputValue();
  const todayOffset = today >= startDate && today <= endDate ? daysBetween(startDate, today) : null;

  return {
    startDate,
    endDate,
    dates: timelineDates,
    dayWidth,
    width: totalDays * dayWidth,
    todayOffset
  };
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

function getStageBarClassName(stage: ProjectStage) {
  if (stage.status === "done") return "bg-emerald-600";
  if (stage.status === "doing") return "bg-teal-600";

  return "bg-slate-500";
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

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + days);
  return nextDate;
}

function daysBetween(startDate: string, endDate: string) {
  const start = parseDateString(startDate).getTime();
  const end = parseDateString(endDate).getTime();
  return Math.round((end - start) / 86_400_000);
}
