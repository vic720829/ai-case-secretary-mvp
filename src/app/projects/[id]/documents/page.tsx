import { ProjectDocumentsClient } from "@/components/ProjectDocumentsClient";

export default async function ProjectDocumentsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProjectDocumentsClient projectId={id} />;
}
