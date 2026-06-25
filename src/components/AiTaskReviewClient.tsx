"use client";

import { AlertTriangle, Bot, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { aiTaskTypeOptions } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { approveAiTask, listAiTasks, listProjects, rejectAiTask } from "@/lib/firestore";
import type { AiTask, AiTaskReviewStatus, AiTaskType, Project, RiskLevel, TaskInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

const riskByAiTaskType: Record<AiTaskType, RiskLevel> = {
  promise: "medium",
  change: "high",
  followup: "medium",
  payment: "high",
  invoice: "high"
};

export function AiTaskReviewClient() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [aiTasks, setAiTasks] = useState<AiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProjects, nextAiTasks] = await Promise.all([listProjects(), listAiTasks()]);
      setProjects(nextProjects);
      setAiTasks(nextAiTasks);
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
  const pendingTasks = useMemo(() => aiTasks.filter((task) => task.reviewStatus === "pending"), [aiTasks]);
  const approvedTasks = useMemo(() => aiTasks.filter((task) => task.reviewStatus === "approved"), [aiTasks]);
  const rejectedTasks = useMemo(() => aiTasks.filter((task) => task.reviewStatus === "rejected"), [aiTasks]);
  const reviewedTasks = useMemo(
    () =>
      aiTasks
        .filter((task) => task.reviewStatus !== "pending")
        .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))
        .slice(0, 12),
    [aiTasks]
  );

  async function handleApprove(task: AiTask) {
    setProcessingId(task.id);
    setError("");

    try {
      await approveAiTask(task.id, toTaskInput(task), user?.email ?? user?.uid ?? "unknown");
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setProcessingId("");
    }
  }

  async function handleReject(task: AiTask) {
    const confirmed = window.confirm(`確定拒絕 AI 草稿「${task.title}」？`);
    if (!confirmed) return;

    setProcessingId(task.id);
    setError("");

    try {
      await rejectAiTask(task.id, user?.email ?? user?.uid ?? "unknown");
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setProcessingId("");
    }
  }

  if (loading) {
    return <LoadingState label="讀取 AI 任務草稿" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI 任務審核"
        description="從案件 LINE 群組辨識出的承諾、變更、追蹤、收款與發票事項。"
      />

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="待審核" value={pendingTasks.length} tone="amber" icon={<Bot className="h-5 w-5" aria-hidden />} />
        <MetricCard title="已核准" value={approvedTasks.length} tone="teal" icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} />
        <MetricCard title="已拒絕" value={rejectedTasks.length} tone="slate" icon={<XCircle className="h-5 w-5" aria-hidden />} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">待審核草稿</h2>
        {pendingTasks.length ? (
          <AiTaskReviewTable
            aiTasks={pendingTasks}
            projectById={projectById}
            processingId={processingId}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ) : (
          <EmptyState title="目前沒有待審核草稿" description="案件 LINE 群組出現承諾、變更或收款等訊息時，會出現在這裡。" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">最近審核紀錄</h2>
        {reviewedTasks.length ? (
          <ReviewedList aiTasks={reviewedTasks} projectById={projectById} />
        ) : (
          <EmptyState title="尚無審核紀錄" description="核准或拒絕 AI 草稿後，會保留最近紀錄。" />
        )}
      </section>
    </div>
  );
}

function AiTaskReviewTable({
  aiTasks,
  projectById,
  processingId,
  onApprove,
  onReject
}: {
  aiTasks: AiTask[];
  projectById: Map<string, Project>;
  processingId: string;
  onApprove: (task: AiTask) => Promise<void>;
  onReject: (task: AiTask) => Promise<void>;
}) {
  const typeLabel = new Map(aiTaskTypeOptions.map((option) => [option.value, option.label]));

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">AI 草稿</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">類型</th>
              <th className="px-4 py-3">負責人</th>
              <th className="px-4 py-3">截止日</th>
              <th className="px-4 py-3 text-right">處理</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {aiTasks.map((task) => {
              const project = projectById.get(task.projectId);
              const disabled = processingId === task.id || !project;

              return (
                <tr key={task.id} className="hover:bg-stone-50">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-950">{task.title}</div>
                    {task.description ? (
                      <div className="mt-1 line-clamp-2 max-w-sm text-xs leading-5 text-slate-500">
                        {task.description}
                      </div>
                    ) : null}
                    {task.sourceSenderName ? (
                      <div className="mt-2 text-xs text-slate-500">來源：{task.sourceSenderName}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {project ? (
                      <Link className="inline-flex items-center gap-1 hover:text-teal-700" href={`/projects/${project.id}/messages`}>
                        {project.name}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        未綁定案件
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600">{typeLabel.get(task.taskType) ?? task.taskType}</td>
                  <td className="px-4 py-4 text-slate-600">{task.assignedTo || "未指定"}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {task.dueDate ? formatDate(dateToInputValue(task.dueDate)) : "未設定"}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        disabled={disabled}
                        onClick={() => void onApprove(task)}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        核准
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={processingId === task.id}
                        onClick={() => void onReject(task)}
                      >
                        <XCircle className="h-4 w-4" aria-hidden />
                        拒絕
                      </Button>
                    </div>
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

function ReviewedList({
  aiTasks,
  projectById
}: {
  aiTasks: AiTask[];
  projectById: Map<string, Project>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {aiTasks.map((task) => {
        const project = projectById.get(task.projectId);

        return (
          <div key={task.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-950">{task.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {project?.name ?? "未綁定案件"} · {task.reviewedBy || "未記錄審核者"}
                </div>
              </div>
              <ReviewStatusBadge status={task.reviewStatus} />
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {task.reviewedAt ? formatDateTime(task.reviewedAt) : "尚未記錄時間"}
              {task.approvedTaskId ? ` · 已建立正式任務` : ""}
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
  tone
}: {
  title: string;
  value: number;
  icon: ReactNode;
  tone: "teal" | "amber" | "slate";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700 ring-teal-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-100"
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

function ReviewStatusBadge({ status }: { status: AiTaskReviewStatus }) {
  const label = {
    pending: "待審核",
    approved: "已核准",
    rejected: "已拒絕"
  }[status];

  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        status === "approved" && "bg-emerald-50 text-emerald-700 ring-emerald-200",
        status === "pending" && "bg-amber-50 text-amber-700 ring-amber-200",
        status === "rejected" && "bg-slate-50 text-slate-700 ring-slate-200"
      )}
    >
      {label}
    </span>
  );
}

function toTaskInput(task: AiTask): TaskInput {
  return {
    title: task.title,
    description: task.description,
    projectId: task.projectId,
    assignee: task.assignedTo,
    dueDate: task.dueDate ? dateToInputValue(task.dueDate) : "",
    status: task.status,
    source: "ai",
    riskLevel: riskByAiTaskType[task.taskType]
  };
}

function dateToInputValue(date: Date) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}
