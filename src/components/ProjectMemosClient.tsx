"use client";

import { ArrowLeft, ExternalLink, FileDown, ImageIcon, NotebookText, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDate, formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { createProjectMemo, deleteProjectMemo, getProject, listProjectMemosByProject, listTasksByProject } from "@/lib/firestore";
import type { MessageAttachment, Project, ProjectMemo, Task } from "@/lib/types";
import { RiskBadge, TaskStatusBadge } from "./StatusBadges";

export function ProjectMemosClient({ projectId }: { projectId: string }) {
  const { profile, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [memos, setMemos] = useState<ProjectMemo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextMemos] = await Promise.all([
        getProject(projectId),
        listProjectMemosByProject(projectId)
      ]);
      const nextTasks = nextProject ? await listTasksByProject(projectId) : [];
      setProject(nextProject);
      setMemos(nextMemos);
      setTasks(nextTasks);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  function getMemoAttachments(memo: ProjectMemo) {
    if (memo.attachments?.length) return memo.attachments;
    if (!memo.sourceTaskId) return [];

    return taskById.get(memo.sourceTaskId)?.attachments ?? [];
  }

  async function handleDeleteMemo(memo: ProjectMemo) {
    await deleteProjectMemo(memo.id);
    setMemos((current) => current.filter((item) => item.id !== memo.id));
  }

  async function handleCreateMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setSubmitting(true);

    try {
      const title = memoTitle.trim();
      const content = memoContent.trim();

      if (!title) throw new Error("請輸入備忘錄標題。");
      if (!content) throw new Error("請輸入備忘錄內容。");

      const attachments = selectedFiles.length ? await uploadManualMemoAttachments(selectedFiles) : [];

      await createProjectMemo({
        projectId,
        title,
        content,
        attachments,
        attachmentMessageIds: attachments.map((attachment) => attachment.messageId),
        attachmentCount: attachments.length,
        createdBy: profile?.displayName || user?.email || ""
      });
      setMemoTitle("");
      setMemoContent("");
      setSelectedFiles([]);
      setFileInputKey((current) => current + 1);
      setSuccessMessage(`已新增備忘錄：${title}`);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadManualMemoAttachments(files: File[]) {
    if (!user) throw new Error("請先登入後再上傳附件。");

    const token = await user.getIdToken();
    const formData = new FormData();
    formData.append("projectId", projectId);
    files.forEach((file) => formData.append("files", file));

    const response = await fetch("/api/project-memos/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });
    const result = (await response.json()) as MemoAttachmentUploadResponse;

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "附件上傳失敗。");
    }

    return (result.attachments ?? []).map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt ? new Date(attachment.createdAt) : null
    }));
  }

  function handleExportMemoPdf(memo: ProjectMemo, attachments: MessageAttachment[]) {
    if (!project) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("瀏覽器封鎖了 PDF 匯出視窗，請允許彈出式視窗後再試一次。");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildMemoPrintHtml(project, memo, attachments));
    printWindow.document.close();

    const print = () => {
      printWindow.focus();
      printWindow.print();
    };
    const images = Array.from(printWindow.document.images);

    if (!images.length) {
      window.setTimeout(print, 300);
      return;
    }

    let settledCount = 0;
    let printed = false;
    const printWhenReady = () => {
      settledCount += 1;
      if (printed || settledCount < images.length) return;

      printed = true;
      window.setTimeout(print, 200);
    };

    images.forEach((image) => {
      if (image.complete) {
        printWhenReady();
        return;
      }

      image.onload = printWhenReady;
      image.onerror = printWhenReady;
    });

    window.setTimeout(() => {
      if (printed) return;
      printed = true;
      print();
    }, 1500);
  }

  if (loading) {
    return <LoadingState label="正在讀取案件備忘錄" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="這個案件可能已被刪除，請回到案件列表確認。"
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
        title={`${project.name} 案件備忘錄`}
        description={`${project.clientName} / 集中記錄已答應客戶的變更、尺寸、做法與重要承諾。`}
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <ErrorMessage message={error} />
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700">
            <NotebookText className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">備忘錄用途</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              待辦完成代表事情處理完；備忘錄保留當初答應過客戶什麼，例如改尺寸、改顏色、增加施工項目或後續承諾。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Plus className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">新增備忘錄</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              不一定要從待辦轉入，也可以手動記錄客戶同意、現場變更、尺寸調整或之後查案會用到的重點。
            </p>
          </div>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={(event) => void handleCreateMemo(event)}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">標題</span>
            <input
              className={inputClassName}
              value={memoTitle}
              onChange={(event) => setMemoTitle(event.target.value)}
              placeholder="例如：客戶同意主臥衣櫃改尺寸"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">內容</span>
            <textarea
              className={`${inputClassName} min-h-28 resize-y`}
              value={memoContent}
              onChange={(event) => setMemoContent(event.target.value)}
              placeholder="記錄答應過什麼、誰提出、什麼時間、後續要注意什麼。"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">附件 / 照片</span>
            <input
              key={fileInputKey}
              className={inputClassName}
              type="file"
              accept="image/*,application/pdf,.pdf"
              multiple
              onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
            />
            <span className="mt-1 block text-xs text-slate-500">
              可上傳圖片或 PDF，一次最多 8 個，每個 10MB 以內。圖片會出現在備忘錄 PDF 的縮圖區。
            </span>
          </label>

          {selectedFiles.length ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700">
              <div className="font-medium text-slate-900">已選擇 {selectedFiles.length} 個附件</div>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {selectedFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`} className="flex justify-between gap-3">
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0">{formatFileSize(file.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !memoTitle.trim() || !memoContent.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              {submitting ? "上傳並儲存中" : "新增備忘錄"}
            </Button>
          </div>
        </form>
      </section>

      {memos.length ? (
        <section className="space-y-3">
          {memos.map((memo) => (
            <article key={memo.id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-950">{memo.title}</h2>
                    {memo.sourceTaskStatus ? <TaskStatusBadge status={memo.sourceTaskStatus} /> : null}
                    {memo.sourceTaskRiskLevel ? <RiskBadge risk={memo.sourceTaskRiskLevel} /> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{memo.content}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                    {memo.sourceTaskId ? (
                      <Link
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800"
                        href={`/tasks/${memo.sourceTaskId}`}
                      >
                        原待辦：{memo.sourceTaskTitle || memo.sourceTaskId}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </Link>
                    ) : null}
                    {memo.sourceTaskDueDate ? <span>原截止日：{formatDate(memo.sourceTaskDueDate)}</span> : null}
                    {memo.createdBy ? <span>建立者：{memo.createdBy}</span> : null}
                    <span>建立時間：{formatDateTime(memo.createdAt)}</span>
                  </div>
                </div>
                <MemoAttachmentPreview attachments={getMemoAttachments(memo)} />
                <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col">
                  <Button type="button" variant="secondary" onClick={() => handleExportMemoPdf(memo, getMemoAttachments(memo))}>
                    <FileDown className="h-4 w-4" aria-hidden />
                    匯出 PDF
                  </Button>
                  <ConfirmDeleteButton
                    label="移除"
                    confirmMessage={`確定移除備忘錄「${memo.title}」？原待辦不會被刪除。`}
                    onConfirm={() => handleDeleteMemo(memo)}
                  />
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="尚未建立案件備忘錄"
          description="在案件待辦或今日風險中心按「加入備忘錄」，就會把重要承諾與變更保存到這裡。"
        />
      )}
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

type MemoAttachmentUploadResponse = {
  ok?: boolean;
  error?: string;
  attachments?: Array<Omit<MessageAttachment, "createdAt"> & { createdAt?: string | null }>;
};

function MemoAttachmentPreview({ attachments }: { attachments: MessageAttachment[] }) {
  if (!attachments.length) return null;

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3 lg:w-56">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
        <ImageIcon className="h-3.5 w-3.5 text-teal-700" aria-hidden />
        附件縮圖 {attachments.length} 張
      </div>
      <div className="grid grid-cols-3 gap-2">
        {attachments.slice(0, 6).map((attachment) => (
          <a
            key={attachment.messageId}
            className="block overflow-hidden rounded-md border border-stone-200 bg-white"
            href={attachment.fileUrl}
            target="_blank"
            rel="noreferrer"
            title="開啟原圖"
          >
            {attachment.fileType === "image" ? (
              <Image
                className="aspect-square w-full object-cover"
                src={attachment.fileUrl}
                alt="備忘錄附件"
                width={96}
                height={96}
                unoptimized
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-white px-1 text-center text-[10px] font-semibold text-slate-600">
                PDF
              </div>
            )}
          </a>
        ))}
      </div>
      {attachments.length > 6 ? <div className="mt-2 text-xs text-slate-500">另有 {attachments.length - 6} 張</div> : null}
    </div>
  );
}

function buildMemoPrintHtml(project: Project, memo: ProjectMemo, attachments: MessageAttachment[]) {
  const title = `${project.name} 備忘錄`;
  const imageAttachments = attachments.filter((attachment) => attachment.fileType === "image");
  const fileAttachments = attachments.filter((attachment) => attachment.fileType !== "image");
  const generatedAt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
  const sourceRows = [
    memo.sourceTaskTitle ? `原待辦：${memo.sourceTaskTitle}` : "",
    memo.sourceTaskDueDate ? `原截止日：${formatDate(memo.sourceTaskDueDate)}` : "",
    memo.sourceTaskStatus ? `原狀態：${memo.sourceTaskStatus}` : "",
    memo.sourceTaskRiskLevel ? `原風險：${memo.sourceTaskRiskLevel}` : "",
    memo.createdBy ? `建立者：${memo.createdBy}` : "",
    `建立時間：${formatDateTime(memo.createdAt) || "未記錄"}`,
    memo.updatedAt ? `更新時間：${formatDateTime(memo.updatedAt)}` : ""
  ].filter(Boolean);
  const imageAttachmentHtml = imageAttachments.length
    ? `
      <section class="section">
        <h2>附件縮圖</h2>
        <div class="attachments">
          ${imageAttachments
            .map(
              (attachment, index) => `
                <figure>
                  <img src="${escapeAttribute(attachment.fileUrl)}" alt="附件 ${index + 1}" />
                  <figcaption>${escapeHtml(attachment.senderName || "LINE 附件")} · ${escapeHtml(formatDateTime(attachment.createdAt) || "未記錄")}</figcaption>
                </figure>
              `
            )
            .join("")}
        </div>
      </section>
    `
    : "";
  const fileAttachmentHtml = fileAttachments.length
    ? `
      <section class="section">
        <h2>其他附件</h2>
        <ul class="source-list">
          ${fileAttachments
            .map(
              (attachment) =>
                `<li><a href="${escapeAttribute(attachment.fileUrl)}">${escapeHtml(attachment.text || "附件")}</a></li>`
            )
            .join("")}
        </ul>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(memo.title)} - ${escapeHtml(title)}</title>
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
        padding-bottom: 16px;
        margin-bottom: 18px;
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
        font-size: 26px;
        line-height: 1.3;
      }
      h2 {
        margin: 0 0 10px;
        color: #0f766e;
        font-size: 17px;
      }
      .meta {
        color: #64748b;
        font-size: 12px;
      }
      .section {
        break-inside: avoid;
        page-break-inside: avoid;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 16px 18px;
        margin-bottom: 14px;
      }
      .content {
        white-space: pre-wrap;
        font-size: 14px;
      }
      .source-list {
        margin: 0;
        padding-left: 18px;
        color: #475569;
        font-size: 12px;
      }
      .attachments {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      figure {
        break-inside: avoid;
        page-break-inside: avoid;
        margin: 0;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        overflow: hidden;
        background: #f8fafc;
      }
      img {
        display: block;
        width: 100%;
        height: 190px;
        object-fit: cover;
        background: #f1f5f9;
      }
      figcaption {
        padding: 8px 10px;
        color: #64748b;
        font-size: 11px;
      }
      .footer {
        margin-top: 20px;
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
      <div class="eyebrow">Project Memo</div>
      <h1>${escapeHtml(memo.title)}</h1>
      <div class="meta">${escapeHtml(project.name)} · ${escapeHtml(project.clientName || "未填客戶")} · 產生時間：${escapeHtml(generatedAt)}</div>
    </header>
    <main>
      <section class="section">
        <h2>備忘錄內容</h2>
        <div class="content">${escapeHtml(memo.content)}</div>
      </section>
      <section class="section">
        <h2>來源資訊</h2>
        <ul class="source-list">${sourceRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>
      </section>
      ${imageAttachmentHtml}
      ${fileAttachmentHtml}
    </main>
    <footer class="footer">由 AI 案件秘書產生，請以實際合約、圖面、現場紀錄與 LINE 原始訊息為準。</footer>
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

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
