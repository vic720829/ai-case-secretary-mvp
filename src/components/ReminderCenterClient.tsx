"use client";

import { Bell, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDate, formatDateTime, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  confirmReminderLog,
  listAiTasks,
  listMilestones,
  listMilestonesForProjects,
  listProjectStages,
  listProjectStagesForProjects,
  listProjectsForProfile,
  listReminderLogs,
  listReminderLogsForProjects,
  listTasks,
  listTasksForProjects,
  upsertPendingReminderLog
} from "@/lib/firestore";
import { hasFullProjectAccess } from "@/lib/projectAccess";
import { buildReminderCandidates } from "@/lib/reminders";
import type { Project, ReminderLog, ReminderLogInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

export function ReminderCenterClient() {
  const { profile, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [reminders, setReminders] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingKey, setConfirmingKey] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const nextProjects = await listProjectsForProfile(profile);
      const projectIds = nextProjects.map((project) => project.id);
      const fullAccess = hasFullProjectAccess(profile?.role);
      const [tasks, stages, milestones, aiTasks, logs] = await Promise.all([
        fullAccess ? listTasks() : listTasksForProjects(projectIds),
        fullAccess ? listProjectStages() : listProjectStagesForProjects(projectIds),
        fullAccess ? listMilestones() : listMilestonesForProjects(projectIds),
        fullAccess ? listAiTasks() : Promise.resolve([]),
        fullAccess ? listReminderLogs() : listReminderLogsForProjects(projectIds)
      ]);
      const logByKey = new Map(logs.map((log) => [log.key, log]));
      const candidates = buildReminderCandidates({
        tasks,
        stages,
        milestones,
        aiTasks,
        today: todayInputValue()
      }).filter((candidate) => logByKey.get(candidate.key)?.status !== "confirmed");

      await Promise.all(
        candidates.map((candidate) => upsertPendingReminderLog(candidate))
      );

      setProjects(nextProjects);
      setReminders(fullAccess ? await listReminderLogs() : await listReminderLogsForProjects(projectIds));
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const pendingReminders = useMemo(
    () =>
      reminders
        .filter((reminder) => reminder.status === "pending")
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
          return (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99");
        }),
    [reminders]
  );
  const confirmedReminders = useMemo(
    () =>
      reminders
        .filter((reminder) => reminder.status === "confirmed")
        .sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0))
        .slice(0, 8),
    [reminders]
  );

  async function handleConfirm(reminder: ReminderLog) {
    setConfirmingKey(reminder.key);
    setError("");

    try {
      await confirmReminderLog(toReminderInput(reminder), user?.email ?? user?.uid ?? "未命名使用者");
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setConfirmingKey("");
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取提醒中心" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="提醒中心"
        description="集中處理工期、關鍵節點、待辦、AI 待辦與待審核草稿提醒。按已處理後，後台 LINE 每日提醒就不會再推送該項目。"
      />

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="待處理" value={pendingReminders.length} tone="amber" icon={<Clock className="h-5 w-5" aria-hidden />} />
        <MetricCard title="已處理" value={reminders.filter((reminder) => reminder.status === "confirmed").length} icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} />
        <MetricCard title="今日提醒" value={pendingReminders.filter((reminder) => reminder.lastRemindedOn === todayInputValue()).length} icon={<Bell className="h-5 w-5" aria-hidden />} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">待處理提醒</h2>
        {pendingReminders.length ? (
          <ReminderTable
            reminders={pendingReminders}
            projectById={projectById}
            confirmingKey={confirmingKey}
            onConfirm={handleConfirm}
          />
        ) : (
          <EmptyState title="目前沒有待處理提醒" description="AI 草稿待審核、工期進場提醒、關鍵節點提醒、逾期與高風險事項會出現在這裡。" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">最近已處理</h2>
        {confirmedReminders.length ? (
          <ConfirmedList reminders={confirmedReminders} projectById={projectById} />
        ) : (
          <EmptyState title="尚未有已處理提醒" description="按下已處理後，紀錄會出現在這裡。" />
        )}
      </section>
    </div>
  );
}

function ReminderTable({
  reminders,
  projectById,
  confirmingKey,
  onConfirm
}: {
  reminders: ReminderLog[];
  projectById: Map<string, Project>;
  confirmingKey: string;
  onConfirm: (reminder: ReminderLog) => Promise<void>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">提醒</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">日期</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {reminders.map((reminder) => {
              const project = projectById.get(reminder.projectId);

              return (
                <tr key={reminder.id} className="hover:bg-stone-50">
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-slate-950">{reminder.title}</div>
                      {reminder.priority === "high" ? <PriorityBadge /> : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{reminder.sourceLabel}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {project ? (
                      <Link className="inline-flex items-center gap-1 hover:text-teal-700" href={getReminderHref(reminder)}>
                        {project.name}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </Link>
                    ) : (
                      "未綁定案件"
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(reminder.dueDate)}</td>
                  <td className="px-4 py-4">
                    <StatusBadge status={reminder.status} />
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Button
                      type="button"
                      disabled={confirmingKey === reminder.key}
                      onClick={() => void onConfirm(reminder)}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      {confirmingKey === reminder.key ? "處理中" : "已處理"}
                    </Button>
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

function ConfirmedList({
  reminders,
  projectById
}: {
  reminders: ReminderLog[];
  projectById: Map<string, Project>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {reminders.map((reminder) => {
        const project = projectById.get(reminder.projectId);

        return (
          <div key={reminder.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold text-slate-950">{reminder.title}</div>
                  {reminder.priority === "high" ? <PriorityBadge /> : null}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {project?.name ?? "未綁定案件"} · {reminder.sourceLabel}
                </div>
              </div>
              <StatusBadge status={reminder.status} />
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {reminder.confirmedBy ? `處理人：${reminder.confirmedBy}` : "未記錄處理人"}
              {reminder.confirmedAt ? ` · ${formatDateTime(reminder.confirmedAt)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
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
  tone?: "teal" | "amber";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700 ring-teal-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100"
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

function StatusBadge({ status }: { status: ReminderLog["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        status === "confirmed"
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-amber-50 text-amber-700 ring-amber-200"
      )}
    >
      {status === "confirmed" ? "已處理" : "待處理"}
    </span>
  );
}

function PriorityBadge() {
  return (
    <span className="inline-flex min-h-5 items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
      高優先
    </span>
  );
}

function getReminderHref(reminder: ReminderLog) {
  if (reminder.sourceType === "ai_task" && reminder.reminderType === "ai_task_pending_review") return "/ai-tasks";
  if (reminder.sourceType === "message") return reminder.projectId ? `/projects/${reminder.projectId}/messages` : "/messages";
  if (reminder.sourceType === "task") return `/tasks/${reminder.sourceId}`;
  if (reminder.projectId) return `/projects/${reminder.projectId}/progress`;
  return "/risk-center";
}

function toReminderInput(reminder: ReminderLog): ReminderLogInput {
  return {
    key: reminder.key,
    sourceType: reminder.sourceType,
    sourceId: reminder.sourceId,
    reminderType: reminder.reminderType,
    projectId: reminder.projectId,
    title: reminder.title,
    sourceLabel: reminder.sourceLabel,
    dueDate: reminder.dueDate,
    status: reminder.status,
    priority: reminder.priority,
    firstTriggeredOn: reminder.firstTriggeredOn,
    lastRemindedOn: reminder.lastRemindedOn
  };
}
