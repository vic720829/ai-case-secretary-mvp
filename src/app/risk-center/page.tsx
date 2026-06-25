"use client";

import { AlertCircle, AlertTriangle, Bot, BriefcaseBusiness, CalendarClock, Flag, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TaskTable } from "@/components/TaskTable";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink } from "@/components/Ui";
import { formatDate, isTaskDueToday, isTaskOverdue, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listMilestones, listProjectStages, listProjects, listTasks } from "@/lib/firestore";
import { getCurrentStage, getProjectProgress, getProjectRiskReasons } from "@/lib/progress";
import type { Milestone, Project, ProjectStage, Task } from "@/lib/types";

type HighRiskProject = {
  project: Project;
  reasons: string[];
  currentStage: string;
  progress: number;
};

export default function RiskCenterPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextProjects, nextTasks, nextStages, nextMilestones] = await Promise.all([
          listProjects(),
          listTasks(),
          listProjectStages(),
          listMilestones()
        ]);
        setProjects(nextProjects);
        setTasks(nextTasks);
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
  const aiSourceTasks = useMemo(() => activeTasks.filter((task) => task.source === "ai"), [activeTasks]);
  const highRiskAiTasks = useMemo(
    () => aiSourceTasks.filter((task) => task.riskLevel === "high"),
    [aiSourceTasks]
  );
  const overdueAiTasks = useMemo(
    () => aiSourceTasks.filter((task) => isTaskOverdue(task.dueDate, task.status)),
    [aiSourceTasks]
  );
  const milestoneWarnings = useMemo(
    () =>
      milestones
        .filter((milestone) => {
          if (milestone.completed || !milestone.dueDate || milestone.reminderDaysBefore <= 0) return false;
          return getMilestoneReminderDate(milestone.dueDate, milestone.reminderDaysBefore) === todayInputValue();
        })
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "zh-TW")),
    [milestones]
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
        description={`今天是 ${todayInputValue().replaceAll("-", "/")}。集中查看高風險案件、待辦逾期與到期項目。`}
        action={
          <PrimaryLink href="/tasks/new">
            <Plus className="h-4 w-4" aria-hidden />
            新增待辦
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
        <div className="grid gap-4 md:grid-cols-5">
          <RiskStatCard
            title="高風險案件"
            value={highRiskProjects.length}
            tone="red"
            icon={<BriefcaseBusiness className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="高風險待辦"
            value={highRiskTasks.length}
            tone="red"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="已逾期待辦"
            value={overdueTasks.length}
            tone="amber"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="今天到期待辦"
            value={dueTodayTasks.length}
            tone="teal"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="關鍵點預警"
            value={milestoneWarnings.length}
            tone="amber"
            icon={<Flag className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-3">
          <RiskStatCard
            title="AI 來源待辦"
            value={aiSourceTasks.length}
            tone="teal"
            icon={<Bot className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="AI 來源高風險待辦"
            value={highRiskAiTasks.length}
            tone="red"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="AI 來源逾期待辦"
            value={overdueAiTasks.length}
            tone="amber"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <>
          <HighRiskProjectSection projects={highRiskProjects} />
          <MilestoneWarningSection milestones={milestoneWarnings} projects={projects} />
          <RiskSection title="AI 來源待辦" tasks={aiSourceTasks} projects={projects} empty="目前沒有 AI 建立的正式待辦。" />
          <RiskSection title="AI 來源高風險待辦" tasks={highRiskAiTasks} projects={projects} empty="目前沒有 AI 來源高風險待辦。" />
          <RiskSection title="AI 來源逾期待辦" tasks={overdueAiTasks} projects={projects} empty="目前沒有 AI 來源逾期待辦。" />
          <RiskSection title="高風險待辦" tasks={highRiskTasks} projects={projects} empty="目前沒有高風險待辦。" />
          <RiskSection title="已逾期待辦" tasks={overdueTasks} projects={projects} empty="目前沒有逾期待辦。" />
          <RiskSection title="今天到期待辦" tasks={dueTodayTasks} projects={projects} empty="今天沒有到期待辦。" />
        </>
      ) : null}
    </div>
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

function MilestoneWarningSection({
  milestones,
  projects
}: {
  milestones: Milestone[];
  projects: Project[];
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">關鍵點預警</h2>
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-800" href="/milestones">
          查看全部關鍵點
        </Link>
      </div>

      {milestones.length ? (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">案件</th>
                  <th className="px-4 py-3">關鍵點</th>
                  <th className="px-4 py-3">到期日</th>
                  <th className="px-4 py-3">提醒</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {milestones.map((milestone) => {
                  const project = projectById.get(milestone.projectId);

                  return (
                    <tr key={milestone.id} className="hover:bg-stone-50">
                      <td className="px-4 py-4">
                        {project ? (
                          <Link
                            className="font-semibold text-slate-950 hover:text-teal-700"
                            href={`/projects/${project.id}/progress`}
                          >
                            {project.name}
                          </Link>
                        ) : (
                          <span className="text-slate-500">未綁定案件</span>
                        )}
                        <div className="mt-1 text-xs text-slate-500">{project?.clientName ?? ""}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">{milestone.title}</div>
                        {milestone.description ? (
                          <div className="mt-1 line-clamp-2 max-w-md text-xs leading-5 text-slate-500">
                            {milestone.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDate(milestone.dueDate)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-amber-700">
                        到期前 {milestone.reminderDaysBefore} 天
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          title="今天沒有關鍵點預警"
          description="關鍵節點的到期日扣掉提前提醒天數等於今天時，會出現在這裡。"
        />
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
          查看全部待辦
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

function getMilestoneReminderDate(dueDate: string, daysBefore: number) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const reminderDate = new Date(year, (month || 1) - 1, day || 1);
  reminderDate.setDate(reminderDate.getDate() - daysBefore);

  const reminderYear = reminderDate.getFullYear();
  const reminderMonth = String(reminderDate.getMonth() + 1).padStart(2, "0");
  const reminderDay = String(reminderDate.getDate()).padStart(2, "0");

  return `${reminderYear}-${reminderMonth}-${reminderDay}`;
}
