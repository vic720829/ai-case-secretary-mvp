"use client";

import { AlertCircle, CheckCircle2, CircleSlash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listWebhookLogs } from "@/lib/firestore";
import type { WebhookLog, WebhookLogStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | WebhookLogStatus;

export function WebhookLogsClient() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        setLogs(await listWebhookLogs());
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const filteredLogs = useMemo(
    () => logs.filter((log) => statusFilter === "all" || log.status === statusFilter),
    [logs, statusFilter]
  );
  const successCount = useMemo(() => logs.filter((log) => log.status === "success").length, [logs]);
  const skippedCount = useMemo(() => logs.filter((log) => log.status === "skipped").length, [logs]);
  const errorCount = useMemo(() => logs.filter((log) => log.status === "error").length, [logs]);

  if (loading) {
    return <LoadingState label="正在讀取 Webhook 紀錄" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhook 紀錄"
        description="查看 LINE Webhook 是否成功同步、是否被略過，以及 AI 草稿建立數。"
      />

      <ErrorMessage message={error} />

      {!error ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard title="成功" value={successCount} tone="teal" icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} />
            <MetricCard title="略過" value={skippedCount} tone="slate" icon={<CircleSlash className="h-5 w-5" aria-hidden />} />
            <MetricCard title="錯誤" value={errorCount} tone="red" icon={<AlertCircle className="h-5 w-5" aria-hidden />} />
          </div>

          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <label className="block max-w-xs">
              <span className="text-sm font-medium text-slate-700">狀態</span>
              <select
                className={inputClassName}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">全部狀態</option>
                <option value="success">成功</option>
                <option value="skipped">略過</option>
                <option value="error">錯誤</option>
              </select>
            </label>
          </section>

          {filteredLogs.length ? <WebhookLogTable logs={filteredLogs} /> : <EmptyState title="沒有 Webhook 紀錄" description="LINE 事件進入後，處理結果會出現在這裡。" />}
        </>
      ) : null}
    </div>
  );
}

function WebhookLogTable({ logs }: { logs: WebhookLog[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">時間</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">事件</th>
              <th className="px-4 py-3">來源</th>
              <th className="px-4 py-3">訊息</th>
              <th className="px-4 py-3">groupId</th>
              <th className="px-4 py-3">messageId</th>
              <th className="px-4 py-3">AI 草稿</th>
              <th className="px-4 py-3">後台通知</th>
              <th className="px-4 py-3">說明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-stone-50">
                <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDateTime(log.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-4">
                  <WebhookStatusBadge status={log.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                  {log.eventType}
                  {log.messageType ? ` / ${log.messageType}` : ""}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  <div>{log.senderName || "未記錄"}</div>
                  <div className="mt-1 text-xs text-slate-500">{log.senderRole || "未記錄身份"}</div>
                </td>
                <td className="max-w-80 px-4 py-4 text-slate-700">
                  <div className="line-clamp-3 whitespace-pre-wrap">{log.messageText || "未記錄"}</div>
                </td>
                <td className="max-w-56 break-all px-4 py-4 font-mono text-xs text-slate-500">{log.groupId || "未提供"}</td>
                <td className="max-w-56 break-all px-4 py-4 font-mono text-xs text-slate-500">
                  {log.lineMessageId || log.messageId || "未提供"}
                </td>
                <td className="px-4 py-4 text-slate-600">{log.aiTaskDrafts}</td>
                <td className="px-4 py-4 text-slate-600">
                  {log.adminNotifications}
                  {log.adminNotificationFailures ? (
                    <span className="ml-1 text-xs text-red-600">失敗 {log.adminNotificationFailures}</span>
                  ) : null}
                </td>
                <td className="min-w-64 px-4 py-4 text-slate-600">
                  {log.errorMessage || log.reason || "處理完成"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WebhookStatusBadge({ status }: { status: WebhookLogStatus }) {
  const map = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    skipped: "bg-slate-50 text-slate-700 ring-slate-200",
    error: "bg-red-50 text-red-700 ring-red-200"
  };
  const label = {
    success: "成功",
    skipped: "略過",
    error: "錯誤"
  };

  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", map[status])}>
      {label[status]}
    </span>
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
  icon: React.ReactNode;
  tone: "teal" | "slate" | "red";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700 ring-teal-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-100",
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

const inputClassName =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
