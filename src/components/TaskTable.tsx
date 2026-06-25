import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { formatDate, formatDateTime, isTaskOverdue } from "@/lib/date";
import type { Project, Task } from "@/lib/types";
import { RiskBadge, SourceBadge, TaskStatusBadge } from "./StatusBadges";

export function TaskTable({
  tasks,
  projects,
  onDelete
}: {
  tasks: Task[];
  projects: Project[];
  onDelete?: (task: Task) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">待辦</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">負責人</th>
              <th className="px-4 py-3">截止日</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">風險</th>
              <th className="px-4 py-3">來源</th>
              <th className="px-4 py-3">更新時間</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {tasks.map((task) => {
              const project = task.projectId ? projectById.get(task.projectId) : null;
              const overdue = isTaskOverdue(task.dueDate, task.status);

              return (
                <tr key={task.id} className="hover:bg-stone-50">
                  <td className="px-4 py-4">
                    <Link className="font-semibold text-slate-950 hover:text-teal-700" href={`/tasks/${task.id}`}>
                      {task.title}
                    </Link>
                    {task.description ? (
                      <div className="mt-1 line-clamp-2 max-w-sm text-xs leading-5 text-slate-500">
                        {task.description}
                      </div>
                    ) : null}
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
                  <td className="px-4 py-4 text-slate-600">{task.assignee || "未指派"}</td>
                  <td className="px-4 py-4">
                    <span className={overdue ? "font-semibold text-red-700" : "text-slate-600"}>
                      {formatDate(task.dueDate)}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <TaskStatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-4">
                    <RiskBadge risk={task.riskLevel} />
                  </td>
                  <td className="px-4 py-4">
                    <SourceBadge source={task.source} />
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(task.updatedAt)}</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <Link
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                        href={`/tasks/${task.id}`}
                        aria-label={`編輯 ${task.title}`}
                        title="編輯"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Link>
                      {onDelete ? (
                        <button
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          type="button"
                          onClick={() => onDelete(task)}
                          aria-label={`刪除 ${task.title}`}
                          title="刪除"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
