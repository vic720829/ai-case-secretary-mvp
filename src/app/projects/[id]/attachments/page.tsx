import { ProjectAttachmentsClient } from "@/components/ProjectAttachmentsClient";

export default async function ProjectAttachmentsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProjectAttachmentsClient projectId={id} />;
}
