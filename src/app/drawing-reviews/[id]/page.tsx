import { DrawingReviewDetailClient } from "@/components/DrawingReviewDetailClient";

export default async function DrawingReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DrawingReviewDetailClient reviewId={id} />;
}
