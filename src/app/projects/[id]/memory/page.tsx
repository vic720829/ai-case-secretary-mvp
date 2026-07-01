import { ProjectMemoryClient } from "@/components/ProjectMemoryClient";

export default async function ProjectMemoryPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectMemoryClient projectId={id} />;
}
