"use client";

import { PencilLine, PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listAuditLogs } from "@/lib/firestore";
import type { AuditAction, AuditLog } from "@/lib/types";
import { cn } from "@/lib/utils";

type ActionFilter = "all" | AuditAction;

export function AuditLogsClient() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadLogs() {
      setError("");

      try {
        setLogs(await listAuditLogs());
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadLogs();
  }, []);

  const filteredLogs = useMemo(
    () => logs.filter((log) => actionFilter === "all" || log.action === actionFilter),
    [logs, actionFilter]
  );
  const createCount = useMemo(() => logs.filter((log) => log.action === "create").length, [logs]);
  const updateCount = useMemo(() => logs.filter((log) => log.action === "update").length, [logs]);
  const deleteCount = useMemo(() => logs.filter((log) => log.action === "delete").length, [logs]);

  if (loading) {
    return <LoadingState label="正在讀取操作紀錄" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="操作紀錄"
        description="查看案件建立、修改、刪除紀錄，以及每次異動的欄位。"
      />

      <ErrorMessage message={error} />

      {!error ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="新增案件" value={createCount} tone="teal" icon={<PlusCircle className="h-5 w-5" aria-hidden />} />
            <MetricCard label="修改案件" value={updateCount} tone="indigo" icon={<PencilLine className="h-5 w-5" aria-hidden />} />
            <MetricCard label="刪除案件" value={deleteCount} tone="red" icon={<Trash2 className="h-5 w-5" aria-hidden />} />
          </div>

          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <label className="block max-w-xs">
              <span className="text-sm font-medium text-slate-700">動作</span>
              <select
                className={inputClassName}
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value as ActionFilter)}
              >
                <option value="all">全部動作</option>
                <option value="create">新增</option>
                <option value="update">修改</option>
                <option value="delete">刪除</option>
              </select>
            </label>
          </section>

          {filteredLogs.length ? (
            <AuditLogTable logs={filteredLogs} />
          ) : (
            <EmptyState title="沒有操作紀錄" description="建立、修改或刪除案件後，紀錄會出現在這裡。" />
          )}
        </>
      ) : null}
    </div>
  );
}

function AuditLogTable({ logs }: { logs: AuditLog[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">時間</th>
              <th className="px-4 py-3">動作</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">操作者</th>
              <th className="px-4 py-3">異動內容</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {logs.map((log) => (
              <tr key={log.id} className="align-top hover:bg-stone-50">
                <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <ActionBadge action={log.action} />
                </td>
                <td className="px-4 py-4">
                  <div className="font-semibold text-slate-950">{log.resourceName || "未命名案件"}</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-500">{log.resourceId}</div>
                </td>
                <td className="px-4 py-4 text-slate-600">
                  <div>{log.actorName || log.actorEmail || "未記錄"}</div>
                  {log.actorEmail ? <div className="mt-1 text-xs text-slate-500">{log.actorEmail}</div> : null}
                </td>
                <td className="min-w-80 px-4 py-4">
                  {log.changes.length ? (
                    <div className="space-y-2">
                      {log.changes.map((change, index) => (
                        <div key={`${log.id}-${change.field}-${index}`} className="rounded-md bg-stone-50 px-3 py-2">
                          <div className="font-medium text-slate-800">{change.field}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-600">
                            {formatChangeValue(change.before)} → {formatChangeValue(change.after)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-500">沒有欄位變更</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionBadge({ action }: { action: AuditAction }) {
  const map = {
    create: "bg-teal-50 text-teal-700 ring-teal-200",
    update: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    delete: "bg-red-50 text-red-700 ring-red-200"
  };
  const label = {
    create: "新增",
    update: "修改",
    delete: "刪除"
  };

  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", map[action])}>
      {label[action]}
    </span>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "teal" | "indigo" | "red";
}) {
  const toneClassName = {
    teal: "bg-teal-50 text-teal-700",
    indigo: "bg-indigo-50 text-indigo-700",
    red: "bg-red-50 text-red-700"
  }[tone];

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-md", toneClassName)}>
          {icon}
        </div>
      </div>
    </section>
  );
}

function formatChangeValue(value: string) {
  return value || "空白";
}

const inputClassName =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
