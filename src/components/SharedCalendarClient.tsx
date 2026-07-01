"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDate, isDateOverdue, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  listMilestones,
  listProjectStages,
  listProjects,
  updateCalendarEvent
} from "@/lib/firestore";
import type {
  CalendarEvent,
  CalendarEventCounterpartyType,
  CalendarEventInput,
  CalendarEventStatus,
  CalendarEventType,
  Milestone,
  Project,
  ProjectStage
} from "@/lib/types";
import { cn } from "@/lib/utils";

type CalendarItemSource = "manual" | "stage" | "milestone";
type SourceFilter = "all" | CalendarItemSource;

type CalendarItem = {
  id: string;
  source: CalendarItemSource;
  title: string;
  projectId: string;
  projectName: string;
  clientName: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  description: string;
  location: string;
  owner: string;
  counterpartyType: CalendarEventCounterpartyType;
  counterpartyName: string;
  contactMethod: string;
  status: string;
  href: string;
  editableEvent?: CalendarEvent;
};

const eventTypeOptions: Array<{ value: CalendarEventType; label: string }> = [
  { value: "site_visit", label: "丈量/現勘" },
  { value: "meeting", label: "會議" },
  { value: "design", label: "設計" },
  { value: "construction", label: "施工" },
  { value: "delivery", label: "送貨/交付" },
  { value: "payment", label: "收款" },
  { value: "other", label: "其他" }
];

const eventStatusOptions: Array<{ value: CalendarEventStatus; label: string }> = [
  { value: "scheduled", label: "已排程" },
  { value: "done", label: "完成" },
  { value: "cancelled", label: "取消" }
];

const counterpartyTypeOptions: Array<{ value: CalendarEventCounterpartyType; label: string }> = [
  { value: "customer", label: "客戶" },
  { value: "vendor", label: "廠商" },
  { value: "internal", label: "內部" },
  { value: "other", label: "其他" }
];

const counterpartyTypeLabels: Record<CalendarEventCounterpartyType, string> = {
  customer: "客戶",
  vendor: "廠商",
  internal: "內部",
  other: "其他"
};

const sourceLabels: Record<CalendarItemSource, string> = {
  manual: "共享事件",
  stage: "工期階段",
  milestone: "關鍵節點"
};

