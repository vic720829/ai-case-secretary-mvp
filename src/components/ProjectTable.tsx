import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/date";
import type { Project } from "@/lib/types";
import { ProjectStatusBadge } from "./StatusBadges";

export function ProjectTable({
  projects,
  onDelete
}: {
  projects: Project[];
  onDelete?: (project: Project) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">階段</th>
              <th className="px-4 py-3">成員</th>
              <th className="px-4 py-3">預計完工</th>
              <th className="px-4 py-3">更新時間</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {projects.map((project) => (
              <tr key={project.id} className="hover:bg-stone-50">
                <td className="px-4 py-4">
                  <Link className="font-semibold text-slate-950 hover:text-teal-700" href={`/projects/${project.id}`}>
                    {project.name}
                  </Link>
                  <div className="mt-1 text-xs text-slate-500">{project.clientName}</div>
                </td>
                <td className="px-4 py-4">
                  <div className="font-medium text-slate-800">{project.currentStage}</div>
                  <div className="mt-1">
                    <ProjectStatusBadge status={project.status} />
                  </div>
                </td>
                <td className="px-4 py-4 text-slate-600">
                  <div>設計師：{project.designer || "未指派"}</div>
                  <div className="mt-1 text-xs">助理：{project.assistant || "未指派"}</div>
                </td>
                <td className="px-4 py-4 text-slate-600">{formatDate(project.expectedFinishDate)}</td>
                <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(project.updatedAt)}</td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <Link
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                      href={`/projects/${project.id}`}
                      aria-label={`編輯 ${project.name}`}
                      title="編輯"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Link>
                    {onDelete ? (
                      <button
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        type="button"
                        onClick={() => onDelete(project)}
                        aria-label={`刪除 ${project.name}`}
                        title="刪除"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
