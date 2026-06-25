"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { formatDate, todayInputValue } from "@/lib/date";
import { commonStageNames } from "@/lib/stageNames";
import type { Milestone, ProjectStage, ProjectStageInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StageNameInput } from "./StageNameInput";
import { Button, ErrorMessage } from "./Ui";

export function ProjectScheduleCalendar({
  projectId,
  stages,
  milestones,
  onCreateStage
}: {
  projectId: string;
  stages: ProjectStage[];
  milestones: Milestone[];
  onCreateStage: (value: ProjectStageInput) => Promise<void>;
}) {
  const [monthDate, setMonthDate] = useState(() => monthStartFromDateString(todayInputValue()));
  const [stageName, setStageName] = useState(commonStageNames[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const calendarDays = useMemo(() => buildCalendarDays(monthDate), [monthDate]);
  const stagesByDate = useMemo(() => groupStagesByDate(stages), [stages]);
  const milestonesByDate = useMemo(() => groupMilestonesByDate(milestones), [milestones]);

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
      if (!stageName.trim()) throw new Error("請填寫工程名稱。");
      if (!startDate) throw new Error("請選擇開始日。");

      const nextSortOrder = Math.max(0, ...stages.map((stage) => stage.sortOrder)) + 1;

      await onCreateStage({
        projectId,
        stageName: stageName.trim(),
        startDate,
        endDate: endDate || startDate,
        status: "todo",
        sortOrder: nextSortOrder,
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
            案件施工工期月曆
          </div>
          <ErrorMessage message={error} />
          <Field label="工程名稱">
            <StageNameInput className={inputClassName} value={stageName} onChange={setStageName} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日">
              <input
                className={inputClassName}
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label="結束日">
              <input
                className={inputClassName}
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
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
              const dayMilestones = milestonesByDate.get(day.date) ?? [];
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
                  title={dayMilestones.length ? dayMilestones.map((milestone) => milestone.title).join("、") : undefined}
                >
                  <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                    <span>{Number(day.date.slice(-2))}</span>
                    {dayMilestones.length ? <span className="font-bold text-red-700">關</span> : null}
                  </div>
                  <div className="mt-2 space-y-1">
                    {dayStages.slice(0, 3).map((stage) => (
                      <div key={stage.id} className="truncate rounded bg-stone-100 px-1.5 py-1 text-[11px] text-slate-700">
                        {stage.stageName}
                      </div>
                    ))}
                    {dayStages.length > 3 ? <div className="text-[11px] text-slate-500">+{dayStages.length - 3}</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            已選日期：{startDate ? formatDate(startDate) : "未選"} {endDate ? `- ${formatDate(endDate)}` : ""}
          </div>
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

function groupMilestonesByDate(milestones: Milestone[]) {
  const groups = new Map<string, Milestone[]>();

  milestones.forEach((milestone) => {
    if (!milestone.dueDate) return;

    const currentMilestones = groups.get(milestone.dueDate) ?? [];
    currentMilestones.push(milestone);
    groups.set(milestone.dueDate, currentMilestones);
  });

  groups.forEach((dayMilestones, dueDate) => {
    groups.set(
      dueDate,
      dayMilestones.sort((a, b) => a.title.localeCompare(b.title, "zh-TW"))
    );
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
