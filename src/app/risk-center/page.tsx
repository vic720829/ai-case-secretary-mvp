"use client";

import {
  AlertCircle,
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Flag,
  MessageSquareWarning,
  Plus
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { TaskTable } from "@/components/TaskTable";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink, SecondaryLink } from "@/components/Ui";
import { formatDate, formatDateTime, isTaskDueToday, isTaskOverdue, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  createProjectMemoFromTask,
  listAiTasks,
  listMilestones,
  listProjectStages,
  listProjects,
  listReminderLogs,
  listTasks
} from "@/lib/firestore";
import { getCurrentStage, getProjectProgress, getProjectRiskReasons } from "@/lib/progress";
import { getAiTaskRiskLevel, isHighOrCriticalRisk } from "@/lib/riskRules";
import type { AiTask, Milestone, Project, ProjectStage, ReminderLog, Task } from "@/lib/types";

type HighRiskProject = {
  project: Project;
  reasons: string[];
  currentStage: string;
  progress: number;
};

export default function RiskCenterPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiTasks, setAiTasks] = useState<AiTask[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [reminders, setReminders] = useState<ReminderLog[]>([]);
  const [memoTaskIds, setMemoTaskIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memoMessage, setMemoMessage] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextProjects, nextTasks, nextAiTasks, nextStages, nextMilestones, nextReminders] =
          await Promise.all([
            listProjects(),
            listTasks(),
            listAiTasks(),
            listProjectStages(),
            listMilestones(),
            listReminderLogs()
          ]);
        setProjects(nextProjects);
        setTasks(nextTasks);
        setAiTasks(nextAiTasks);
        setStages(nextStages);
        setMilestones(nextMilestones);
        setReminders(nextReminders);
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  async function handleAddTaskMemo(task: Task) {
    setError("");
    setMemoMessage("");

    try {
      await createProjectMemoFromTask(task, user?.displayName || user?.email || "");
      setMemoTaskIds((current) => new Set(current).add(task.id));
      setMemoMessage(`已加入案件備忘錄：${task.title}`);
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== "done"), [tasks]);
  const highRiskTasks = useMemo(
    () => activeTasks.filter((task) => isHighOrCriticalRisk(task.riskLevel)),
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
  const upcomingTasks = useMemo(
    () =>
      activeTasks
        .filter((task) => isTaskDueSoon(task.dueDate, 3))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "zh-TW")),
    [activeTasks]
  );
  const pendingAiDrafts = useMemo(() => aiTasks.filter((task) => task.reviewStatus === "pending"), [aiTasks]);
  const staleAiDrafts = useMemo(
    () => pendingAiDrafts.filter((task) => isOlderThanMinutes(task.createdAt, 30)),
    [pendingAiDrafts]
  );
  const maybeAnsweredAiDrafts = useMemo(
    () => pendingAiDrafts.filter((task) => task.resolutionStatus === "maybe_answered"),
    [pendingAiDrafts]
  );
  const highRiskPendingAiDrafts = useMemo(
    () => pendingAiDrafts.filter(isHighRiskAiDraft),
    [pendingAiDrafts]
  );
  const aiPendingRisks = useMemo(
    () =>
      uniqueAiTasks([...staleAiDrafts, ...highRiskPendingAiDrafts, ...maybeAnsweredAiDrafts]).sort(
        compareAiDraftRisk
      ),
    [highRiskPendingAiDrafts, maybeAnsweredAiDrafts, staleAiDrafts]
  );
  const customerUnansweredReminders = useMemo(
    () =>
      reminders.filter(
        (reminder) =>
          reminder.status === "pending" &&
          (reminder.reminderType === "customer_message_unanswered" ||
            reminder.reminderType === "customer_followup_unanswered")
      ),
    [reminders]
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
          <>
            <SecondaryLink href="/projects/new">
              <BriefcaseBusiness className="h-4 w-4" aria-hidden />
              建立案件
            </SecondaryLink>
            <PrimaryLink href="/tasks/new">
              <Plus className="h-4 w-4" aria-hidden />
              建立待辦
            </PrimaryLink>
          </>
        }
      />

      <ErrorMessage message={error} />
      {memoMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {memoMessage}
        </div>
      ) : null}
      {error ? (
        <EmptyState
          title="風險中心讀取失敗"
          description="請確認 Firestore Rules 已允許登入者讀取 projects、tasks、projectStages 與 milestones。"
        />
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <RiskStatCard
            title="高/重大風險案件"
            value={highRiskProjects.length}
            tone="red"
            href="#high-risk-projects"
            icon={<BriefcaseBusiness className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="高/重大風險待辦"
            value={highRiskTasks.length}
            tone="red"
            href="#high-risk-tasks"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="已逾期待辦"
            value={overdueTasks.length}
            tone="amber"
            href="#overdue-tasks"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="今天到期待辦"
            value={dueTodayTasks.length}
            tone="teal"
            href="#due-today-tasks"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="近期待辦"
            value={upcomingTasks.length}
            tone="teal"
            href="#upcoming-tasks"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="關鍵點預警"
            value={milestoneWarnings.length}
            tone="amber"
            href="#milestone-warnings"
            icon={<Flag className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <RiskStatCard
            title="客戶未回覆"
            value={customerUnansweredReminders.length}
            tone="red"
            href="#customer-unanswered"
            icon={<MessageSquareWarning className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="待審草稿"
            value={pendingAiDrafts.length}
            tone="amber"
            href="/ai-tasks"
            icon={<Bot className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="超過 30 分鐘未審核"
            value={staleAiDrafts.length}
            tone="red"
            href="#ai-review-risks"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="可能已回覆未確認"
            value={maybeAnsweredAiDrafts.length}
            tone="teal"
            href="#ai-review-risks"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <>
          <HighRiskProjectSection projects={highRiskProjects} />
          <MilestoneWarningSection milestones={milestoneWarnings} projects={projects} />
          <CustomerUnansweredSection reminders={customerUnansweredReminders} projects={projects} />
          <AiPendingRiskSection aiTasks={aiPendingRisks} projects={projects} />
          <RiskSection
            id="high-risk-tasks"
            title="高/重大風險待辦"
            description="未完成且風險等級為高或重大"
            tasks={highRiskTasks}
            projects={projects}
            memoTaskIds={memoTaskIds}
            onAddMemo={handleAddTaskMemo}
            empty="目前沒有高風險待辦。"
          />
          <RiskSection
            id="overdue-tasks"
            title="已逾期待辦"
            description="未完成且截止日已過"
            tasks={overdueTasks}
            projects={projects}
            memoTaskIds={memoTaskIds}
            onAddMemo={handleAddTaskMemo}
            empty="目前沒有逾期待辦。"
          />
          <RiskSection
            id="due-today-tasks"
            title="今天到期待辦"
            description="未完成且截止日是今天"
            tasks={dueTodayTasks}
            projects={projects}
            memoTaskIds={memoTaskIds}
            onAddMemo={handleAddTaskMemo}
            empty="今天沒有到期待辦。"
          />
          <RiskSection
            id="upcoming-tasks"
            title="近期待辦"
            description="未完成且截止日在未來 3 天內"
            tasks={upcomingTasks}
            projects={projects}
            memoTaskIds={memoTaskIds}
            onAddMemo={handleAddTaskMemo}
            empty="未來 3 天內沒有待辦。"
          />
        </>
      ) : null}
    </div>
  );
}

function AiPendingRiskSection({
  aiTasks,
  projects
}: {
  aiTasks: AiTask[];
  projects: Project[];
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return (
    <section id="ai-review-risks" className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle
          title="待審與未確認事項"
          description="超過 30 分鐘未審核、可能已回覆未確認或高風險待審"
        />
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-800" href="/ai-tasks">
          前往審核
        </Link>
      </div>

      {aiTasks.length ? (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">AI 草稿</th>
                  <th className="px-4 py-3">案件</th>
                  <th className="px-4 py-3">風險原因</th>
                  <th className="px-4 py-3">建立時間</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {aiTasks.map((task) => {
                  const project = projectById.get(task.projectId);
                  const labels = getAiDraftRiskLabels(task);

                  return (
                    <tr key={task.id} className="hover:bg-stone-50">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">{task.title}</div>
                        {task.description ? (
                          <div className="mt-1 line-clamp-2 max-w-md text-xs leading-5 text-slate-500">
                            {task.description}
                          </div>
                        ) : null}
                        <div className="mt-2 text-xs text-slate-500">
                          {task.sourceSenderName || "未知來源"}
                        </div>
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
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {labels.map((label) => (
                            <span
                              key={label}
                              className="inline-flex min-h-6 items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {formatDateTime(task.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          className="inline-flex min-h-9 items-center rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100"
                          href="/ai-tasks"
                        >
                          去審核
                        </Link>
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
          title="目前沒有待審與未確認事項"
        />
      )}
    </section>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function RiskStatCard({
  title,
  value,
  icon,
  tone,
  href
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: "red" | "amber" | "teal";
  href?: string;
}) {
  const toneClass = {
    red: "bg-red-50 text-red-700 ring-red-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    teal: "bg-teal-50 text-teal-700 ring-teal-100"
  }[tone];

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
          {href ? <div className="mt-2 text-xs font-medium text-teal-700">查看項目</div> : null}
        </div>
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-md ring-1 ring-inset transition group-hover:scale-105 ${toneClass}`}
        >
          {icon}
        </div>
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        className="group block rounded-lg border border-stone-200 bg-white p-5 shadow-panel transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
        href={href}
      >
        {content}
      </Link>
    );
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      {content}
    </section>
  );
}

function HighRiskProjectSection({ projects }: { projects: HighRiskProject[] }) {
  return (
    <section id="high-risk-projects" className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title="高/重大風險案件" description="有逾期工期、逾期關鍵點或高/重大風險關鍵點" />
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
        <EmptyState title="目前沒有高風險案件" />
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
    <section id="milestone-warnings" className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title="關鍵點預警" description="到期日扣掉提前提醒天數等於今天" />
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
        />
      )}
    </section>
  );
}

function CustomerUnansweredSection({
  reminders,
  projects
}: {
  reminders: ReminderLog[];
  projects: Project[];
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return (
    <section id="customer-unanswered" className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title="客戶未回覆" description="提醒中心仍待處理的客戶訊息或客戶待追蹤事項" />
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-800" href="/reminders">
          前往提醒中心
        </Link>
      </div>

      {reminders.length ? (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">案件</th>
                  <th className="px-4 py-3">提醒</th>
                  <th className="px-4 py-3">來源</th>
                  <th className="px-4 py-3">日期</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {reminders.map((reminder) => {
                  const project = projectById.get(reminder.projectId);

                  return (
                    <tr key={reminder.id} className="hover:bg-stone-50">
                      <td className="px-4 py-4">
                        {project ? (
                          <Link
                            className="font-semibold text-slate-950 hover:text-teal-700"
                            href={`/projects/${project.id}`}
                          >
                            {project.name}
                          </Link>
                        ) : (
                          <span className="text-slate-500">未綁定案件</span>
                        )}
                        <div className="mt-1 text-xs text-slate-500">{project?.clientName ?? ""}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">{reminder.title}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {reminder.reminderType === "customer_message_unanswered"
                            ? "客戶訊息尚未確認已回覆"
                            : "客戶待追蹤事項尚未確認"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{reminder.sourceLabel || "提醒中心"}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDate(reminder.dueDate)}</td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          className="inline-flex min-h-9 items-center rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100"
                          href="/reminders"
                        >
                          處理提醒
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="目前沒有客戶未回覆提醒" />
      )}
    </section>
  );
}

function RiskSection({
  id,
  title,
  description,
  tasks,
  projects,
  memoTaskIds,
  onAddMemo,
  empty
}: {
  id: string;
  title: string;
  description: string;
  tasks: Task[];
  projects: Project[];
  memoTaskIds: Set<string>;
  onAddMemo: (task: Task) => void | Promise<void>;
  empty: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title={title} description={description} />
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-800" href="/tasks">
          查看全部待辦
        </Link>
      </div>
      {tasks.length ? (
        <TaskTable tasks={tasks} projects={projects} memoTaskIds={memoTaskIds} onAddMemo={onAddMemo} />
      ) : (
        <EmptyState title={empty} />
      )}
    </section>
  );
}

function isOlderThanMinutes(date: Date | null, minutes: number) {
  if (!date) return false;

  return Date.now() - date.getTime() >= minutes * 60 * 1000;
}

function isTaskDueSoon(dueDate: string, daysAhead: number) {
  if (!dueDate) return false;

  const today = todayInputValue();
  if (dueDate <= today) return false;

  return dueDate <= addDays(today, daysAhead);
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(year, (month || 1) - 1, day || 1);
  target.setDate(target.getDate() + days);

  const targetYear = target.getFullYear();
  const targetMonth = String(target.getMonth() + 1).padStart(2, "0");
  const targetDay = String(target.getDate()).padStart(2, "0");

  return `${targetYear}-${targetMonth}-${targetDay}`;
}

function isHighRiskAiDraft(task: AiTask) {
  return isHighOrCriticalRisk(getAiTaskRiskLevel(task.taskType, task.title));
}

function uniqueAiTasks(tasks: AiTask[]) {
  return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
}

function compareAiDraftRisk(a: AiTask, b: AiTask) {
  const scoreDiff = getAiDraftRiskScore(b) - getAiDraftRiskScore(a);
  if (scoreDiff !== 0) return scoreDiff;

  return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
}

function getAiDraftRiskScore(task: AiTask) {
  if (isOlderThanMinutes(task.createdAt, 180)) return 100;
  if (isOlderThanMinutes(task.createdAt, 30)) return 80;
  if (isHighRiskAiDraft(task)) return 60;
  if (task.resolutionStatus === "maybe_answered") return 40;

  return 0;
}

function getAiDraftRiskLabels(task: AiTask) {
  const labels: string[] = [];

  if (isOlderThanMinutes(task.createdAt, 180)) {
    labels.push("超過 3 小時未審核");
  } else if (isOlderThanMinutes(task.createdAt, 30)) {
    labels.push("超過 30 分鐘未審核");
  }

  if (isHighRiskAiDraft(task)) {
    labels.push("高風險待審");
  }

  if (task.resolutionStatus === "maybe_answered") {
    labels.push("可能已回覆未確認");
  }

  return labels.length ? labels : ["待審核"];
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
