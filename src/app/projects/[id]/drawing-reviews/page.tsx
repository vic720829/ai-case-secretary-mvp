import { ProjectDrawingReviewLogClient } from "@/components/ProjectDrawingReviewLogClient";

export default async function ProjectDrawingReviewLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDrawingReviewLogClient projectId={id} />;
}
