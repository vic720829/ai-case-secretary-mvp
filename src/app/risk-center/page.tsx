"use client";

import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarClock,
  Flag,
  MessageSquareWarning
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink } from "@/components/Ui";
import { formatDate, todayInputValue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  listMilestones,
  listProjectStages,
  listProjects,
  listReminderLogs
} from "@/lib/firestore";
import { getCurrentStage, getProjectProgress, getProjectRiskReasons } from "@/lib/progress";
import type { Milestone, Project, ProjectStage, ReminderLog } from "@/lib/types";

type HighRiskProject = {
  project: Project;
  reasons: string[];
  currentStage: string;
  progress: number;
};

export default function RiskCenterPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [reminders, setReminders] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextProjects, nextStages, nextMilestones, nextReminders] = await Promise.all([
          listProjects(),
          listProjectStages(),
          listMilestones(),
          listReminderLogs()
        ]);
        setProjects(nextProjects);
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
  const commitmentReminders = useMemo(
    () =>
      reminders.filter(
        (reminder) => reminder.status === "pending" && reminder.reminderType === "commitment_due"
      ),
    [reminders]
  );
  const overdueCommitments = useMemo(
    () => commitmentReminders.filter((reminder) => reminder.dueDate && reminder.dueDate < todayInputValue()),
    [commitmentReminders]
  );
  const currentCommitments = useMemo(
    () => commitmentReminders.filter((reminder) => !reminder.dueDate || reminder.dueDate >= todayInputValue()),
    [commitmentReminders]
  );
  const activeStageIds = useMemo(
    () => new Set(stages.filter((stage) => stage.status !== "done").map((stage) => stage.id)),
    [stages]
  );
  const stageReminders = useMemo(
    () =>
      reminders.filter(
        (reminder) =>
          reminder.status === "pending" &&
          reminder.reminderType === "stage_before_start" &&
          activeStageIds.has(reminder.sourceId)
      ),
    [activeStageIds, reminders]
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
        description={`今天是 ${todayInputValue().replaceAll("-", "/")}。集中查看客戶未回覆、承諾、工期與案件風險。`}
        action={
          <PrimaryLink href="/projects/new">
            <BriefcaseBusiness className="h-4 w-4" aria-hidden />
            建立案件
          </PrimaryLink>
        }
      />

      <ErrorMessage message={error} />
      {error ? (
        <EmptyState
          title="風險中心讀取失敗"
          description="請確認 Firestore Rules 已允許登入者讀取 projects、projectStages、milestones 與 reminder_logs。"
        />
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <RiskStatCard
            title="高/重大風險案件"
            value={highRiskProjects.length}
            tone="red"
            href="#high-risk-projects"
            actionLabel="查看案件"
            icon={<BriefcaseBusiness className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="客戶未回覆"
            value={customerUnansweredReminders.length}
            tone="red"
            href="#customer-unanswered"
            actionLabel="處理提醒"
            icon={<MessageSquareWarning className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="今日承諾提醒"
            value={currentCommitments.length}
            tone="teal"
            href="#current-commitments"
            actionLabel="查看承諾"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="逾期承諾"
            value={overdueCommitments.length}
            tone="red"
            href="#overdue-commitments"
            actionLabel="處理承諾"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="關鍵點預警"
            value={milestoneWarnings.length}
            tone="amber"
            href="#milestone-warnings"
            actionLabel="查看關鍵點"
            icon={<Flag className="h-5 w-5" aria-hidden />}
          />
          <RiskStatCard
            title="工程進場提醒"
            value={stageReminders.length}
            tone="amber"
            href="#stage-reminders"
            actionLabel="查看工程"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <>
          <HighRiskProjectSection projects={highRiskProjects} />
          <MilestoneWarningSection milestones={milestoneWarnings} projects={projects} />
          <CustomerUnansweredSection reminders={customerUnansweredReminders} projects={projects} />
          <ReminderSection
            id="current-commitments"
            title="今日承諾提醒"
            description="尚未完成，今天需要持續追蹤的客戶承諾"
            reminders={currentCommitments}
            projects={projects}
            empty="目前沒有需要追蹤的承諾"
          />
          <ReminderSection
            id="overdue-commitments"
            title="逾期承諾"
            description="承諾日期已過，但尚未確認完成"
            reminders={overdueCommitments}
            projects={projects}
            empty="目前沒有逾期承諾"
          />
          <ReminderSection
            id="stage-reminders"
            title="工程進場提醒"
            description="已進入提前提醒期間，且工程尚未確認完成"
            reminders={stageReminders}
            projects={projects}
            empty="目前沒有工程進場提醒"
          />
        </>
      ) : null}
    </div>
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
  href,
  actionLabel = "前往處理"
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: "red" | "amber" | "teal";
  href?: string;
  actionLabel?: string;
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
          {href ? <div className="mt-2 text-xs font-medium text-teal-700">{actionLabel}</div> : null}
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

function ReminderSection({
  id,
  title,
  description,
  reminders,
  projects,
  empty
}: {
  id: string;
  title: string;
  description: string;
  reminders: ReminderLog[];
  projects: Project[];
  empty: string;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title={title} description={description} />
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
                  <th className="px-4 py-3">提醒內容</th>
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
                        <div className="mt-1 text-xs text-slate-500">{reminder.sourceLabel || "提醒中心"}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                        {formatDate(reminder.dueDate)}
                      </td>
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
        <EmptyState title={empty} />
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
