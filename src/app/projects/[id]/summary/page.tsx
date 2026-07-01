import { ProjectAiSummaryClient } from "@/components/ProjectAiSummaryClient";

export default async function ProjectSummaryPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProjectAiSummaryClient projectId={id} />;
}