export function SharedCalendarClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [monthDate, setMonthDate] = useState(() => monthStartFromDateString(todayInputValue()));
  const [selectedDate, setSelectedDate] = useState(todayInputValue());
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProjects, nextStages, nextMilestones, nextEvents] = await Promise.all([
        listProjects(),
        listProjectStages(),
        listMilestones(),
        listCalendarEvents()
      ]);

      setProjects(nextProjects);
      setStages(nextStages);
      setMilestones(nextMilestones);
      setEvents(nextEvents);
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
  const calendarDays = useMemo(() => buildCalendarDays(monthDate), [monthDate]);
  const calendarItems = useMemo(
    () => buildCalendarItems(events, stages, milestones, projectById),
    [events, milestones, projectById, stages]
  );
  const filteredItems = useMemo(
    () =>
      calendarItems.filter((item) => {
        const matchesProject = !projectFilter || item.projectId === projectFilter;
        const matchesSource = sourceFilter === "all" || item.source === sourceFilter;

        return matchesProject && matchesSource;
      }),
    [calendarItems, projectFilter, sourceFilter]
  );
  const itemsByDate = useMemo(() => groupItemsByDate(filteredItems), [filteredItems]);
  const selectedItems = useMemo(
    () => [...(itemsByDate.get(selectedDate) ?? [])].sort(compareCalendarItems),
    [itemsByDate, selectedDate]
  );
  const monthItems = useMemo(() => {
    const monthStart = toDateInputValue(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    const monthEnd = toDateInputValue(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));

    return filteredItems.filter((item) => rangesOverlap(item.startDate, item.endDate, monthStart, monthEnd));
  }, [filteredItems, monthDate]);
  const todayItems = useMemo(() => itemsByDate.get(todayInputValue()) ?? [], [itemsByDate]);
  const overdueItems = useMemo(
    () =>
      filteredItems.filter(
        (item) =>
          item.status !== "done" &&
          item.status !== "cancelled" &&
          isDateOverdue(item.endDate || item.startDate)
      ),
    [filteredItems]
  );

  function changeMonth(offset: number) {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  async function handleCreateEvent(input: CalendarEventInput) {
    await createCalendarEvent(input);
    await loadData();
  }

  async function handleUpdateEvent(input: CalendarEventInput) {
    if (!editingEvent) return;

    await updateCalendarEvent(editingEvent.id, input);
    setEditingEvent(null);
    await loadData();
  }

  async function handleDeleteEvent(event: CalendarEvent) {
    const confirmed = window.confirm(`確定要刪除「${event.title}」嗎？`);
    if (!confirmed) return;

    await deleteCalendarEvent(event.id);
    await loadData();
  }

  if (loading) {
    return <LoadingState label="正在讀取共享月曆" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="共享月曆"
        description="集中查看所有案子的工期階段、關鍵節點與手動排程事件。"
      />

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="本月事件" value={monthItems.length} />
        <MetricCard title="今日行程" value={todayItems.length} tone="blue" />
        <MetricCard title="手動事件" value={events.length} tone="amber" />
        <MetricCard title="逾期未結" value={overdueItems.length} tone="red" />
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Filter className="h-4 w-4 text-teal-700" aria-hidden />
          篩選
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="案子">
            <select className={inputClassName} value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="">全部案子</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} / {project.clientName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="來源">
            <select className={inputClassName} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>
              <option value="all">全部來源</option>
              <option value="manual">共享事件</option>
              <option value="stage">工期階段</option>
              <option value="milestone">關鍵節點</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <CalendarDays className="h-4 w-4 text-teal-700" aria-hidden />
              {monthDate.getFullYear()} 年 {monthDate.getMonth() + 1} 月
            </div>
            <div className="flex items-center gap-2">
              <button
                className={iconButtonClassName}
                type="button"
                onClick={() => changeMonth(-1)}
                aria-label="上一個月"
                title="上一個月"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                type="button"
                onClick={() => {
                  setMonthDate(monthStartFromDateString(todayInputValue()));
                  setSelectedDate(todayInputValue());
                }}
              >
                今天
              </button>
              <button
                className={iconButtonClassName}
                type="button"
                onClick={() => changeMonth(1)}
                aria-label="下一個月"
                title="下一個月"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
            {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
              <div key={weekday} className="py-2">
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dayItems = itemsByDate.get(day.date) ?? [];
              const selected = day.date === selectedDate;
              const isToday = day.date === todayInputValue();

              return (
                <button
                  key={day.date}
                  className={cn(
                    "min-h-32 rounded-md border p-2 text-left transition hover:border-teal-400 hover:bg-teal-50",
                    day.inCurrentMonth ? "border-stone-200 bg-white" : "border-stone-100 bg-stone-50 text-slate-400",
                    selected && "border-teal-600 bg-teal-50 ring-1 ring-teal-600"
                  )}
                  type="button"
                  onClick={() => setSelectedDate(day.date)}
                >
                  <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1",
                        isToday && "bg-teal-700 text-white"
                      )}
                    >
                      {Number(day.date.slice(-2))}
                    </span>
                    {dayItems.length ? <span className="text-[11px] text-slate-500">{dayItems.length}</span> : null}
                  </div>
                  <div className="mt-2 space-y-1">
                    {dayItems.slice(0, 4).map((item) => (
                      <CalendarPill key={`${item.source}-${item.id}`} item={item} />
                    ))}
                    {dayItems.length > 4 ? (
                      <div className="text-[11px] font-medium text-slate-500">+{dayItems.length - 4} 筆</div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{formatDate(selectedDate)}</h2>
                <p className="mt-1 text-sm text-slate-600">當日事件與案子工期</p>
              </div>
              <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-slate-600">
                {selectedItems.length} 筆
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {selectedItems.length ? (
                selectedItems.map((item) => (
                  <CalendarItemCard
                    key={`${item.source}-${item.id}`}
                    item={item}
                    onEdit={item.editableEvent ? setEditingEvent : undefined}
                    onDelete={item.editableEvent ? handleDeleteEvent : undefined}
                  />
                ))
              ) : (
                <EmptyState title="這天沒有行程" description="你可以新增共享事件，或到專案進度頁建立工期階段。" />
              )}
            </div>
          </section>

          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {editingEvent ? "編輯共享事件" : "新增共享事件"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">適合記會議、丈量、收款、安裝或跨案提醒。</p>
              </div>
              {editingEvent ? (
                <button
                  className={iconButtonClassName}
                  type="button"
                  onClick={() => setEditingEvent(null)}
                  aria-label="取消編輯"
                  title="取消編輯"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <CalendarEventForm
              key={editingEvent?.id ?? selectedDate}
              projects={projects}
              initialValue={editingEvent ?? undefined}
              defaultDate={selectedDate}
              submitLabel={editingEvent ? "儲存事件" : "新增事件"}
              onCancel={editingEvent ? () => setEditingEvent(null) : undefined}
              onSubmit={editingEvent ? handleUpdateEvent : handleCreateEvent}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function CalendarEventForm({
  projects,
  initialValue,
  defaultDate,
  submitLabel,
  onSubmit,
  onCancel
}: {
  projects: Project[];
  initialValue?: CalendarEvent;
  defaultDate: string;
  submitLabel: string;
  onSubmit: (value: CalendarEventInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<CalendarEventInput>(
    initialValue ?? {
      title: "",
      description: "",
      projectId: "",
      startDate: defaultDate,
      endDate: defaultDate,
      startTime: "",
      endTime: "",
      location: "",
      owner: "",
      counterpartyType: "customer",
      counterpartyName: "",
      contactMethod: "",
      eventType: "other",
      status: "scheduled",
      source: "manual"
    }
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField<K extends keyof CalendarEventInput>(key: K, nextValue: CalendarEventInput[K]) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (!value.title.trim()) throw new Error("請輸入事件名稱。");
      if (!value.startDate) throw new Error("請選擇開始日期。");
      if (value.endDate && value.endDate < value.startDate) throw new Error("結束日期不能早於開始日期。");

      await onSubmit({
        ...value,
        title: value.title.trim(),
        description: value.description.trim(),
        endDate: value.endDate || value.startDate,
        location: value.location.trim(),
        owner: value.owner.trim(),
        counterpartyName: value.counterpartyName.trim(),
        contactMethod: value.contactMethod.trim(),
        source: "manual"
      });

      if (!initialValue) {
        setValue({
          title: "",
          description: "",
          projectId: value.projectId,
          startDate: value.startDate,
          endDate: value.endDate || value.startDate,
          startTime: "",
          endTime: "",
          location: "",
          owner: "",
          counterpartyType: value.counterpartyType,
          counterpartyName: "",
          contactMethod: "",
          eventType: value.eventType,
          status: "scheduled",
          source: "manual"
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "事件儲存失敗。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <ErrorMessage message={error} />
      <Field label="事件名稱">
        <input
          className={inputClassName}
          value={value.title}
          onChange={(event) => updateField("title", event.target.value)}
          placeholder="例：客戶丈量、設計會議、安裝確認"
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="對象類型">
          <select
            className={inputClassName}
            value={value.counterpartyType}
            onChange={(event) => updateField("counterpartyType", event.target.value as CalendarEventCounterpartyType)}
          >
            {counterpartyTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="對象名稱/聯絡人">
          <input
            className={inputClassName}
            value={value.counterpartyName}
            onChange={(event) => updateField("counterpartyName", event.target.value)}
            placeholder="例：王小姐、木工阿明"
          />
        </Field>
        <Field label="聯絡方式">
          <input
            className={inputClassName}
            value={value.contactMethod}
            onChange={(event) => updateField("contactMethod", event.target.value)}
            placeholder="電話、LINE、備註"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="案子">
          <select className={inputClassName} value={value.projectId} onChange={(event) => updateField("projectId", event.target.value)}>
            <option value="">不綁定案子</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} / {project.clientName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="類型">
          <select
            className={inputClassName}
            value={value.eventType}
            onChange={(event) => updateField("eventType", event.target.value as CalendarEventType)}
          >
            {eventTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="開始日期">
          <input
            className={inputClassName}
            type="date"
            value={value.startDate}
            onChange={(event) => updateField("startDate", event.target.value)}
            required
          />
        </Field>
        <Field label="結束日期">
          <input
            className={inputClassName}
            type="date"
            value={value.endDate}
            onChange={(event) => updateField("endDate", event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="開始時間">
          <input
            className={inputClassName}
            type="time"
            value={value.startTime}
            onChange={(event) => updateField("startTime", event.target.value)}
          />
        </Field>
        <Field label="結束時間">
          <input
            className={inputClassName}
            type="time"
            value={value.endTime}
            onChange={(event) => updateField("endTime", event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="負責人">
          <input
            className={inputClassName}
            value={value.owner}
            onChange={(event) => updateField("owner", event.target.value)}
            placeholder="例：VIC、設計師、工班"
          />
        </Field>
        <Field label="狀態">
          <select
            className={inputClassName}
            value={value.status}
            onChange={(event) => updateField("status", event.target.value as CalendarEventStatus)}
          >
            {eventStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="地點">
        <input
          className={inputClassName}
          value={value.location}
          onChange={(event) => updateField("location", event.target.value)}
          placeholder="例：客戶住家、公司、工地"
        />
      </Field>
      <Field label="備註">
        <textarea
          className={cn(inputClassName, "min-h-24 resize-y")}
          value={value.description}
          onChange={(event) => updateField("description", event.target.value)}
          placeholder="補充聯絡方式、注意事項或材料需求"
        />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting}>
          <Plus className="h-4 w-4" aria-hidden />
          {submitting ? "儲存中" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function CalendarItemCard({
  item,
  onEdit,
  onDelete
}: {
  item: CalendarItem;
  onEdit?: (event: CalendarEvent) => void;
  onDelete?: (event: CalendarEvent) => void;
}) {
  const statusText = getStatusText(item);
  const meta = [
    item.projectName ? `${item.projectName}${item.clientName ? ` / ${item.clientName}` : ""}` : "",
    formatDateRange(item.startDate, item.endDate),
    formatTimeRange(item.startTime, item.endTime)
  ].filter(Boolean);

  return (
    <article className={cn("rounded-lg border p-4", getItemCardClassName(item))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md px-2 py-1 text-xs font-semibold", getItemBadgeClassName(item))}>
              {sourceLabels[item.source]}
            </span>
            <span className="text-xs font-medium text-slate-500">{statusText}</span>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-950">{item.title}</h3>
          {meta.length ? <p className="mt-1 text-xs leading-5 text-slate-600">{meta.join(" · ")}</p> : null}
        </div>
        {item.editableEvent && onEdit && onDelete ? (
          <div className="flex shrink-0 gap-2">
            <button
              className={iconButtonClassName}
              type="button"
              onClick={() => onEdit(item.editableEvent as CalendarEvent)}
              aria-label={`編輯 ${item.title}`}
              title="編輯"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              type="button"
              onClick={() => onDelete(item.editableEvent as CalendarEvent)}
              aria-label={`刪除 ${item.title}`}
              title="刪除"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-2 text-xs text-slate-600">
        {item.counterpartyName || item.contactMethod ? (
          <div className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            <span>
              {counterpartyTypeLabels[item.counterpartyType]}
              {item.counterpartyName ? `：${item.counterpartyName}` : ""}
              {item.contactMethod ? ` · ${item.contactMethod}` : ""}
            </span>
          </div>
        ) : null}
        {item.owner ? (
          <div className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            {item.owner}
          </div>
        ) : null}
        {item.location ? (
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            {item.location}
          </div>
        ) : null}
        {item.description ? <p className="leading-5">{item.description}</p> : null}
      </div>
      {item.href ? (
        <Link className="mt-3 inline-flex text-xs font-semibold text-teal-800 hover:text-teal-900" href={item.href}>
          查看案子
        </Link>
      ) : null}
    </article>
  );
}

function CalendarPill({ item }: { item: CalendarItem }) {
  return (
    <div className={cn("truncate rounded px-1.5 py-1 text-[11px] font-medium", getItemPillClassName(item))}>
      {formatTimeRange(item.startTime, item.endTime) ? `${formatTimeRange(item.startTime, item.endTime)} ` : ""}
      {item.title}
    </div>
  );
}

function MetricCard({
  title,
  value,
  tone = "teal"
}: {
  title: string;
  value: number;
  tone?: "teal" | "blue" | "amber" | "red";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700 ring-teal-100",
    blue: "bg-sky-50 text-sky-700 ring-sky-100",
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
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-md ring-1 ring-inset", toneClass)}>
          <CalendarDays className="h-5 w-5" aria-hidden />
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

function buildCalendarItems(
  events: CalendarEvent[],
  stages: ProjectStage[],
  milestones: Milestone[],
  projectById: Map<string, Project>
) {
  const manualItems: CalendarItem[] = events.map((event) => {
    const project = event.projectId ? projectById.get(event.projectId) : null;

    return {
      id: event.id,
      source: "manual",
      title: event.title,
      projectId: event.projectId,
      projectName: project?.name ?? "",
      clientName: project?.clientName ?? "",
      startDate: event.startDate,
      endDate: event.endDate || event.startDate,
      startTime: event.startTime,
      endTime: event.endTime,
      description: event.description,
      location: event.location,
      owner: event.owner,
      counterpartyType: event.counterpartyType,
      counterpartyName: event.counterpartyName,
      contactMethod: event.contactMethod,
      status: event.status,
      href: event.projectId ? `/projects/${event.projectId}` : "",
      editableEvent: event
    };
  });

  const stageItems: CalendarItem[] = stages.map((stage) => {
    const project = projectById.get(stage.projectId);

    return {
      id: stage.id,
      source: "stage",
      title: stage.stageName,
      projectId: stage.projectId,
      projectName: project?.name ?? "未綁定案子",
      clientName: project?.clientName ?? "",
      startDate: stage.startDate,
      endDate: stage.endDate || stage.startDate,
      startTime: "",
      endTime: "",
      description: "",
      location: "",
      owner: project?.designer ?? "",
      counterpartyType: "internal",
      counterpartyName: "",
      contactMethod: "",
      status: stage.status,
      href: `/projects/${stage.projectId}/progress`
    };
  });

  const milestoneItems: CalendarItem[] = milestones.map((milestone) => {
    const project = projectById.get(milestone.projectId);

    return {
      id: milestone.id,
      source: "milestone",
      title: milestone.title,
      projectId: milestone.projectId,
      projectName: project?.name ?? "未綁定案子",
      clientName: project?.clientName ?? "",
      startDate: milestone.dueDate,
      endDate: milestone.dueDate,
      startTime: "",
      endTime: "",
      description: milestone.description,
      location: "",
      owner: project?.designer ?? "",
      counterpartyType: "internal",
      counterpartyName: "",
      contactMethod: "",
      status: milestone.completed ? "done" : milestone.riskLevel,
      href: `/projects/${milestone.projectId}/progress`
    };
  });

  return [...manualItems, ...stageItems, ...milestoneItems].filter((item) => item.startDate).sort(compareCalendarItems);
}

function groupItemsByDate(items: CalendarItem[]) {
  const groups = new Map<string, CalendarItem[]>();

  items.forEach((item) => {
    expandDateRange(item.startDate, item.endDate || item.startDate).forEach((date) => {
      const dayItems = groups.get(date) ?? [];
      dayItems.push(item);
      groups.set(date, dayItems);
    });
  });

  groups.forEach((dayItems, date) => {
    groups.set(date, dayItems.sort(compareCalendarItems));
  });

  return groups;
}

function compareCalendarItems(a: CalendarItem, b: CalendarItem) {
  const dateOrder = a.startDate.localeCompare(b.startDate);
  if (dateOrder) return dateOrder;

  const timeOrder = (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
  if (timeOrder) return timeOrder;

  return a.title.localeCompare(b.title, "zh-TW");
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

function expandDateRange(startDate: string, endDate: string) {
  const start = parseDateString(startDate);
  const end = parseDateString(endDate || startDate);
  const dates: string[] = [];
  const maxDays = 180;

  for (let index = 0; index < maxDays; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    if (current > end) break;
    dates.push(toDateInputValue(current));
  }

  return dates;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA <= endB && (endA || startA) >= startB;
}

function monthStartFromDateString(date: string) {
  const parsed = parseDateString(date);
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
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

function formatDateRange(startDate: string, endDate: string) {
  if (!startDate) return "";
  if (!endDate || startDate === endDate) return formatDate(startDate);

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function formatTimeRange(startTime: string, endTime: string) {
  if (!startTime && !endTime) return "";
  if (startTime && endTime) return `${startTime}-${endTime}`;

  return startTime || endTime;
}

function getStatusText(item: CalendarItem) {
  if (item.source === "stage") {
    if (item.status === "done") return "完成";
    if (item.status === "doing") return "進行中";
    return isDateOverdue(item.endDate) ? "逾期" : "待處理";
  }

  if (item.source === "milestone") {
    if (item.status === "done") return "完成";
    if (item.status === "critical") return "重大風險";
    if (item.status === "high") return "高風險";
    if (item.status === "medium") return "中風險";
    return isDateOverdue(item.endDate) ? "逾期" : "待確認";
  }

  if (item.status === "done") return "完成";
  if (item.status === "cancelled") return "取消";
  return isDateOverdue(item.endDate) ? "逾期" : "已排程";
}

function getItemPillClassName(item: CalendarItem) {
  if (item.source === "stage") {
    if (item.status === "done") return "bg-emerald-50 text-emerald-800";
    if (isDateOverdue(item.endDate)) return "bg-red-50 text-red-800";
    return "bg-teal-50 text-teal-800";
  }

  if (item.source === "milestone") {
    if (item.status === "critical") return "bg-rose-100 text-rose-800";
    if (item.status === "high" || isDateOverdue(item.endDate)) return "bg-red-50 text-red-800";
    return "bg-amber-50 text-amber-800";
  }

  if (item.status === "cancelled") return "bg-slate-100 text-slate-500 line-through";
  if (item.status === "done") return "bg-emerald-50 text-emerald-800";
  return "bg-sky-50 text-sky-800";
}

function getItemBadgeClassName(item: CalendarItem) {
  if (item.source === "stage") return "bg-teal-50 text-teal-800";
  if (item.source === "milestone") return "bg-amber-50 text-amber-800";

  return "bg-sky-50 text-sky-800";
}

function getItemCardClassName(item: CalendarItem) {
  if (item.source === "stage") return "border-teal-100 bg-teal-50/40";
  if (item.source === "milestone") return "border-amber-100 bg-amber-50/50";

  return "border-sky-100 bg-sky-50/40";
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

const iconButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
