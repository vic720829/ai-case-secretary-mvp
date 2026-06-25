import { NewTaskClient } from "@/components/NewTaskClient";

export default async function NewTaskPage({
  searchParams
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const params = await searchParams;
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;

  return <NewTaskClient initialProjectId={projectId ?? ""} />;
}
