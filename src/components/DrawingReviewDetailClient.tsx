"use client";

import { ArrowLeft, CheckCircle2, Download, FileText, Printer, RefreshCw, ShieldQuestion, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import {
  drawingFindingReviewLabel,
  drawingReviewResultLabel,
  drawingReviewStatusLabel,
  drawingSeverityLabel,
  formatFileSize,
  isDrawingReviewRunning
} from "@/lib/drawingReviewPresentation";
import type { DrawingFindingReviewStatus, DrawingReview, DrawingReviewFinding } from "@/lib/types";
import {
  getDrawingReview,
  listDrawingReviewFindings,
  updateDrawingFindingReview
} from "@/services/drawingReviews";

export function DrawingReviewDetailClient({ reviewId }: { reviewId: string }) {
  const { profile, user } = useAuth();
  const [review, setReview] = useState<DrawingReview | null>(null);
  const [findings, setFindings] = useState<DrawingReviewFinding[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingFindingId, setSavingFindingId] = useState("");
  const [downloading, setDownloading] = useState<"source" | "report" | "">("");
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState("");

  const canReviewFindings = profile ? ["owner", "admin", "manager"].includes(profile.role) : false;
  const canDispatch = profile?.role !== "viewer";

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setError("");
    try {
      const nextReview = await getDrawingReview(reviewId);
      const nextFindings = nextReview ? await listDrawingReviewFindings(reviewId, nextReview.projectId) : [];
      setReview(nextReview);
      setFindings(nextFindings);
      setNotes((current) => ({
        ...Object.fromEntries(nextFindings.map((finding) => [finding.id, finding.reviewNote])),
        ...current
      }));
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "讀取審圖結果失敗。");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!review || !isDrawingReviewRunning(review.status)) return;
    const timer = window.setInterval(() => void loadData(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadData, review]);

  const groupedFindings = useMemo(() => {
    return ["fatal", "warning", "insufficient", "passed"].map((severity) => ({
      severity: severity as DrawingReviewFinding["severity"],
      items: findings.filter((finding) => finding.severity === severity)
    })).filter((group) => group.items.length);
  }, [findings]);

  async function handleFindingReview(finding: DrawingReviewFinding, status: DrawingFindingReviewStatus) {
    if (!user || !canReviewFindings) return;
    setSavingFindingId(finding.id);
    setError("");
    try {
      await updateDrawingFindingReview(finding.id, {
        reviewStatus: status,
        reviewedBy: profile?.displayName || profile?.email || user.email || user.uid,
        reviewNote: notes[finding.id]?.trim() ?? ""
      });
      await loadData(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新人工覆核結果失敗。");
    } finally {
      setSavingFindingId("");
    }
  }

  async function openFile(kind: "source" | "report") {
    if (!user) return;
    setDownloading(kind);
    setError("");
    try {
      const response = await fetch(`/api/drawing-reviews/${reviewId}/file?kind=${kind}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` }
      });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "取得檔案失敗。");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得檔案失敗。");
    } finally {
      setDownloading("");
    }
  }

  async function dispatchReview() {
    if (!user || !canDispatch) return;
    setDispatching(true);
    setError("");
    try {
      const response = await fetch(`/api/drawing-reviews/${reviewId}/dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}` }
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "背景審圖服務暫時無法啟動。");
      await loadData(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "背景審圖服務暫時無法啟動。");
    } finally {
      setDispatching(false);
    }
  }

  if (loading) return <LoadingState label="正在讀取審圖結果" />;
  if (!review) {
    return <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-slate-600">找不到審圖紀錄，或目前帳號沒有權限。</div>;
  }

  return (
    <article className="space-y-6 print:space-y-4">
      <header className="border-b border-stone-200 pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-medium text-teal-700">施工圖審查報告</div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{review.projectNameSnapshot}</h1>
            <p className="mt-2 text-sm text-slate-600">{review.sourceFileName}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link className={secondaryButtonClass} href="/drawing-reviews"><ArrowLeft className="h-4 w-4" aria-hidden />回審圖中心</Link>
            <button className={secondaryButtonClass} type="button" onClick={() => void openFile("source")} disabled={downloading === "source"}>
              <FileText className="h-4 w-4" aria-hidden />{downloading === "source" ? "取得中" : "原始 PDF"}
            </button>
            {canDispatch && (review.status === "queued" || review.status === "failed") ? (
              <button className={secondaryButtonClass} type="button" onClick={() => void dispatchReview()} disabled={dispatching}>
                <RefreshCw className={`h-4 w-4 ${dispatching ? "animate-spin" : ""}`} aria-hidden />{dispatching ? "啟動中" : "重新啟動"}
              </button>
            ) : null}
            {review.reportStoragePath ? (
              <button className={secondaryButtonClass} type="button" onClick={() => void openFile("report")} disabled={downloading === "report"}>
                <Download className="h-4 w-4" aria-hidden />{downloading === "report" ? "取得中" : "下載報告"}
              </button>
            ) : null}
            <button className={primaryButtonClass} type="button" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />列印／存 PDF</button>
          </div>
        </div>
      </header>

      <ErrorMessage message={error} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="明確問題" value={review.fatalCount} tone="red" />
        <Metric label="建議確認" value={review.warningCount} tone="amber" />
        <Metric label="資料不足" value={review.insufficientCount} tone="slate" />
        <Metric label="核對通過" value={review.passedCount} tone="emerald" />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel print:shadow-none">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm text-slate-500">處理狀態</div>
            <div className="mt-1 text-lg font-semibold text-slate-950">{drawingReviewStatusLabel(review.status)}</div>
            <div className="mt-1 text-sm text-slate-600">{review.statusMessage || "等待系統更新狀態。"}</div>
          </div>
          <div className="rounded-md bg-stone-100 px-4 py-3 text-sm">
            <div className="text-slate-500">審查結論</div>
            <div className="mt-1 font-semibold text-slate-900">{drawingReviewResultLabel(review.resultStatus)}</div>
          </div>
        </div>
        {isDrawingReviewRunning(review.status) ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${Math.max(3, review.progress)}%` }} /></div>
            <div className="mt-1 text-right text-xs text-slate-500">{review.progress}%</div>
          </div>
        ) : null}
        {review.errorMessage ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{review.errorMessage}</div> : null}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel print:shadow-none">
        <h2 className="text-lg font-semibold text-slate-950">審圖資料</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label="PDF 名稱" value={review.sourceFileName} />
          <Info label="檔案大小" value={formatFileSize(review.sourceSizeBytes)} />
          <Info label="上傳者" value={review.uploadedByName || "—"} />
          <Info label="審圖日期" value={formatDateTime(review.createdAt)} />
          <Info label="規則版本" value={review.ruleSetVersion || "—"} />
          <Info label="AI 模型" value={review.modelVersion || "等待分析"} />
        </dl>
        {review.note ? <div className="mt-4 rounded-md bg-stone-50 px-3 py-2 text-sm text-slate-700">圖面備註：{review.note}</div> : null}
      </section>

      {review.summaryText ? (
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel print:shadow-none">
          <h2 className="text-lg font-semibold text-slate-950">審查摘要</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{review.summaryText}</p>
        </section>
      ) : null}

      <section className="space-y-5">
        <h2 className="text-lg font-semibold text-slate-950">審查內容結果</h2>
        {groupedFindings.length ? groupedFindings.map((group) => (
          <div key={group.severity} className="space-y-3">
            <h3 className="font-semibold text-slate-800">{drawingSeverityLabel(group.severity)}（{group.items.length}）</h3>
            {group.items.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                canReview={canReviewFindings}
                saving={savingFindingId === finding.id}
                note={notes[finding.id] ?? ""}
                onNoteChange={(value) => setNotes((current) => ({ ...current, [finding.id]: value }))}
                onReview={(status) => void handleFindingReview(finding, status)}
              />
            ))}
          </div>
        )) : (
          <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-slate-600">
            {review.status === "completed" ? "本次沒有回傳逐項問題。" : "分析完成後，問題、頁碼與公司規則會顯示在這裡。"}
          </div>
        )}
      </section>

      <footer className="border-t border-stone-200 pt-4 text-xs leading-5 text-slate-500">
        AI 審圖為施工前輔助檢查，結果仍須由公司專業人員覆核，不取代結構、消防、建築法規或專業技師簽證。
      </footer>
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "slate" | "emerald" }) {
  const styles = { red: "border-red-200 bg-red-50 text-red-800", amber: "border-amber-200 bg-amber-50 text-amber-800", slate: "border-slate-200 bg-slate-50 text-slate-800", emerald: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  return <div className={`rounded-lg border p-4 ${styles[tone]}`}><div className="text-sm">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-900">{value}</dd></div>;
}

function FindingCard({ finding, canReview, saving, note, onNoteChange, onReview }: { finding: DrawingReviewFinding; canReview: boolean; saving: boolean; note: string; onNoteChange: (value: string) => void; onReview: (status: DrawingFindingReviewStatus) => void }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel print:break-inside-avoid print:shadow-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">P{finding.pageNumber || "?"} · {finding.location || "位置待確認"} · {finding.ruleCode || "一般檢查"}</div><h4 className="mt-1 font-semibold text-slate-950">{finding.title}</h4></div>
        <div className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-slate-700">{drawingFindingReviewLabel(finding.reviewStatus)}</div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{finding.description}</p>
      {(finding.observedValue || finding.expectedValue) ? <div className="mt-3 grid gap-2 rounded-md bg-stone-50 p-3 text-sm sm:grid-cols-3"><Info label="圖面數值" value={finding.observedValue || "—"} /><Info label="公司標準" value={finding.expectedValue || "—"} /><Info label="差異" value={finding.difference || "—"} /></div> : null}
      {finding.evidence ? <div className="mt-3 text-sm text-slate-600">證據：{finding.evidence}</div> : null}
      {finding.recommendation ? <div className="mt-2 text-sm text-teal-800">建議：{finding.recommendation}</div> : null}
      {canReview ? (
        <div className="mt-4 border-t border-stone-100 pt-4 print:hidden">
          <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="人工覆核備註（選填）" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={secondaryButtonClass} type="button" disabled={saving} onClick={() => onReview("confirmed")}><CheckCircle2 className="h-4 w-4" aria-hidden />確認問題</button>
            <button className={secondaryButtonClass} type="button" disabled={saving} onClick={() => onReview("false_positive")}><XCircle className="h-4 w-4" aria-hidden />標記誤判</button>
            {finding.reviewStatus !== "pending" ? <button className={secondaryButtonClass} type="button" disabled={saving} onClick={() => onReview("pending")}><ShieldQuestion className="h-4 w-4" aria-hidden />改回待覆核</button> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const primaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800";
