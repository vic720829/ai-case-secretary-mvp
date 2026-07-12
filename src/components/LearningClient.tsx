"use client";

import { CheckCircle2, ListChecks, PauseCircle, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { aiTaskTypeOptions, riskLevelOptions } from "@/lib/constants";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  createLearnedRule,
  listAiFeedbackEvents,
  listLearnedRules,
  setLearnedRuleEnabled
} from "@/lib/firestore";
import type {
  AiFeedbackAction,
  AiFeedbackEvent,
  AiTaskType,
  LearnedRule,
  ReminderPriority,
  RiskLevel
} from "@/lib/types";
import { cn } from "@/lib/utils";

type RuleFormState = {
  name: string;
  description: string;
  keywordsText: string;
  outcomeTaskType: AiTaskType | "";
  outcomeRiskLevel: RiskLevel | "";
  notifyPriority: ReminderPriority;
  enabled: boolean;
};

const initialRuleForm: RuleFormState = {
  name: "",
  description: "",
  keywordsText: "",
  outcomeTaskType: "",
  outcomeRiskLevel: "",
  notifyPriority: "normal",
  enabled: true
};

export function LearningClient() {
  const { profile, user } = useAuth();
  const [events, setEvents] = useState<AiFeedbackEvent[]>([]);
  const [rules, setRules] = useState<LearnedRule[]>([]);
  const [form, setForm] = useState<RuleFormState>(initialRuleForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (profile?.role !== "owner") {
      setLoading(false);
      return;
    }

    setError("");

    try {
      const [nextEvents, nextRules] = await Promise.all([listAiFeedbackEvents(), listLearnedRules()]);
      setEvents(nextEvents);
      setRules(nextRules);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [profile?.role]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const enabledRules = useMemo(() => rules.filter((rule) => rule.enabled), [rules]);
  const disabledRules = useMemo(() => rules.filter((rule) => !rule.enabled), [rules]);

  async function handleCreateRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const actor = profile?.displayName || user?.email || "owner";
      await createLearnedRule({
        name: form.name.trim(),
        description: form.description.trim(),
        triggerKeywords: parseKeywords(form.keywordsText),
        outcomeTaskType: form.outcomeTaskType,
        outcomeRiskLevel: form.outcomeRiskLevel,
        notifyPriority: form.notifyPriority,
        enabled: form.enabled,
        createdBy: actor,
        updatedBy: actor
      });
      setForm(initialRuleForm);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleRule(rule: LearnedRule) {
    setError("");

    try {
      await setLearnedRuleEnabled(rule.id, !rule.enabled, profile?.displayName || user?.email || "owner");
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取 AI 學習資料" />;
  }

  if (profile?.role !== "owner") {
    return <EmptyState title="沒有權限" description="只有擁有者可以查看與管理 AI 學習方向。" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI 學習"
        description="只記錄明確決策與 owner 確認過的規則；目前不會自動改變 AI 判斷。"
      />

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="學習事件" value={events.length} tone="teal" icon={<ListChecks className="h-5 w-5" aria-hidden />} />
        <MetricCard title="啟用規則" value={enabledRules.length} tone="emerald" icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} />
        <MetricCard title="停用規則" value={disabledRules.length} tone="slate" icon={<PauseCircle className="h-5 w-5" aria-hidden />} />
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">建立 owner 確認規則</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              這些規則目前只保存，不會自動套用到 LINE 或 AI。下一階段確認後，才會接進 AI 判斷流程。
            </p>
          </div>
        </div>

        <form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={(event) => void handleCreateRule(event)}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">規則名稱</span>
            <input
              className={inputClassName}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：修補缺失列為高風險"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">觸發關鍵字</span>
            <input
              className={inputClassName}
              value={form.keywordsText}
              onChange={(event) => setForm((current) => ({ ...current, keywordsText: event.target.value }))}
              placeholder="修補、缺失、品質不好"
              required
            />
          </label>

          <label className="block lg:col-span-2">
            <span className="text-sm font-medium text-slate-700">規則說明</span>
            <textarea
              className={`${inputClassName} min-h-20 resize-y`}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="說明這條規則之後要如何影響 AI 判斷。"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">建議類型</span>
            <select
              className={inputClassName}
              value={form.outcomeTaskType}
              onChange={(event) =>
                setForm((current) => ({ ...current, outcomeTaskType: event.target.value as AiTaskType | "" }))
              }
            >
              <option value="">不指定</option>
              {aiTaskTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">建議風險</span>
            <select
              className={inputClassName}
              value={form.outcomeRiskLevel}
              onChange={(event) =>
                setForm((current) => ({ ...current, outcomeRiskLevel: event.target.value as RiskLevel | "" }))
              }
            >
              <option value="">不指定</option>
              {riskLevelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">通知優先級</span>
            <select
              className={inputClassName}
              value={form.notifyPriority}
              onChange={(event) =>
                setForm((current) => ({ ...current, notifyPriority: event.target.value as ReminderPriority }))
              }
            >
              <option value="normal">一般</option>
              <option value="high">高優先</option>
            </select>
          </label>

          <label className="mt-7 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            建立後啟用
          </label>

          <div className="flex justify-end lg:col-span-2">
            <Button type="submit" disabled={submitting || !form.name.trim() || !form.keywordsText.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              {submitting ? "建立中" : "建立規則"}
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">已確認規則</h2>
        {rules.length ? (
          <RuleTable rules={rules} onToggleRule={handleToggleRule} />
        ) : (
          <EmptyState title="尚未建立學習規則" description="先從明確、低風險的規則開始，例如修補缺失列為高風險。" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">最近學習事件</h2>
        {events.length ? (
          <EventTable events={events} />
        ) : (
          <EmptyState title="尚未有學習事件" description="網站審核草稿或 LINE 後台按鈕操作後，事件會出現在這裡。" />
        )}
      </section>
    </div>
  );
}

function RuleTable({ rules, onToggleRule }: { rules: LearnedRule[]; onToggleRule: (rule: LearnedRule) => Promise<void> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">規則</th>
              <th className="px-4 py-3">關鍵字</th>
              <th className="px-4 py-3">結果</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-stone-50">
                <td className="px-4 py-4">
                  <div className="font-semibold text-slate-950">{rule.name}</div>
                  <div className="mt-1 max-w-md text-xs leading-5 text-slate-500">{rule.description || "未填寫說明"}</div>
                  <div className="mt-2 text-xs text-slate-400">建立：{formatDateTime(rule.createdAt)}</div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex max-w-xs flex-wrap gap-1.5">
                    {rule.triggerKeywords.map((keyword) => (
                      <span key={keyword} className="rounded-full bg-stone-100 px-2 py-1 text-xs text-slate-700">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-4 text-slate-600">
                  <div>{rule.outcomeTaskType ? `類型：${aiTaskTypeLabel(rule.outcomeTaskType)}` : "類型：不指定"}</div>
                  <div className="mt-1">{rule.outcomeRiskLevel ? `風險：${riskLabel(rule.outcomeRiskLevel)}` : "風險：不指定"}</div>
                  <div className="mt-1">通知：{rule.notifyPriority === "high" ? "高優先" : "一般"}</div>
                </td>
                <td className="px-4 py-4">
                  <StatusBadge enabled={rule.enabled} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Button type="button" variant="secondary" onClick={() => void onToggleRule(rule)}>
                    {rule.enabled ? "停用" : "啟用"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventTable({ events }: { events: AiFeedbackEvent[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">時間</th>
              <th className="px-4 py-3">來源</th>
              <th className="px-4 py-3">動作</th>
              <th className="px-4 py-3">目標</th>
              <th className="px-4 py-3">操作者</th>
              <th className="px-4 py-3">變更</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {events.map((event) => (
              <tr key={event.id} className="align-top hover:bg-stone-50">
                <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDateTime(event.createdAt)}</td>
                <td className="px-4 py-4">
                  <SourceBadge source={event.source} />
                </td>
                <td className="px-4 py-4 text-slate-700">{actionLabel(event.action)}</td>
                <td className="px-4 py-4">
                  <div className="font-semibold text-slate-950">{event.targetTitle || event.targetId}</div>
                  {event.note ? <div className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{event.note}</div> : null}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  <div>{event.actorName || "未記錄"}</div>
                  {event.actorRole ? <div className="mt-1 text-xs text-slate-500">{event.actorRole}</div> : null}
                </td>
                <td className="min-w-72 px-4 py-4">
                  {event.changes.length ? (
                    <div className="space-y-1.5">
                      {event.changes.map((change, index) => (
                        <div key={`${event.id}-${change.field}-${index}`} className="rounded-md bg-stone-50 px-2.5 py-2 text-xs text-slate-600">
                          <span className="font-medium text-slate-800">{change.field}</span>
                          ：{formatChangeValue(change.before)} → {formatChangeValue(change.after)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">沒有欄位變更</span>
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

function MetricCard({
  title,
  value,
  icon,
  tone
}: {
  title: string;
  value: number;
  icon: ReactNode;
  tone: "teal" | "emerald" | "slate";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700",
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-50 text-slate-700"
  }[tone];

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-md", toneClass)}>{icon}</div>
      </div>
    </section>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200"
      )}
    >
      {enabled ? "啟用" : "停用"}
    </span>
  );
}

function SourceBadge({ source }: { source: AiFeedbackEvent["source"] }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200">
      {source === "line" ? "LINE" : "網站"}
    </span>
  );
}

function parseKeywords(value: string) {
  return value
    .split(/[、,\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function actionLabel(action: AiFeedbackAction) {
  const map: Record<AiFeedbackAction, string> = {
    approve_ai_task: "核准 AI 草稿",
    reject_ai_task: "拒絕 AI 草稿",
    update_ai_task_draft: "修改 AI 草稿",
    confirm_reminder: "確認提醒",
    snooze_reminder: "稍後提醒",
    keep_reminder: "保留待處理",
    cancel_reminder: "取消追蹤",
    resolve_ai_followup: "標記已回覆",
    snooze_ai_followup: "明天追蹤",
    complete_task: "完成待辦"
  };

  return map[action] ?? action;
}

function aiTaskTypeLabel(value: AiTaskType) {
  return aiTaskTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function riskLabel(value: RiskLevel) {
  return riskLevelOptions.find((option) => option.value === value)?.label ?? value;
}

function formatChangeValue(value: string) {
  return value || "空白";
}

const inputClassName =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
