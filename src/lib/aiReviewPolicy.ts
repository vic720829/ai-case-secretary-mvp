export type AiReviewStatusLike = "pending" | "approved" | "rejected" | string;
export type AiReviewAction = "approve" | "reject";

export function canReviewAiDraft(reviewStatus: AiReviewStatusLike) {
  return reviewStatus === "pending";
}

export function getAiReviewBlockedReason(reviewStatus: AiReviewStatusLike, action: AiReviewAction) {
  if (canReviewAiDraft(reviewStatus)) return "";
  const actionLabel = action === "approve" ? "approved" : "rejected";

  return `This AI draft has already been reviewed and cannot be ${actionLabel} again.`;
}
