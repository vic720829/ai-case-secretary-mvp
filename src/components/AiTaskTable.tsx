import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/date";
import { aiTaskTypeOptions, taskStatusOptions } from "@/lib/constants";
import type { AiTask, LineSenderRole, Project } from "@/lib/types";

export function AiTaskTable({
  aiTasks,
  projects
}: {
  aiTasks: AiTask[];
  projects: Project[];
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const typeLabel = new Map(aiTaskTypeOptions.map((option) => [option.value, option.label]));
  const statusLabel = new Map(taskStatusOptions.map((option) => [option.value, option.label]));

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">AI 待辦</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">類型</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">截止日</th>
              <th className="px-4 py-3">建立時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {aiTasks.map((task) => {
              const project = projectById.get(task.projectId);

              return (
                <tr key={task.id} className="hover:bg-stone-50">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-950">{task.title}</div>
                    {task.description ? (
                      <div className="mt-1 line-clamp-2 max-w-sm text-xs leading-5 text-slate-500">
                        {task.description}
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs text-slate-500">
                      {task.sourceSenderName || "未知來源"} · {getSenderRoleLabel(task.sourceSenderRole)}
                    </div>
                    <Link
                      className="mt-2 inline-flex text-xs font-medium text-teal-700 hover:text-teal-800"
                      href={task.approvedTaskId ? `/tasks/${task.approvedTaskId}` : `/projects/${task.projectId}`}
                    >
                      {task.approvedTaskId ? "查看正式待辦" : "查看案件待辦"}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {project ? (
                      <Link className="hover:text-teal-700" href={`/projects/${project.id}`}>
                        {project.name}
                      </Link>
                    ) : (
                      "未綁定"
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600">{typeLabel.get(task.taskType) ?? task.taskType}</td>
                  <td className="px-4 py-4 text-slate-600">{statusLabel.get(task.status) ?? task.status}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {task.dueDate ? formatDate(task.dueDate.toISOString().slice(0, 10)) : "未設定"}
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(task.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getSenderRoleLabel(role: LineSenderRole) {
  return {
    internal: "內部人員",
    client: "客戶",
    vendor: "廠商",
    unknown: "身份未登記"
  }[role];
}
