"use client";

import { AlertTriangle, Bot, BriefcaseBusiness, Filter, MessageSquareText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { RiskBadge } from "@/components/StatusBadges";
import { EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listIncidents, listProjects } from "@/lib/firestore";
import type { Incident, IncidentStatus, IncidentType, Project, RiskLevel } from "@/lib/types";

const incidentTypeLabels: Record<IncidentType, string> = {
  promise: "承諾",
  change: "變更",
  followup: "追蹤",
  payment: "收款",
  invoice: "發票",
  complaint: "客訴 / 缺失",
  schedule: "工期",
  file: "圖面 / 檔案",
  unknown: "待判斷"
};

const statusLabels: Record<IncidentStatus, string> = {
  open: "處理中",
  resolved: "已完成",
  ignored: "已忽略"
};

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("open");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [typeFilter, setTypeFilter] = useState<IncidentType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextIncidents, nextProjects] = await Promise.all([listIncidents(), listProjects()]);
        setIncidents(nextIncidents);
        setProjects(nextProjects);
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const filteredIncidents = useMemo(
    () =>
      incidents.filter((incident) => {
        if (statusFilter !== "all" && incident.status !== statusFilter) return false;
        if (riskFilter !== "all" && incident.riskLevel !== riskFilter) return false;
        if (typeFilter !== "all" && incident.incidentType !== typeFilter) return false;
        return true;
      }),
    [incidents, riskFilter, statusFilter, typeFilter]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="事件中心"
        description="把同一串 LINE 訊息、AI 草稿與正式待辦串在同一件事件底下。"
        action={<SecondaryLink href="/ai-tasks">待辦審核</SecondaryLink>}
      />

      {error ? <ErrorMessage message={error} /> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="處理中事件" value={incidents.filter((incident) => incident.status === "open").length} />
        <SummaryCard
          label="重大 / 高風險"
          value={incidents.filter((incident) => incident.riskLevel === "critical" || incident.riskLevel === "high").length}
        />
        <SummaryCard
          label="待審草稿關聯"
          value={incidents.reduce((total, incident) => total + incident.aiTaskIds.length, 0)}
        />
      </section>

      <section className="rounded-md border border-stone-200 bg-white p-4 shadow-panel">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Filter className="h-4 w-4 text-teal-700" aria-hidden />
          篩選
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField
            label="狀態"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as IncidentStatus | "all")}
            options={[
              ["open", "處理中"],
              ["all", "全部"],
              ["resolved", "已完成"],
              ["ignored", "已忽略"]
            ]}
          />
          <SelectField
            label="風險"
            value={riskFilter}
            onChange={(value) => setRiskFilter(value as RiskLevel | "all")}
            options={[
              ["all", "全部"],
              ["critical", "重大風險"],
              ["high", "高風險"],
              ["medium", "中風險"],
              ["low", "低風險"]
            ]}
          />
          <SelectField
            label="類型"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as IncidentType | "all")}
            options={[
              ["all", "全部"],
              ["complaint", "客訴 / 缺失"],
              ["change", "變更"],
              ["promise", "承諾"],
              ["followup", "追蹤"],
              ["schedule", "工期"],
              ["file", "圖面 / 檔案"],
              ["payment", "收款"],
              ["invoice", "發票"],
              ["unknown", "待判斷"]
            ]}
          />
        </div>
      </section>

      {loading ? (
        <LoadingState label="讀取事件中" />
      ) : filteredIncidents.length ? (
        <section className="overflow-hidden rounded-md border border-stone-200 bg-white shadow-panel">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">事件</th>
                  <th className="px-4 py-3">案件</th>
                  <th className="px-4 py-3">類型</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">風險</th>
                  <th className="px-4 py-3">關聯</th>
                  <th className="px-4 py-3">更新時間</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredIncidents.map((incident) => {
                  const project = projectById.get(incident.projectId);

                  return (
                    <tr key={incident.id} className="hover:bg-stone-50">
                      <td className="max-w-md px-4 py-4">
                        <div className="font-semibold text-slate-950">{incident.title || "未命名事件"}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{incident.summary}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {project ? (
                          <Link className="font-medium text-teal-700 hover:text-teal-900" href={`/projects/${project.id}`}>
                            {project.name}
                          </Link>
                        ) : (
                          "未綁定案件"
                        )}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{incidentTypeLabels[incident.incidentType]}</td>
                      <td className="px-4 py-4 text-slate-600">{statusLabels[incident.status]}</td>
                      <td className="px-4 py-4">
                        <RiskBadge risk={incident.riskLevel} />
                      </td>
                      <td className="px-4 py-4 text-xs leading-5 text-slate-500">
                        LINE {incident.sourceMessageIds.length} 則
                        <br />
                        草稿 {incident.aiTaskIds.length} 張 / 待辦 {incident.taskIds.length} 件
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(incident.updatedAt)}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {incident.projectId ? (
                            <IconLink href={`/projects/${incident.projectId}/messages`} label="對話">
                              <MessageSquareText className="h-4 w-4" aria-hidden />
                            </IconLink>
                          ) : null}
                          <IconLink href="/ai-tasks" label="草稿">
                            <Bot className="h-4 w-4" aria-hidden />
                          </IconLink>
                          {incident.projectId ? (
                            <IconLink href={`/projects/${incident.projectId}`} label="案件">
                              <BriefcaseBusiness className="h-4 w-4" aria-hidden />
                            </IconLink>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyState title="目前沒有符合條件的事件" description="新的 LINE 訊息進來後，系統會自動把訊息、草稿與待辦串成事件。" />
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: [string, string][];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-slate-600">
      {label}
      <select
        className="min-h-10 rounded-md border border-stone-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-stone-50"
      href={href}
      title={label}
    >
      {children}
      <span>{label}</span>
    </Link>
  );
}
