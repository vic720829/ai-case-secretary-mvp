import type { ProjectStageStatus, RiskLevel, TaskSource, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; className: string }> = {
    todo: { label: "待辦", className: "bg-slate-100 text-slate-700 ring-slate-200" },
    doing: { label: "進行中", className: "bg-sky-50 text-sky-700 ring-sky-200" },
    done: { label: "完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
  };

  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

export function ProjectStageStatusBadge({ status }: { status: ProjectStageStatus }) {
  const map: Record<ProjectStageStatus, { label: string; className: string }> = {
    todo: { label: "未開始", className: "bg-slate-100 text-slate-700 ring-slate-200" },
    doing: { label: "進行中", className: "bg-sky-50 text-sky-700 ring-sky-200" },
    done: { label: "完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
  };

  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const map: Record<RiskLevel, { label: string; className: string }> = {
    low: { label: "低風險", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    medium: { label: "中風險", className: "bg-amber-50 text-amber-700 ring-amber-200" },
    high: { label: "高風險", className: "bg-red-50 text-red-700 ring-red-200" }
  };

  return <Badge className={map[risk].className}>{map[risk].label}</Badge>;
}

export function SourceBadge({ source }: { source: TaskSource }) {
  const map: Record<TaskSource, string> = {
    manual: "手動建立",
    line: "LINE 來源",
    ai: "AI 建立",
    voice: "語音建立"
  };

  return <Badge className="bg-stone-100 text-stone-700 ring-stone-200">{map[source]}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: string }) {
  return <Badge className="bg-teal-50 text-teal-800 ring-teal-200">{status || "未設定"}</Badge>;
}

export function CompletionBadge({ completed }: { completed: boolean }) {
  return completed ? (
    <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">已完成</Badge>
  ) : (
    <Badge className="bg-amber-50 text-amber-700 ring-amber-200">未完成</Badge>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        className
      )}
    >
      {children}
    </span>
  );
}
