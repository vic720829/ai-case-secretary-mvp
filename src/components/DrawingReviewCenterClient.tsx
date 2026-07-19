"use client";

import { FileText, LoaderCircle, ScanSearch, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { DRAWING_REVIEW_RULE_SET_VERSION, drawingReviewRules } from "@/lib/drawingReviewRules";
import {
  drawingReviewResultLabel,
  drawingReviewStatusLabel,
  formatFileSize
} from "@/lib/drawingReviewPresentation";
import { listProjectsForProfile } from "@/lib/firestore";
import type { DrawingReview, Project } from "@/lib/types";
import {
  createDrawingReview,
  listDrawingReviewsForProfile,
  MAX_DRAWING_PDF_BYTES
} from "@/services/drawingReviews";

export function DrawingReviewCenterClient() {
  const { profile, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviews, setReviews] = useState<DrawingReview[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const canUpload = profile?.role !== "viewer";
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projectId, projects]);

  const loadData = useCallback(async () => {
    if (!profile) return;
    setError("");
    try {
      const nextProjects = await listProjectsForProfile(profile);
      const nextReviews = await listDrawingReviewsForProfile(profile, nextProjects);
      setProjects(nextProjects);
      setReviews(nextReviews);
      setProjectId((current) => current || searchParams.get("projectId") || nextProjects[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取審圖中心失敗。");
    } finally {
      setLoading(false);
    }
  }, [profile, searchParams]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !user || !selectedProject || !file || !canUpload) return;

    setSubmitting(true);
    setUploadProgress(0);
    setError("");

    try {
      const reviewId = await createDrawingReview({
        project: selectedProject,
        file,
        note,
        userId: user.uid,
        userName: profile.displayName || profile.email || user.email || "",
        onUploadProgress: setUploadProgress
      });

      const response = await fetch(`/api/drawing-reviews/${reviewId}/dispatch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken(true)}`
        }
      });
      const result = await response.json().catch(() => ({})) as { dispatched?: boolean; error?: string; message?: string };
      if (!response.ok || result.dispatched === false) {
        setError(result.error || "PDF 已上傳，但背景審圖服務暫時無法啟動；工作已保留，可稍後重試。");
        setSubmitting(false);
        return;
      }

      router.push(`/drawing-reviews/${reviewId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立審圖工作失敗。");
      setSubmitting(false);
    }
  }

  function acceptFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setError("");
    if (!nextFile.name.toLowerCase().endsWith(".pdf")) {
      setError("只能上傳 PDF 施工圖。");
      return;
    }
    if (nextFile.size > MAX_DRAWING_PDF_BYTES) {
      setError("PDF 不得超過 50 MB。");
      return;
    }
    setFile(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  }

  if (loading) return <LoadingState label="正在讀取審圖中心" />;

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">審圖中心</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">選擇案件並上傳施工圖，完成後會自動建立案件審圖日誌。</p>
      </header>

      <ErrorMessage message={error} />

      {canUpload ? (
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-teal-50 p-2 text-teal-700"><ScanSearch className="h-5 w-5" aria-hidden /></div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">建立新審圖</h2>
              <p className="mt-1 text-sm text-slate-500">PDF 只會上傳一次，並使用案件編號直接歸檔。</p>
            </div>
          </div>

          <form className="mt-5 space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">案件</span>
                <select
                  className={inputClassName}
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  required
                >
                  <option value="">請選擇案件</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}{project.clientName ? ` / ${project.clientName}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">圖面備註（選填）</span>
                <input
                  className={inputClassName}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：系統櫃送廠版 V3"
                />
              </label>
            </div>

            <div
              className={`rounded-lg border-2 border-dashed px-6 py-9 text-center transition ${dragging ? "border-teal-500 bg-teal-50" : "border-stone-300 bg-stone-50"}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <UploadCloud className="mx-auto h-8 w-8 text-teal-700" aria-hidden />
              {file ? (
                <div className="mt-3">
                  <div className="font-medium text-slate-900">{file.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{formatFileSize(file.size)}</div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-600">將 PDF 拖到這裡，或點擊選擇檔案</div>
              )}
              <button
                className="mt-4 rounded-md border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                選擇 PDF
              </button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => acceptFile(event.target.files?.[0])}
              />
              <p className="mt-3 text-xs text-slate-500">上限 50 MB；系統會驗證檔案內容，不只檢查副檔名。</p>
            </div>

            <div className="flex flex-col gap-3 rounded-md bg-stone-50 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <div>規則版本：<span className="font-medium text-slate-900">{DRAWING_REVIEW_RULE_SET_VERSION}</span>（{drawingReviewRules.length} 條核心規則）</div>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-5 py-2 font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={!selectedProject || !file || submitting}
              >
                {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ScanSearch className="h-4 w-4" aria-hidden />}
                {submitting ? `上傳中 ${uploadProgress}%` : "開始分析"}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">目前帳號是檢視者，只能查看既有審圖紀錄。</div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">最近審圖紀錄</h2>
        {reviews.length ? (
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">案件／PDF</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3">結果</th><th className="px-4 py-3">上傳者</th><th className="px-4 py-3">日期</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {reviews.map((review) => (
                    <tr key={review.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <Link className="font-medium text-teal-700 hover:underline" href={`/drawing-reviews/${review.id}`}>{review.projectNameSnapshot}</Link>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" aria-hidden />{review.sourceFileName}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{drawingReviewStatusLabel(review.status)}</td>
                      <td className="px-4 py-3 text-slate-700">{drawingReviewResultLabel(review.resultStatus)}</td>
                      <td className="px-4 py-3 text-slate-600">{review.uploadedByName || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(review.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState title="尚無審圖紀錄" description="選擇案件並上傳第一份施工圖後，紀錄會顯示在這裡。" />
        )}
      </section>
    </div>
  );
}

const inputClassName = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
