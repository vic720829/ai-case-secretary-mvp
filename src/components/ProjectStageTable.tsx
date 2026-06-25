import { Pencil, Trash2 } from "lucide-react";
import { formatDate, isDateOverdue } from "@/lib/date";
import type { ProjectStage } from "@/lib/types";
import { ProjectStageStatusBadge } from "./StatusBadges";

export function ProjectStageTable({
  stages,
  onEdit,
  onDelete
}: {
  stages: ProjectStage[];
  onEdit?: (stage: ProjectStage) => void;
  onDelete?: (stage: ProjectStage) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">排序</th>
              <th className="px-4 py-3">工期節點</th>
              <th className="px-4 py-3">開始日</th>
              <th className="px-4 py-3">結束日</th>
              <th className="px-4 py-3">提醒</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {stages.map((stage) => {
              const overdue = stage.status !== "done" && isDateOverdue(stage.endDate);

              return (
                <tr key={stage.id} className="hover:bg-stone-50">
                  <td className="px-4 py-4 text-slate-500">{stage.sortOrder}</td>
                  <td className="px-4 py-4 font-semibold text-slate-950">{stage.stageName}</td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(stage.startDate)}</td>
                  <td className="px-4 py-4">
                    <span className={overdue ? "font-semibold text-red-700" : "text-slate-600"}>
                      {formatDate(stage.endDate)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {stage.reminderDaysBefore > 0 ? `進場前 ${stage.reminderDaysBefore} 天` : "不提醒"}
                  </td>
                  <td className="px-4 py-4">
                    <ProjectStageStatusBadge status={stage.status} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      {onEdit ? (
                        <button
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                          type="button"
                          onClick={() => onEdit(stage)}
                          aria-label={`編輯 ${stage.stageName}`}
                          title="編輯"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {onDelete ? (
                        <button
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          type="button"
                          onClick={() => onDelete(stage)}
                          aria-label={`刪除 ${stage.stageName}`}
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
