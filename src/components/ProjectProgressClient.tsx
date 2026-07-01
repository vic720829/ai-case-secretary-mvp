"use client";

import { ArrowLeft, CalendarDays, FileDown, Flag, Gauge } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MilestoneForm } from "./MilestoneForm";
import { MilestoneTable } from "./MilestoneTable";
import { PageHeader } from "./PageHeader";
import { ProjectGanttChart } from "./ProjectGanttChart";
import { ProjectScheduleCalendar } from "./ProjectScheduleCalendar";
import { ProjectStageForm } from "./ProjectStageForm";
import { ProjectStageTable } from "./ProjectStageTable";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "./Ui";
import { getReadableError } from "@/lib/errors";
import {
  createMilestone,
  createProjectStage,
  deleteMilestone,
  deleteProjectStage,
  getProject,
  listMilestonesByProject,
  listProjectStagesByProject,
  updateMilestone,
  updateProjectStage
} from "@/lib/firestore";
import { getCurrentStage, getProjectProgress } from "@/lib/progress";
import type { Milestone, MilestoneInput, Project, ProjectStage, ProjectStageInput } from "@/lib/types";

export function ProjectProgressClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [editingStage, setEditingStage] = useState<ProjectStage | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextStages, nextMilestones] = await Promise.all([
        getProject(projectId),
        listProjectStagesByProject(projectId),
        listMilestonesByProject(projectId)
      ]);

      setProject(nextProject);
      setStages(nextStages);
      setMilestones(nextMilestones);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const progress = useMemo(() => getProjectProgress(stages), [stages]);
  const currentStage = useMemo(
    () => (project ? getCurrentStage(project, stages) : "未設定"),
    [project, stages]
  );

  async function handleCreateStage(value: ProjectStageInput) {
    await createProjectStage(value);
    await loadData();
  }

  async function handleUpdateStage(value: ProjectStageInput) {
    if (!editingStage) return;

    await updateProjectStage(editingStage.id, value);
    setEditingStage(null);
    await loadData();
  }

  async function handleDeleteStage(stage: ProjectStage) {
    const confirmed = window.confirm(`確定刪除工期節點「${stage.stageName}」？`);
    if (!confirmed) return;

    try {
      await deleteProjectStage(stage.id);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  async function handleCreateMilestone(value: MilestoneInput) {
    await createMilestone(value);
    await loadData();
  }

  async function handleUpdateMilestone(value: MilestoneInput) {
    if (!editingMilestone) return;

    await updateMilestone(editingMilestone.id, value);
    setEditingMilestone(null);
    await loadData();
  }

  async function handleDeleteMilestone(milestone: Milestone) {
    const confirmed = window.confirm(`確定刪除關鍵節點「${milestone.title}」？`);
    if (!confirmed) return;

    try {
      await deleteMilestone(milestone.id);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  function handleExportPdf() {
    if (!project) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("瀏覽器封鎖了 PDF 匯出視窗，請允許彈出式視窗後再試一次。");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildProgressPrintHtml({ project, stages, milestones, progress, currentStage }));
    printWindow.document.close();
    printWindow.focus();

    window.setTimeout(() => {
      printWindow.print();
    }, 300);
  }

  if (loading) {
    return <LoadingState label="正在讀取工程進度" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="這個案件可能已被刪除，請回到案件列表確認。"
        action={
          <SecondaryLink href="/projects">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件列表
          </SecondaryLink>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} 工程進度`}
        description={`${project.clientName} / 工期節點與關鍵里程碑管理`}
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <div className="flex justify-end">
        <Button type="button" onClick={handleExportPdf}>
          <FileDown className="h-4 w-4" aria-hidden />
          匯出 PDF
        </Button>
      </div>

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <ProgressCard
          title="目前階段"
          value={currentStage}
          icon={<Flag className="h-5 w-5" aria-hidden />}
        />
        <ProgressCard
          title="完成百分比"
          value={`${progress}%`}
          icon={<Gauge className="h-5 w-5" aria-hidden />}
        />
        <ProgressCard
          title="工期節點"
          value={`${stages.length} 個`}
          icon={<CalendarDays className="h-5 w-5" aria-hidden />}
        />
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">完成百分比</h2>
            <p className="mt-1 text-sm text-slate-600">依工期節點完成數自動計算。</p>
          </div>
          <div className="text-2xl font-semibold text-slate-950">{progress}%</div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full bg-teal-700" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <ProjectGanttChart
        project={project}
        stages={stages}
        milestones={milestones}
        onEditStage={setEditingStage}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">施工工期表</h2>
        <ProjectScheduleCalendar
          projectId={projectId}
          stages={stages}
          milestones={milestones}
          onCreateStage={handleCreateStage}
        />
      </section>

      {editingStage ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">編輯工期節點</h2>
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <ProjectStageForm
              projectId={projectId}
              initialValue={editingStage}
              submitLabel="儲存工期節點"
              onCancel={() => setEditingStage(null)}
              onSubmit={handleUpdateStage}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">所有工期節點</h2>
        {stages.length ? (
          <ProjectStageTable stages={stages} onEdit={setEditingStage} onDelete={handleDeleteStage} />
        ) : (
          <EmptyState title="尚未建立工期節點" description="先新增丈量、設計、報價、施工等節點來追蹤工程進度。" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">新增關鍵節點</h2>
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <MilestoneForm
            projectId={projectId}
            stages={stages}
            submitLabel="建立關鍵節點"
            onSubmit={handleCreateMilestone}
          />
        </div>
      </section>

      {editingMilestone ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">編輯關鍵節點</h2>
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <MilestoneForm
              projectId={projectId}
              stages={stages}
              initialValue={editingMilestone}
              submitLabel="儲存關鍵節點"
              onCancel={() => setEditingMilestone(null)}
              onSubmit={handleUpdateMilestone}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">關鍵節點</h2>
        {milestones.length ? (
          <MilestoneTable
            milestones={milestones}
            projects={[project]}
            stages={stages}
            onEdit={setEditingMilestone}
            onDelete={handleDeleteMilestone}
          />
        ) : (
          <EmptyState title="尚未建立關鍵節點" description="新增簽約、圖面確認、進場、驗收等里程碑來追蹤風險。" />
        )}
      </section>
    </div>
  );
}

function ProgressCard({
  title,
  value,
  icon
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-3 text-xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
          {icon}
        </div>
      </div>
    </section>
  );
}

function buildProgressPrintHtml({
  project,
  stages,
  milestones,
  progress,
  currentStage
}: {
  project: Project;
  stages: ProjectStage[];
  milestones: Milestone[];
  progress: number;
  currentStage: string;
}) {
  const datedStages = stages.filter((stage) => stage.startDate);
  const orderedStages = [...datedStages].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate)
  );
  const timeline = buildPrintTimeline(project, orderedStages, milestones);
  const totalDays = daysBetweenForPrint(timeline.startDate, timeline.endDate) + 1;
  const milestonesByStage = groupMilestonesForPrint(milestones);
  const unlinkedMilestones = milestones.filter((milestone) => !milestone.stageId);
  const generatedAt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
  const stageRows = orderedStages
    .map((stage) => buildStagePrintRow(stage, milestonesByStage.get(stage.id) ?? [], timeline, totalDays))
    .join("");
  const unlinkedRow = unlinkedMilestones.length
    ? buildUnlinkedMilestonePrintRow(unlinkedMilestones, timeline, totalDays)
    : "";
  const milestoneRows = [...milestones]
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"))
    .map(
      (milestone) => `
        <tr>
          <td>${escapeHtmlForPrint(milestone.title)}</td>
          <td>${escapeHtmlForPrint(formatDateForPrint(milestone.dueDate))}</td>
          <td>${escapeHtmlForPrint(milestone.completed ? "已完成" : "未完成")}</td>
          <td>${escapeHtmlForPrint(milestone.riskLevel)}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtmlForPrint(project.name)} 工程進度甘特圖</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #0f172a;
        background: #ffffff;
        font-family: "Microsoft JhengHei", "Noto Sans TC", Arial, sans-serif;
        line-height: 1.5;
      }
      .cover {
        border-bottom: 3px solid #0f766e;
        padding-bottom: 12px;
        margin-bottom: 16px;
      }
      .eyebrow {
        color: #0f766e;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 6px 0;
        font-size: 26px;
        line-height: 1.25;
      }
      h2 {
        margin: 18px 0 10px;
        color: #0f766e;
        font-size: 16px;
      }
      .meta {
        color: #64748b;
        font-size: 12px;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 16px;
      }
      .metric {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 12px;
      }
      .metric-label {
        color: #64748b;
        font-size: 11px;
      }
      .metric-value {
        margin-top: 4px;
        font-size: 18px;
        font-weight: 700;
      }
      .gantt {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        overflow: hidden;
      }
      .gantt-row {
        display: grid;
        grid-template-columns: 190px 1fr;
        min-height: 50px;
        border-top: 1px solid #e2e8f0;
      }
      .gantt-row:first-child {
        border-top: 0;
      }
      .stage-cell {
        border-right: 1px solid #e2e8f0;
        background: #f8fafc;
        padding: 9px 10px;
      }
      .stage-name {
        font-size: 12px;
        font-weight: 700;
      }
      .stage-date {
        color: #64748b;
        font-size: 10px;
        margin-top: 3px;
      }
      .timeline {
        position: relative;
        min-height: 50px;
        background: repeating-linear-gradient(
          to right,
          #ffffff 0,
          #ffffff 22px,
          #f8fafc 22px,
          #f8fafc 44px
        );
      }
      .bar {
        position: absolute;
        top: 17px;
        height: 18px;
        border-radius: 5px;
        background: #0f766e;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        line-height: 18px;
        padding: 0 8px;
        overflow: hidden;
        white-space: nowrap;
      }
      .bar.done { background: #059669; }
      .bar.todo { background: #64748b; }
      .bar.overdue { background: #dc2626; }
      .milestone {
        position: absolute;
        top: 11px;
        width: 10px;
        height: 10px;
        background: #f59e0b;
        transform: rotate(45deg);
        border: 1px solid #ffffff;
      }
      .milestone.high {
        background: #dc2626;
      }
      .timeline-labels {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        color: #64748b;
        font-size: 10px;
        margin: 6px 0 8px 190px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      th, td {
        border: 1px solid #e2e8f0;
        padding: 7px 8px;
        text-align: left;
      }
      th {
        background: #0f3f3a;
        color: #ffffff;
      }
      .empty {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 18px;
        color: #64748b;
        text-align: center;
      }
      .footer {
        margin-top: 18px;
        color: #94a3b8;
        font-size: 10px;
        text-align: right;
      }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <header class="cover">
      <div class="eyebrow">Project Schedule Report</div>
      <h1>${escapeHtmlForPrint(project.name)} 工程進度甘特圖</h1>
      <div class="meta">${escapeHtmlForPrint(project.clientName || "未填客戶")} · 產生時間：${escapeHtmlForPrint(generatedAt)}</div>
    </header>
    <section class="metrics">
      <div class="metric"><div class="metric-label">目前階段</div><div class="metric-value">${escapeHtmlForPrint(currentStage)}</div></div>
      <div class="metric"><div class="metric-label">完成百分比</div><div class="metric-value">${progress}%</div></div>
      <div class="metric"><div class="metric-label">工程節點</div><div class="metric-value">${stages.length} 個</div></div>
      <div class="metric"><div class="metric-label">預計完工</div><div class="metric-value">${escapeHtmlForPrint(formatDateForPrint(project.expectedFinishDate))}</div></div>
    </section>
    <h2>工程甘特圖</h2>
    ${
      orderedStages.length
        ? `
          <div class="timeline-labels">
            <span>${escapeHtmlForPrint(formatDateForPrint(timeline.startDate))}</span>
            <span></span>
            <span></span>
            <span style="text-align:right">${escapeHtmlForPrint(formatDateForPrint(timeline.endDate))}</span>
          </div>
          <div class="gantt">${stageRows}${unlinkedRow}</div>
        `
        : `<div class="empty">目前沒有可匯出的工程節點。</div>`
    }
    <h2>關鍵節點</h2>
    ${
      milestones.length
        ? `
          <table>
            <thead>
              <tr><th>節點</th><th>日期</th><th>完成</th><th>風險</th></tr>
            </thead>
            <tbody>${milestoneRows}</tbody>
          </table>
        `
        : `<div class="empty">目前沒有關鍵節點。</div>`
    }
    <footer class="footer">由 AI 案件秘書產生，請以實際合約、圖面與現場紀錄為準。</footer>
  </body>
</html>`;
}

function buildStagePrintRow(
  stage: ProjectStage,
  milestones: Milestone[],
  timeline: { startDate: string; endDate: string },
  totalDays: number
) {
  const startOffset = Math.max(0, daysBetweenForPrint(timeline.startDate, stage.startDate));
  const duration = Math.max(1, daysBetweenForPrint(stage.startDate, stage.endDate || stage.startDate) + 1);
  const left = percentageForPrint(startOffset, totalDays);
  const width = Math.max(3, percentageForPrint(duration, totalDays));
  const overdue = stage.status !== "done" && isPastDateForPrint(stage.endDate);
  const barClass = overdue ? "overdue" : stage.status === "done" ? "done" : stage.status === "todo" ? "todo" : "";
  const markers = milestones.map((milestone) => buildMilestoneMarkerForPrint(milestone, timeline, totalDays)).join("");

  return `
    <div class="gantt-row">
      <div class="stage-cell">
        <div class="stage-name">${escapeHtmlForPrint(stage.stageName)}</div>
        <div class="stage-date">${escapeHtmlForPrint(formatDateForPrint(stage.startDate))} - ${escapeHtmlForPrint(formatDateForPrint(stage.endDate))}</div>
      </div>
      <div class="timeline">
        <div class="bar ${barClass}" style="left:${left}%; width:${width}%">${escapeHtmlForPrint(stage.stageName)}</div>
        ${markers}
      </div>
    </div>
  `;
}

function buildUnlinkedMilestonePrintRow(
  milestones: Milestone[],
  timeline: { startDate: string; endDate: string },
  totalDays: number
) {
  const markers = milestones.map((milestone) => buildMilestoneMarkerForPrint(milestone, timeline, totalDays)).join("");

  return `
    <div class="gantt-row">
      <div class="stage-cell">
        <div class="stage-name">未綁定工程的關鍵節點</div>
        <div class="stage-date">${milestones.length} 筆</div>
      </div>
      <div class="timeline">${markers}</div>
    </div>
  `;
}

function buildMilestoneMarkerForPrint(
  milestone: Milestone,
  timeline: { startDate: string; endDate: string },
  totalDays: number
) {
  if (!milestone.dueDate) return "";
  if (milestone.dueDate < timeline.startDate || milestone.dueDate > timeline.endDate) return "";

  const offset = daysBetweenForPrint(timeline.startDate, milestone.dueDate);
  const left = percentageForPrint(offset, totalDays);
  const highRisk = milestone.riskLevel === "high" || milestone.riskLevel === "critical" || (!milestone.completed && isPastDateForPrint(milestone.dueDate));

  return `<span class="milestone ${highRisk ? "high" : ""}" style="left:${left}%;" title="${escapeHtmlForPrint(milestone.title)}"></span>`;
}

function buildPrintTimeline(project: Project, stages: ProjectStage[], milestones: Milestone[]) {
  const dates = [
    ...stages.flatMap((stage) => [stage.startDate, stage.endDate || stage.startDate]),
    ...milestones.map((milestone) => milestone.dueDate),
    project.expectedFinishDate
  ].filter(Boolean);
  const sortedDates = dates.sort((a, b) => a.localeCompare(b));
  const firstDate = sortedDates[0] ?? toPrintDateInput(new Date());
  const lastDate = sortedDates[sortedDates.length - 1] ?? firstDate;

  return {
    startDate: toPrintDateInput(addDaysForPrint(parsePrintDate(firstDate), -3)),
    endDate: toPrintDateInput(addDaysForPrint(parsePrintDate(lastDate), 7))
  };
}

function groupMilestonesForPrint(milestones: Milestone[]) {
  const groups = new Map<string, Milestone[]>();

  milestones.forEach((milestone) => {
    if (!milestone.stageId) return;
    const nextMilestones = groups.get(milestone.stageId) ?? [];
    nextMilestones.push(milestone);
    groups.set(milestone.stageId, nextMilestones);
  });

  return groups;
}

function percentageForPrint(value: number, total: number) {
  if (total <= 0) return 0;
  return Number(((value / total) * 100).toFixed(3));
}

function isPastDateForPrint(date: string) {
  if (!date) return false;
  return date < toPrintDateInput(new Date());
}

function daysBetweenForPrint(startDate: string, endDate: string) {
  const start = parsePrintDate(startDate).getTime();
  const end = parsePrintDate(endDate).getTime();
  return Math.round((end - start) / 86_400_000);
}

function parsePrintDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDaysForPrint(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + days);
  return nextDate;
}

function toPrintDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateForPrint(value: string) {
  if (!value) return "未設定";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}/${month}/${day}`;
}

function escapeHtmlForPrint(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
