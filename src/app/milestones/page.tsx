"use client";

import { AlertCircle, AlertTriangle, CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MilestoneTable } from "@/components/MilestoneTable";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { isDateDueSoon, isDateOverdue } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listMilestones, listProjects } from "@/lib/firestore";
import type { Milestone, Project } from "@/lib/types";

export default function MilestonesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setError("");

      try {
        const [nextProjects, nextMilestones] = await Promise.all([
          listProjects(),
          listMilestones()
        ]);
        setProjects(nextProjects);
        setMilestones(nextMilestones);
      } catch (caught) {
        setError(getReadableError(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const activeMilestones = useMemo(
    () => milestones.filter((milestone) => !milestone.completed),
    [milestones]
  );
  const upcomingMilestones = useMemo(
    () =>
      activeMilestones.filter(
        (milestone) => !isDateOverdue(milestone.dueDate) && isDateDueSoon(milestone.dueDate)
      ),
    [activeMilestones]
  );
  const overdueMilestones = useMemo(
    () => activeMilestones.filter((milestone) => isDateOverdue(milestone.dueDate)),
    [activeMilestones]
  );
  const highRiskMilestones = useMemo(
    () => activeMilestones.filter((milestone) => milestone.riskLevel === "high"),
    [activeMilestones]
  );

  if (loading) {
    return <LoadingState label="正在讀取關鍵節點" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="關鍵節點"
        description="集中查看各案件里程碑的即將到期、已逾期與高風險項目。"
      />

      <ErrorMessage message={error} />
      {error ? (
        <EmptyState
          title="關鍵節點讀取失敗"
          description="請確認 Firestore Rules 已允許登入者讀取 milestones collection。"
        />
      ) : null}

      {!error ? (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            title="即將到期"
            value={upcomingMilestones.length}
            tone="teal"
            icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
          <MetricCard
            title="已逾期"
            value={overdueMilestones.length}
            tone="amber"
            icon={<AlertCircle className="h-5 w-5" aria-hidden />}
          />
          <MetricCard
            title="高風險"
            value={highRiskMilestones.length}
            tone="red"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          />
        </div>
      ) : null}

      {!error ? (
        <>
          <MilestoneSection
            title="即將到期"
            milestones={upcomingMilestones}
            projects={projects}
            empty="未來 7 天內沒有即將到期的關鍵節點。"
          />
          <MilestoneSection
            title="已逾期"
            milestones={overdueMilestones}
            projects={projects}
            empty="目前沒有逾期的關鍵節點。"
          />
          <MilestoneSection
            title="高風險"
            milestones={highRiskMilestones}
            projects={projects}
            empty="目前沒有高風險關鍵節點。"
          />
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
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

function MilestoneSection({
  title,
  milestones,
  projects,
  empty
}: {
  title: string;
  milestones: Milestone[];
  projects: Project[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      {milestones.length ? (
        <MilestoneTable milestones={milestones} projects={projects} />
      ) : (
        <EmptyState title="沒有需要處理的關鍵節點" description={empty} />
      )}
    </section>
  );
}
