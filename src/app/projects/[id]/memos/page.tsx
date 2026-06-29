import { ProjectMemosClient } from "@/components/ProjectMemosClient";

export default async function ProjectMemosPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectMemosClient projectId={id} />;
}
