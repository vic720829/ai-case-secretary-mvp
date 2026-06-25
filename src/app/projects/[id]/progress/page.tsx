import { ProjectProgressClient } from "@/components/ProjectProgressClient";

export default async function ProjectProgressPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectProgressClient projectId={id} />;
}
