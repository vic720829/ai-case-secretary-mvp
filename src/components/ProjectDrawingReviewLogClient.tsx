"use client";

import { ArrowLeft, FileText, Plus, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { useAuth } from "@/components/AuthProvider";
import { formatDateTime } from "@/lib/date";
import {
  drawingProjectSummaryStatusLabel,
  drawingReviewResultLabel,
  drawingReviewStatusLabel
} from "@/lib/drawingReviewPresentation";
import { getProject } from "@/lib/firestore";
import type { DrawingReview, Project } from "@/lib/types";
import { listDrawingReviewsByProject } from "@/services/drawingReviews";

export function ProjectDrawingReviewLogClient({ projectId }: { projectId: string }) {
  const { profile } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [reviews, setReviews] = useState<DrawingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canCreate = profile?.role !== "viewer";

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [nextProject, nextReviews] = await Promise.all([
        getProject(projectId),
        listDrawingReviewsByProject(projectId)
      ]);
      setProject(nextProject);
      setReviews(nextReviews);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取審圖日誌失敗。");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) return <LoadingState label="正在讀取案件審圖日誌" />;
  if (!project) return <EmptyState title="找不到案件" description="案件可能已刪除，或目前帳號沒有權限。" />;

  return (
    <div className="space-y-6">
      <header className="border-b border-stone-200 pb-5">
        <div className="text-sm font-medium text-teal-700">案件審圖日誌</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{project.name}</h1>
        <p className="mt-2 text-sm text-slate-600">保存每次審查的 PDF 名稱、結果摘要與正式報告，不覆蓋歷史版本。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className={secondaryButtonClass} href={`/projects/${projectId}`}><ArrowLeft className="h-4 w-4" aria-hidden />回案件</Link>
          {canCreate ? <Link className={primaryButtonClass} href={`/drawing-reviews?projectId=${projectId}`}><Plus className="h-4 w-4" aria-hidden />新增審圖</Link> : null}
        </div>
      </header>

      <ErrorMessage message={error} />

      {reviews.length ? (
        <div className="space-y-4">
          {reviews.map((review, index) => (
            <article key={review.id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">第 {reviews.length - index} 次審圖 · {formatDateTime(review.createdAt)}</div>
                  <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-950"><FileText className="h-5 w-5 text-teal-700" aria-hidden />{review.sourceFileName}</h2>
                  <p className="mt-2 text-sm text-slate-600">上傳者：{review.uploadedByName || "—"}　規則：{review.ruleSetVersion || "—"}　案件摘要：{drawingProjectSummaryStatusLabel(review.projectSummaryStatus)}</p>
                </div>
                <Link className={secondaryButtonClass} href={`/drawing-reviews/${review.id}`}><ScanSearch className="h-4 w-4" aria-hidden />查看結果</Link>
              </div>

              <div className="mt-4 grid gap-3 rounded-md bg-stone-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <LogInfo label="處理狀態" value={drawingReviewStatusLabel(review.status)} />
                <LogInfo label="審查結論" value={drawingReviewResultLabel(review.resultStatus)} />
                <LogInfo label="明確問題" value={`${review.fatalCount} 項`} />
                <LogInfo label="建議確認" value={`${review.warningCount + review.insufficientCount} 項`} />
              </div>

              {review.summaryText ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{review.summaryText}</p> : (
                <p className="mt-4 text-sm text-slate-500">{review.statusMessage || "尚未產生審查摘要。"}</p>
              )}
              {review.note ? <div className="mt-3 text-sm text-slate-600">圖面備註：{review.note}</div> : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="此案件尚無審圖日誌"
          description="上傳第一份施工圖後，PDF 名稱、審查結果與報告會自動記錄在此。"
          action={canCreate ? <Link className={primaryButtonClass} href={`/drawing-reviews?projectId=${projectId}`}><Plus className="h-4 w-4" aria-hidden />新增審圖</Link> : undefined}
        />
      )}
    </div>
  );
}

function LogInfo({ label, value }: { label: string; value: string }) {
  return <div><div className="text-slate-500">{label}</div><div className="mt-1 font-semibold text-slate-900">{value}</div></div>;
}

const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50";
const primaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800";
