import { ProjectMessagesClient } from "@/components/ProjectMessagesClient";

export default async function ProjectMessagesPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectMessagesClient projectId={id} />;
}
