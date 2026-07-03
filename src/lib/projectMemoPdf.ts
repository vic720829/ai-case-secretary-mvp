import { formatDate, formatDateTime } from "@/lib/date";
import type { MessageAttachment, Project, ProjectMemo } from "@/lib/types";

export function buildProjectMemoPrintHtml(project: Project, memo: ProjectMemo, attachments: MessageAttachment[]) {
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
    memo.sourceTaskTitle ? `來源待辦：${memo.sourceTaskTitle}` : "",
    memo.sourceTaskDueDate ? `截止日：${formatDate(memo.sourceTaskDueDate)}` : "",
    memo.sourceTaskStatus ? `待辦狀態：${memo.sourceTaskStatus}` : "",
    memo.sourceTaskRiskLevel ? `風險等級：${memo.sourceTaskRiskLevel}` : "",
    memo.createdBy ? `建立者：${memo.createdBy}` : "",
    `建立時間：${formatDateTime(memo.createdAt) || "未記錄"}`,
    memo.updatedAt ? `更新時間：${formatDateTime(memo.updatedAt)}` : ""
  ].filter(Boolean);

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(memo.title)} - ${escapeHtml(project.name)} 備忘錄</title>
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
      <div class="meta">${escapeHtml(project.name)} ｜ ${escapeHtml(project.clientName || "未設定客戶")} ｜ 匯出時間：${escapeHtml(generatedAt)}</div>
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
      ${buildImageAttachmentHtml(imageAttachments)}
      ${buildFileAttachmentHtml(fileAttachments)}
    </main>
    <footer class="footer">由 AI 案件秘書產生，請以正式合約、圖面與 LINE 原始紀錄為準。</footer>
  </body>
</html>`;
}

function buildImageAttachmentHtml(attachments: MessageAttachment[]) {
  if (!attachments.length) return "";

  return `
    <section class="section">
      <h2>附件縮圖</h2>
      <div class="attachments">
        ${attachments
          .map(
            (attachment, index) => `
              <figure>
                <img src="${escapeAttribute(attachment.fileUrl)}" alt="附件 ${index + 1}" />
                <figcaption>${escapeHtml(attachment.senderName || "附件")} ｜ ${escapeHtml(
                  formatDateTime(attachment.createdAt) || "未記錄時間"
                )}</figcaption>
              </figure>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function buildFileAttachmentHtml(attachments: MessageAttachment[]) {
  if (!attachments.length) return "";

  return `
    <section class="section">
      <h2>其他附件</h2>
      <ul class="source-list">
        ${attachments
          .map((attachment) => `<li><a href="${escapeAttribute(attachment.fileUrl)}">${escapeHtml(attachment.text || "附件")}</a></li>`)
          .join("")}
      </ul>
    </section>
  `;
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
