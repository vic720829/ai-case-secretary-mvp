import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { formatDate, isDateOverdue } from "@/lib/date";
import type { Milestone, Project, ProjectStage } from "@/lib/types";
import { CompletionBadge, RiskBadge } from "./StatusBadges";

export function MilestoneTable({
  milestones,
  projects,
  stages = [],
  onEdit,
  onDelete
}: {
  milestones: Milestone[];
  projects: Project[];
  stages?: ProjectStage[];
  onEdit?: (milestone: Milestone) => void;
  onDelete?: (milestone: Milestone) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">關鍵節點</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">所屬工期</th>
              <th className="px-4 py-3">到期日</th>
              <th className="px-4 py-3">完成</th>
              <th className="px-4 py-3">風險</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {milestones.map((milestone) => {
              const project = projectById.get(milestone.projectId);
              const stage = milestone.stageId ? stageById.get(milestone.stageId) : null;
              const overdue = !milestone.completed && isDateOverdue(milestone.dueDate);

              return (
                <tr key={milestone.id} className="hover:bg-stone-50">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-950">{milestone.title}</div>
                    {milestone.description ? (
                      <div className="mt-1 line-clamp-2 max-w-sm text-xs leading-5 text-slate-500">
                        {milestone.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {project ? (
                      <Link className="hover:text-teal-700" href={`/projects/${project.id}/progress`}>
                        {project.name}
                      </Link>
                    ) : (
                      "未綁定"
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600">{stage?.stageName ?? "未掛工期"}</td>
                  <td className="px-4 py-4">
                    <span className={overdue ? "font-semibold text-red-700" : "text-slate-600"}>
                      {formatDate(milestone.dueDate)}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <CompletionBadge completed={milestone.completed} />
                  </td>
                  <td className="px-4 py-4">
                    <RiskBadge risk={milestone.riskLevel} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      {onEdit ? (
                        <button
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                          type="button"
                          onClick={() => onEdit(milestone)}
                          aria-label={`編輯 ${milestone.title}`}
                          title="編輯"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {onDelete ? (
                        <button
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          type="button"
                          onClick={() => onDelete(milestone)}
                          aria-label={`刪除 ${milestone.title}`}
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
