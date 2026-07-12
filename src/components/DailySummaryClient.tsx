"use client";

import { BriefcaseBusiness, CalendarDays, MessageSquareText, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";

type DailySummary = {
  id: string;
  summaryDate: string;
  contextStartDate: string;
  title: string;
  text: string;
  source: "ai" | "fallback";
  projectIds: string[];
  projectCount: number;
  messageCount: number;
  generatedAt: string;
};

export function DailySummaryClient() {
  const { user } = useAuth();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadSummaries = useCallback(async (refresh = false) => {
    if (!user) return;

    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/daily-summaries", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });
      const result = (await response.json()) as {
        ok?: boolean;
        summaries?: DailySummary[];
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "每日摘要讀取失敗。");
      }

      const nextSummaries = result.summaries ?? [];
      setSummaries(nextSummaries);
      setSelectedId((current) =>
        current && nextSummaries.some((summary) => summary.id === current)
          ? current
          : nextSummaries[0]?.id ?? ""
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "每日摘要讀取失敗。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  const selected = useMemo(
    () => summaries.find((summary) => summary.id === selectedId) ?? summaries[0] ?? null,
    [selectedId, summaries]
  );

  if (loading) {
    return <LoadingState label="正在整理每日摘要" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="每日摘要"
        description="每天 08:30 彙整前七天對話脈絡，聚焦前一天有新對話的案件。"
        action={
          <Button type="button" onClick={() => void loadSummaries(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
            {refreshing ? "更新中" : "重新整理"}
          </Button>
        }
      />

      <ErrorMessage message={error} />

      {!selected ? (
        <EmptyState title="昨日沒有新對話" description="沒有新對話時，系統不會產生空白摘要。" />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryStat
              label="摘要日期"
              value={formatDate(selected.summaryDate)}
              icon={<CalendarDays className="h-5 w-5" aria-hidden />}
            />
            <SummaryStat
              label="涵蓋案件"
              value={`${selected.projectCount} 件`}
              icon={<BriefcaseBusiness className="h-5 w-5" aria-hidden />}
            />
            <SummaryStat
              label="昨日新訊息"
              value={`${selected.messageCount} 則`}
              icon={<MessageSquareText className="h-5 w-5" aria-hidden />}
            />
            <SummaryStat
              label="產生方式"
              value={selected.source === "ai" ? "AI 整理" : "備援整理"}
              icon={<Sparkles className="h-5 w-5" aria-hidden />}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
              <div className="border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">歷史摘要</h2>
              </div>
              <div className="max-h-[620px] divide-y divide-stone-100 overflow-y-auto">
                {summaries.map((summary) => {
                  const active = summary.id === selected.id;

                  return (
                    <button
                      key={summary.id}
                      className={`w-full px-4 py-3 text-left transition ${
                        active ? "bg-teal-50" : "hover:bg-stone-50"
                      }`}
                      type="button"
                      onClick={() => setSelectedId(summary.id)}
                    >
                      <div className={active ? "font-semibold text-teal-800" : "font-semibold text-slate-800"}>
                        {formatDate(summary.summaryDate)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {summary.projectCount} 件案件 · {summary.messageCount} 則新訊息
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <article className="min-w-0 rounded-lg border border-stone-200 bg-white p-5 shadow-panel sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{selected.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(selected.contextStartDate)} 至 {formatDate(selected.summaryDate)}
                  </p>
                </div>
                <div className="text-xs text-slate-500">產生時間：{formatDateTime(selected.generatedAt)}</div>
              </div>
              <div className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-700">{selected.text}</div>
            </article>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex min-h-28 items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div>
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <div className="mt-3 text-xl font-semibold text-slate-950">{value}</div>
      </div>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
        {icon}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "未設定";
  return value.replaceAll("-", "/");
}

function formatDateTime(value: string) {
  if (!value) return "尚未記錄";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未記錄";

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
