"use client";

import { AlertCircle, AlertTriangle, Bot, BriefcaseBusiness, CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AiTaskTable } from "@/components/AiTaskTable";
import { PageHeader } from "@/components/PageHeader";
import { TaskTable } from "@/components/TaskTable";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink } from "@/components/Ui";
import { isTaskDueToday, isTaskOverdue, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listAiTasks, listMilestones, listProjectStages, listProjects, listTasks } from "@/lib/firestore";
import { getCurrentStage, getProjectProgress, getProjectRiskReasons } from "@/lib/progress";
import type { AiTask, Milestone, Project, ProjectStage, Task } from "@/lib/types";

type HighRiskProject = {
  project: Project;
  reasons: string[];
  currentStage: string;
  progress: number;
};

export default function RiskCenterPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiTasks, setAiTasks] = useState<AiTask[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextProjects, nextTasks, nextAiTasks, nextStages, nextMilestones] = await Promise.all([
          listProjects(),
          listTasks(),
          listAiTasks(),
          listProjectStages(),
          listMilestones()
        ]);
        setProjects(nextProjects);
        setTasks(nextTasks);
        setAiTasks(nextAiTasks);
        setStages(nextStages);
        setMilestones(nextMilestones);
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== "done"), [tasks]);
  const highRiskTasks = useMemo(
    () => activeTasks.filter((task) => task.riskLevel === "high"),
    [activeTasks]
  );
  const overdueTasks = useMemo(
    () => activeTasks.filter((task) => isTaskOverdue(task.dueDate, task.status)),
    [activeTasks]
  );
  const dueTodayTasks = useMemo(
    () => activeTasks.filter((task) => isTaskDueToday(task.dueDate, task.status)),
    [activeTasks]
  );
  const activeAiTasks = useMemo(() => aiTasks.filter((task) => task.status !== "done"), [aiTasks]);
  const highRiskAiTasks = useMemo(
    () => activeAiTasks.filter((task) => ["change", "payment", "invoice"].includes(task.taskType)),
    [activeAiTasks]
  );
  const overdueAiTasks = useMemo(
    () => activeAiTasks.filter((task) => task.dueDate && task.dueDate.toISOString().slice(0, 10) < todayInputValue()),
    [activeAiTasks]
  );

  const highRiskProjects = useMemo<HighRiskProject[]>(() => {
    return projects
      .map((project) => {
        const projectStages = stages.filter((stage) => stage.projectId === project.id);
        const projectMilestones = milestones.filter((milestone) => milestone.projectId === project.id);
        const reasons = getProjectRiskReasons(projectStages, projectMilestones);

        return {
          project,
          reasons,
          currentStage: getCurrentStage(project, projectStages),
          progress: getProjectProgress(projectStages)
        };
      })
      .filter((item) => item.reasons.length > 0);
  }, [milestones, projects, stages]);

  if (loading) {
    return <LoadingState label="正在整理今日風險" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="今日風險中心"
        description={`今天是 ${todayInputValue().replaceAll("-", "/")}。集中查看高風險案件、任務逾期與到期項目。`}
        action={
          <PrimaryLink href="/tasks/new">
            <Plus className="h-4 w-4" aria-hidden />
            新增任務
          </PrimaryLink>
        }
      />

      <ErrorMessage message={error} />
      {error ? (
        <EmptyState
          title="風險中心讀取失敗"
          description="請確認 Firestore Rules 已允許登入者讀取 projects、tasks、projectStages 與 milestones。"
        />
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-4">
          <RiskStatCard
            title="高風險案件"
            value={highRiskProjects.length}
            tone="red"
            icon={<BriefcaseBusiness className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="高風險任務"
            value={highRiskTasks.length}
            tone="red"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="已逾期任務"
            value={overdueTasks.length}
            tone="amber"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="今天到期任務"
            value={dueTodayTasks.length}
            tone="teal"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-3">
          <RiskStatCard
            title="AI 建立任務"
            value={activeAiTasks.length}
            tone="teal"
            icon={<Bot className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="AI 高風險任務"
            value={highRiskAiTasks.length}
            tone="red"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="AI 逾期任務"
            value={overdueAiTasks.length}
            tone="amber"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <>
          <HighRiskProjectSection projects={highRiskProjects} />
          <AiTaskSection title="AI 建立任務" aiTasks={activeAiTasks} projects={projects} empty="目前沒有 AI 建立的待辦任務。" />
          <AiTaskSection title="AI 高風險任務" aiTasks={highRiskAiTasks} projects={projects} empty="目前沒有 AI 高風險任務。" />
          <AiTaskSection title="AI 逾期任務" aiTasks={overdueAiTasks} projects={projects} empty="目前沒有 AI 逾期任務。" />
          <RiskSection title="高風險任務" tasks={highRiskTasks} projects={projects} empty="目前沒有高風險任務。" />
          <RiskSection title="已逾期任務" tasks={overdueTasks} projects={projects} empty="目前沒有逾期任務。" />
          <RiskSection title="今天到期任務" tasks={dueTodayTasks} projects={projects} empty="今天沒有到期任務。" />
        </>
      ) : null}
    </div>
  );
}

function AiTaskSection({
  title,
  aiTasks,
  projects,
  empty
}: {
  title: string;
  aiTasks: AiTask[];
  projects: Project[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      {aiTasks.length ? (
        <AiTaskTable aiTasks={aiTasks} projects={projects} />
      ) : (
        <EmptyState title="沒有需要處理的 AI 任務" description={empty} />
      )}
    </section>
  );
}

function RiskStatCard({
  title,
  value,
  icon,
  tone
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: "red" | "amber" | "teal";
}) {
  const toneClass = {
    red: "bg-red-50 text-red-700 ring-red-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    teal: "bg-teal-50 text-teal-700 ring-teal-100"
  }[tone];

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-md ring-1 ring-inset ${toneClass}`}>
          {icon}
        </div>
      </div>
    </section>
  );
}

function HighRiskProjectSection({ projects }: { projects: HighRiskProject[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">高風險案件</h2>
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-800" href="/projects">
          查看全部案件
        </Link>
      </div>

      {projects.length ? (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">案件</th>
                  <th className="px-4 py-3">目前階段</th>
                  <th className="px-4 py-3">完成百分比</th>
                  <th className="px-4 py-3">風險原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {projects.map((item) => (
                  <tr key={item.project.id} className="hover:bg-stone-50">
                    <td className="px-4 py-4">
                      <Link
                        className="font-semibold text-slate-950 hover:text-teal-700"
                        href={`/projects/${item.project.id}/progress`}
                      >
                        {item.project.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.project.clientName}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{item.currentStage}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-stone-100">
                          <div className="h-full rounded-full bg-teal-700" style={{ width: `${item.progress}%` }} />
                        </div>
                        <span className="text-slate-600">{item.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{item.reasons.join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="目前沒有高風險案件" description="逾期里程碑、逾期未完成工期節點與高風險標記會出現在這裡。" />
      )}
    </section>
  );
}

function RiskSection({
  title,
  tasks,
  projects,
  empty
}: {
  title: string;
  tasks: Task[];
  projects: Project[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-800" href="/tasks">
          查看全部任務
        </Link>
      </div>
      {tasks.length ? (
        <TaskTable tasks={tasks} projects={projects} />
      ) : (
        <EmptyState title="沒有需要處理的項目" description={empty} />
      )}
    </section>
  );
}
