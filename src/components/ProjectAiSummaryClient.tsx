"use client";

import { ArrowLeft, FileDown, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { getProject, getProjectAiSummary } from "@/lib/firestore";
import type { Project, ProjectAiSummary } from "@/lib/types";

export function ProjectAiSummaryClient({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<ProjectAiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextSummary] = await Promise.all([
        getProject(projectId),
        getProjectAiSummary(projectId)
      ]);
      setProject(nextProject);
      setSummary(nextSummary);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleRefreshSummary() {
    setError("");
    setSuccessMessage("");
    setRefreshing(true);

    try {
      if (!user) throw new Error("請先登入。");

      const token = await user.getIdToken();
      const response = await fetch(`/api/projects/${projectId}/summary`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "更新案件摘要失敗。");
      }

      await loadData();
      setSuccessMessage("案件摘要已更新。");
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setRefreshing(false);
    }
  }

  function handleExportPdf() {
    if (!project || !summary) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("瀏覽器封鎖了 PDF 匯出視窗，請允許彈出式視窗後再試一次。");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildSummaryPrintHtml(project, summary));
    printWindow.document.close();
    printWindow.focus();

    window.setTimeout(() => {
      printWindow.print();
    }, 300);
  }

  if (loading) {
    return <LoadingState label="讀取案件摘要中" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="請回案件列表確認這個案件是否仍存在。"
        action={
          <SecondaryLink href="/projects">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件列表
          </SecondaryLink>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} AI 案件摘要`}
        description={`${project.clientName} / 整理本案件的 LINE 對話、待辦、事件、備忘錄、案件記憶、工期與關鍵節點。`}
        action={
          <>
            <SecondaryLink href={`/projects/${project.id}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              回案件詳情
            </SecondaryLink>
            <Button type="button" onClick={() => void handleRefreshSummary()} disabled={refreshing}>
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
              {refreshing ? "整理中" : "重新整理摘要"}
            </Button>
            {summary ? (
              <Button type="button" onClick={handleExportPdf}>
                <FileDown className="h-4 w-4" aria-hidden />
                匯出 PDF
              </Button>
            ) : null}
          </>
        }
      />

      <ErrorMessage message={error} />
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <section className="rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-900">
        這是內部案件整理功能。AI 只會整理給公司後台看，不會用這份摘要自動回覆客戶群。
      </section>

      {summary ? (
        <>
          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                <Sparkles className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-950">總摘要</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                    {summary.source === "ai" ? "AI 整理" : "系統整理"}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{summary.summaryText}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>更新時間：{formatDateTime(summary.updatedAt ?? summary.createdAt)}</span>
                  {summary.refreshedBy ? <span>更新者：{summary.refreshedBy}</span> : null}
                  {summary.model ? <span>來源：{summary.model}</span> : null}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {summary.sections.map((section) => (
              <article key={section.title} className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
                <h3 className="text-base font-semibold text-slate-950">{section.title}</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  {section.items.length ? (
                    section.items.map((item, index) => (
                      <li key={`${section.title}-${index}`} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />
                        <span>{item}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-slate-500">目前沒有明確紀錄。</li>
                  )}
                </ul>
              </article>
            ))}
          </section>
        </>
      ) : (
        <EmptyState
          title="尚未建立 AI 案件摘要"
          description="按下重新整理摘要後，系統會讀取這個案件的對話、待辦、事件、備忘錄、案件記憶、工期與關鍵節點，整理成內部摘要。"
          action={
            <Button type="button" onClick={() => void handleRefreshSummary()} disabled={refreshing}>
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
              {refreshing ? "整理中" : "建立摘要"}
            </Button>
          }
        />
      )}
    </div>
  );
}

function buildSummaryPrintHtml(project: Project, summary: ProjectAiSummary) {
  const title = `${project.name} AI 案件摘要`;
  const projectMeta = [project.clientName, project.currentStage, project.status].filter(Boolean).join(" / ");
  const updatedAt = formatDateTime(summary.updatedAt ?? summary.createdAt);
  const sections = summary.sections
    .map(
      (section) => `
        <section class="section">
          <h2>${escapeHtml(section.title)}</h2>
          ${
            section.items.length
              ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
              : `<p class="muted">目前沒有整理到相關內容。</p>`
          }
        </section>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 16mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #0f172a;
        background: #ffffff;
        font-family: "Microsoft JhengHei", "Noto Sans TC", Arial, sans-serif;
        line-height: 1.75;
      }
      .cover {
        border-bottom: 3px solid #0f766e;
        padding-bottom: 18px;
        margin-bottom: 22px;
      }
      .eyebrow {
        color: #0f766e;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 8px 0;
        font-size: 28px;
        line-height: 1.3;
      }
      .meta {
        color: #64748b;
        font-size: 12px;
      }
      .summary {
        border: 1px solid #ccfbf1;
        border-radius: 10px;
        background: #f0fdfa;
        padding: 16px 18px;
        margin-bottom: 18px;
        white-space: pre-wrap;
      }
      .section {
        break-inside: avoid;
        page-break-inside: avoid;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 16px 18px;
        margin: 0 0 14px;
      }
      .section h2 {
        margin: 0 0 10px;
        color: #0f766e;
        font-size: 17px;
      }
      ul {
        margin: 0;
        padding-left: 20px;
      }
      li {
        margin-bottom: 7px;
      }
      .muted {
        color: #64748b;
        margin: 0;
      }
      .footer {
        margin-top: 22px;
        color: #94a3b8;
        font-size: 11px;
        text-align: right;
      }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <header class="cover">
      <div class="eyebrow">AI Case Secretary</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml(projectMeta || "案件摘要")} · 更新時間：${escapeHtml(updatedAt || "未記錄")}</div>
      ${summary.refreshedBy ? `<div class="meta">更新者：${escapeHtml(summary.refreshedBy)}</div>` : ""}
    </header>
    <main>
      <section class="summary">${escapeHtml(summary.summaryText)}</section>
      ${sections}
    </main>
    <footer class="footer">由 AI 案件秘書產生，請以實際合約、圖面、現場紀錄為準。</footer>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
