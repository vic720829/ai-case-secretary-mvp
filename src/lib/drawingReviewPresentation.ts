import type {
  DrawingFindingReviewStatus,
  DrawingFindingSeverity,
  DrawingProjectSummaryStatus,
  DrawingRequirementCheckStatus,
  DrawingReviewResultStatus,
  DrawingReviewStatus
} from "@/lib/types";

export function drawingReviewStatusLabel(status: DrawingReviewStatus) {
  const labels: Record<DrawingReviewStatus, string> = {
    queued: "等待處理",
    extracting: "讀取 PDF",
    analyzing: "分析圖面",
    validating: "檢查尺寸規則",
    cross_checking: "跨頁比對",
    generating_report: "產生報告",
    completed: "已完成",
    failed: "處理失敗"
  };
  return labels[status];
}

export function drawingReviewResultLabel(status: DrawingReviewResultStatus) {
  const labels: Record<DrawingReviewResultStatus, string> = {
    pending: "尚未產生結果",
    needs_revision: "需修改",
    needs_confirmation: "需人工確認",
    passed: "審查通過",
    unable_to_review: "無法完成審查"
  };
  return labels[status];
}

export function drawingSeverityLabel(severity: DrawingFindingSeverity) {
  const labels: Record<DrawingFindingSeverity, string> = {
    fatal: "明確問題",
    warning: "建議確認",
    insufficient: "資料不足",
    passed: "核對通過"
  };
  return labels[severity];
}

export function drawingFindingReviewLabel(status: DrawingFindingReviewStatus) {
  const labels: Record<DrawingFindingReviewStatus, string> = {
    pending: "尚未覆核",
    confirmed: "已確認",
    false_positive: "誤判"
  };
  return labels[status];
}

export function drawingProjectSummaryStatusLabel(status: DrawingProjectSummaryStatus) {
  const labels: Record<DrawingProjectSummaryStatus, string> = {
    pending: "等待擷取",
    included: "已納入既有摘要",
    missing: "案件尚無摘要",
    not_included: "未使用摘要功能"
  };
  return labels[status];
}

export function drawingRequirementCheckStatusLabel(status: DrawingRequirementCheckStatus) {
  const labels: Record<DrawingRequirementCheckStatus, string> = {
    matched: "已確認符合",
    conflict: "明確不符",
    suspected_missing: "疑似漏畫",
    unable_to_confirm: "圖面無法確認",
    out_of_scope: "不在本次圖面範圍"
  };
  return labels[status];
}

export function isDrawingReviewRunning(status: DrawingReviewStatus) {
  return status !== "completed" && status !== "failed";
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
