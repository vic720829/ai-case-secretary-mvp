import { TaskDetailClient } from "@/components/TaskDetailClient";

export default async function TaskDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetailClient taskId={id} />;
}
