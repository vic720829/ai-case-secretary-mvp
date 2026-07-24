"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Banknote,
  BookOpenCheck,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  GripVertical,
  Landmark,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  Upload,
  WalletCards,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { toAuditActor } from "@/lib/audit";
import { getReadableError } from "@/lib/errors";
import {
  approveFinanceDraft,
  clearFinanceData,
  deleteFinanceAccount,
  deleteFinanceAdjustment,
  deleteFinanceCost,
  deleteFinanceLedger,
  deleteFinancePayment,
  ensureDefaultFinanceAccount,
  ignoreFinanceDraft,
  importFinanceBackup,
  listFinanceData,
  reorderFinanceAccounts,
  saveFinanceAccount,
  saveFinanceAdjustment,
  saveFinanceCost,
  saveFinanceContract,
  saveFinanceLedger,
  saveFinancePayment,
} from "@/lib/finance";
import {
  buildFinanceAccountEntries,
  financeRecordBelongsToContract,
  financeAccountBalance,
  paymentReceivedAmount,
  primaryFinanceContract,
  projectFinanceContracts,
  projectFinanceTotals,
  projectFinanceTotalsForContracts,
  type FinanceAccountEntry
} from "@/lib/financeCalculations";
import { listProjects } from "@/lib/firestore";
import type {
  FinanceAccount,
  FinanceAdjustment,
  FinanceCost,
  FinanceData,
  FinanceDraft,
  FinanceLedger,
  FinancePayment,
  FinanceProjectSettings,
  Project
} from "@/lib/types";
import { cn } from "@/lib/utils";

type FinanceView = "dashboard" | "drafts" | "projects" | "accounts" | "reconcile" | "data";
type ProjectTab = "payments" | "adjustments" | "costs";
type ModalState =
  | {
      kind: "contract";
      project: Project;
      settings?: FinanceProjectSettings;
      isPrimary: boolean;
      sortOrder: number;
    }
  | { kind: "payment"; projectId: string; contractId: string; item?: FinancePayment }
  | { kind: "adjustment"; projectId: string; contractId: string; item?: FinanceAdjustment }
  | { kind: "cost"; projectId: string; contractId: string; item?: FinanceCost }
  | { kind: "account"; item?: FinanceAccount }
  | { kind: "ledger"; item?: FinanceLedger; preset?: Partial<FinanceLedger> }
  | null;

const emptyFinanceData: FinanceData = {
  projectSettings: [],
  accounts: [],
  payments: [],
  adjustments: [],
  costs: [],
  ledger: [],
  drafts: []
};

const financeViews: Array<{ key: FinanceView; label: string; icon: typeof WalletCards }> = [
  { key: "dashboard", label: "總覽", icon: WalletCards },
  { key: "drafts", label: "待確認入帳", icon: BookOpenCheck },
  { key: "projects", label: "案件", icon: Building2 },
  { key: "accounts", label: "公司存簿", icon: Landmark },
  { key: "reconcile", label: "銀行對帳", icon: FileSpreadsheet },
  { key: "data", label: "資料", icon: Download }
];

export function FinanceClient() {
  const { profile, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<FinanceData>(emptyFinanceData);
  const [view, setView] = useState<FinanceView>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedContractId, setSelectedContractId] = useState("all");
  const [projectTab, setProjectTab] = useState<ProjectTab>("payments");
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const actor = toAuditActor(user);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);

    try {
      const [nextProjects, initialData] = await Promise.all([listProjects(), listFinanceData()]);
      if (!initialData.accounts.some((item) => item.defaultForIncome)) {
        await ensureDefaultFinanceAccount(toAuditActor(user));
      }
      const nextData = initialData.accounts.some((item) => item.defaultForIncome)
        ? initialData
        : await listFinanceData();

      setProjects(nextProjects);
      setData(nextData);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const contractsByProject = useMemo(() => {
    const grouped = new Map<string, FinanceProjectSettings[]>();
    projects.forEach((project) => {
      grouped.set(project.id, projectFinanceContracts(data.projectSettings, project.id));
    });
    return grouped;
  }, [data.projectSettings, projects]);
  const projectsById = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const accountsById = useMemo(() => new Map(data.accounts.map((item) => [item.id, item])), [data.accounts]);
  const accountEntries = useMemo(() => buildFinanceAccountEntries(data), [data]);
  const pendingDrafts = useMemo(
    () => data.drafts.filter((item) => item.status === "pending"),
    [data.drafts]
  );
  const selectedProject = projectsById.get(selectedProjectId);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedContractId("all");
    setProjectTab("payments");
    setView("projects");
  }

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await action();
      await load();
      setModal(null);
      setNotice(successMessage);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !projects.length) {
    return <LoadingState label="正在讀取財務資料" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="財務管理"
        description="案件、收付款、追加減、公司存簿與銀行對帳。正式入帳前先經人工確認。"
        action={
          <Button variant="secondary" type="button" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            重新整理
          </Button>
        }
      />

      <div className="overflow-x-auto border-y border-stone-200 bg-white">
        <nav className="flex min-w-max gap-1 px-2 py-2">
          {financeViews.map((item) => {
            const Icon = item.icon;
            const active = view === item.key;
            const count = item.key === "drafts" ? pendingDrafts.length : 0;

            return (
              <button
                key={item.key}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium",
                  active ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-stone-100"
                )}
                type="button"
                onClick={() => {
                  setView(item.key);
                  if (item.key !== "projects") setSelectedProjectId("");
                }}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
                {count ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/20" : "bg-red-50 text-red-700")}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <ErrorMessage message={error} />
      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {view === "dashboard" ? (
        <FinanceDashboard
          projects={projects}
          data={data}
          pendingDrafts={pendingDrafts}
          contractsByProject={contractsByProject}
          openDrafts={() => setView("drafts")}
        />
      ) : null}

      {view === "drafts" ? (
        <FinanceDrafts
          drafts={pendingDrafts}
          projectsById={projectsById}
          accounts={data.accounts}
          contractsByProject={contractsByProject}
          saving={saving}
          onApprove={(draft, accountId, contractId) =>
            void runAction(
              () => approveFinanceDraft(draft, accountId, contractId, profile?.displayName || user?.email || "", actor),
              "財務草稿已確認並正式入帳。"
            )
          }
          onIgnore={(draft) =>
            void runAction(
              () => ignoreFinanceDraft(draft.id, profile?.displayName || user?.email || ""),
              "財務草稿已忽略。"
            )
          }
        />
      ) : null}

      {view === "projects" && !selectedProject ? (
        <FinanceProjects
          projects={projects}
          data={data}
          contractsByProject={contractsByProject}
          onOpen={selectProject}
          onEdit={(project) => {
            const contracts = contractsByProject.get(project.id) || [];
            const settings = primaryFinanceContract(contracts);
            setModal({
              kind: "contract",
              project,
              settings,
              isPrimary: true,
              sortOrder: settings?.sortOrder ?? 0
            });
          }}
        />
      ) : null}

      {view === "projects" && selectedProject ? (
        <FinanceProjectDetail
          project={selectedProject}
          contracts={contractsByProject.get(selectedProject.id) || []}
          selectedContractId={selectedContractId}
          onSelectContract={setSelectedContractId}
          payments={data.payments.filter((item) => item.projectId === selectedProject.id)}
          adjustments={data.adjustments.filter((item) => item.projectId === selectedProject.id)}
          costs={data.costs.filter((item) => item.projectId === selectedProject.id)}
          accountsById={accountsById}
          projectTab={projectTab}
          setProjectTab={setProjectTab}
          onBack={() => setSelectedProjectId("")}
          onAddContract={() => {
            const contracts = contractsByProject.get(selectedProject.id) || [];
            setModal({
              kind: "contract",
              project: selectedProject,
              isPrimary: contracts.length === 0,
              sortOrder: contracts.length
            });
          }}
          onEditContract={(settings) =>
            setModal({
              kind: "contract",
              project: selectedProject,
              settings,
              isPrimary: settings.isPrimary,
              sortOrder: settings.sortOrder
            })
          }
          onAddPayment={(contractId) => setModal({ kind: "payment", projectId: selectedProject.id, contractId })}
          onEditPayment={(item, contractId) => setModal({ kind: "payment", projectId: selectedProject.id, contractId, item })}
          onDeletePayment={(item) => {
            if (!window.confirm(`確定刪除收款「${item.name}」？`)) return;
            void runAction(() => deleteFinancePayment(item.id, item.name, actor), "收款已刪除。");
          }}
          onAddAdjustment={(contractId) => setModal({ kind: "adjustment", projectId: selectedProject.id, contractId })}
          onEditAdjustment={(item, contractId) => setModal({ kind: "adjustment", projectId: selectedProject.id, contractId, item })}
          onDeleteAdjustment={(item) => {
            if (!window.confirm(`確定刪除追加減「${item.name || "未命名項目"}」？`)) return;
            void runAction(() => deleteFinanceAdjustment(item.id, item.name, actor), "追加減已刪除。");
          }}
          onAddCost={(contractId) => setModal({ kind: "cost", projectId: selectedProject.id, contractId })}
          onEditCost={(item, contractId) => setModal({ kind: "cost", projectId: selectedProject.id, contractId, item })}
          onDeleteCost={(item) => {
            if (!window.confirm(`確定刪除成本「${item.item || item.category}」？`)) return;
            void runAction(() => deleteFinanceCost(item.id, item.item || item.category, actor), "成本已刪除。");
          }}
        />
      ) : null}

      {view === "accounts" ? (
        <FinanceAccounts
          accounts={data.accounts}
          entries={accountEntries}
          projectsById={projectsById}
          onAddAccount={() => setModal({ kind: "account" })}
          onEditAccount={(item) => setModal({ kind: "account", item })}
          onDeleteAccount={(item) => {
            if (item.defaultForIncome) {
              setError("預設收款帳戶不能刪除，請先把其他帳戶設為預設。");
              return;
            }
            if (accountEntries.some((entry) => entry.accountId === item.id)) {
              setError("這個帳戶已有存簿流水，不能刪除。請改成停用帳戶，以保留歷史紀錄。");
              return;
            }
            if (!window.confirm(`確定刪除帳戶「${item.name}」？`)) return;
            void runAction(() => deleteFinanceAccount(item.id, item.name, actor), "帳戶已刪除。");
          }}
          onReorderAccounts={(accountIds) =>
            void runAction(
              () => reorderFinanceAccounts(accountIds, actor),
              "存簿順序已更新。"
            )
          }
          onAddLedger={() => setModal({ kind: "ledger" })}
          onEditLedger={(item) => setModal({ kind: "ledger", item })}
          onDeleteLedger={(item) => {
            if (!window.confirm(`確定刪除流水「${item.item || item.category}」？`)) return;
            void runAction(() => deleteFinanceLedger(item.id, item.item || item.category, actor), "流水已刪除。");
          }}
          ledger={data.ledger}
        />
      ) : null}

      {view === "reconcile" ? (
        <FinanceReconcile
          accounts={data.accounts}
          entries={accountEntries}
          onAdd={(preset) => setModal({ kind: "ledger", preset })}
        />
      ) : null}

      {view === "data" ? (
        <FinanceDataTools
          projects={projects}
          data={data}
          projectsById={projectsById}
          onImport={(nextData) =>
            void runAction(() => importFinanceBackup(nextData, actor), "財務備份已匯入。")
          }
          onClear={() => {
            if (!window.confirm("確定清空全部財務資料？案件本身不會被刪除，但此動作無法復原。")) return;
            void runAction(
              async () => {
                await clearFinanceData(actor);
                await ensureDefaultFinanceAccount(actor);
              },
              "財務資料已清空，預設帳戶已重新建立。"
            );
          }}
        />
      ) : null}

      {modal ? (
        <FinanceModal
          modal={modal}
          accounts={data.accounts}
          contracts={
            modal.kind === "contract"
              ? contractsByProject.get(modal.project.id) || []
              : "projectId" in modal
                ? contractsByProject.get(modal.projectId) || []
                : []
          }
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void submitFinanceModal(modal, form, actor, runAction, data);
          }}
        />
      ) : null}
    </div>
  );
}

function FinanceDashboard({
  projects,
  data,
  pendingDrafts,
  contractsByProject,
  openDrafts
}: {
  projects: Project[];
  data: FinanceData;
  pendingDrafts: FinanceDraft[];
  contractsByProject: Map<string, FinanceProjectSettings[]>;
  openDrafts: () => void;
}) {
  const accountEntries = useMemo(() => buildFinanceAccountEntries(data), [data]);
  const years = useMemo(() => {
    const values = new Set<string>([String(new Date().getFullYear())]);
    projects.forEach((project) => {
      const settings = primaryFinanceContract(contractsByProject.get(project.id) || []);
      const value =
        settings?.startDate ||
        project.expectedFinishDate ||
        project.createdAt?.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }) ||
        "";
      const projectYear = value.slice(0, 4);
      if (projectYear) values.add(projectYear);
    });
    return [...values].sort((a, b) => b.localeCompare(a));
  }, [contractsByProject, projects]);
  const [year, setYear] = useState(years[0] || String(new Date().getFullYear()));
  const [selectedAccountId, setSelectedAccountId] = useState(
    data.accounts.find((item) => item.defaultForIncome)?.id || data.accounts[0]?.id || ""
  );

  useEffect(() => {
    if (!years.includes(year)) setYear(years[0] || String(new Date().getFullYear()));
  }, [year, years]);

  useEffect(() => {
    if (!data.accounts.some((item) => item.id === selectedAccountId)) {
      setSelectedAccountId(
        data.accounts.find((item) => item.defaultForIncome)?.id || data.accounts[0]?.id || ""
      );
    }
  }, [data.accounts, selectedAccountId]);

  const rows = projects
    .filter((project) => {
      const settings = primaryFinanceContract(contractsByProject.get(project.id) || []);
      const value =
        settings?.startDate ||
        project.expectedFinishDate ||
        project.createdAt?.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }) ||
        "";
      return value.slice(0, 4) === year;
    })
    .map((project) => {
      const contracts = contractsByProject.get(project.id) || [];
      const totals = projectFinanceTotalsForContracts(
        contracts,
        data.payments.filter((item) => item.projectId === project.id),
        data.adjustments.filter((item) => item.projectId === project.id),
        data.costs.filter((item) => item.projectId === project.id)
      );
      return { project, settings: primaryFinanceContract(contracts), totals };
    });
  const summary = rows.reduce(
    (result, row) => ({
      contract: result.contract + row.totals.contract,
      received: result.received + row.totals.received,
      receivable: result.receivable + row.totals.receivable,
      profit: result.profit + row.totals.profit,
      futureCash: result.futureCash + row.totals.futureCash
    }),
    { contract: 0, received: 0, receivable: 0, profit: 0, futureCash: 0 }
  );
  const selectedAccount = data.accounts.find((item) => item.id === selectedAccountId);
  const selectedAccountBalance = selectedAccount
    ? financeAccountBalance(selectedAccount, accountEntries)
    : 0;
  const futureCompanyBalance = summary.futureCash + selectedAccountBalance;
  const rankedRows = [...rows].sort((a, b) => b.totals.profit - a.totals.profit);
  const projectIds = new Set(rows.map((row) => row.project.id));
  const receivableRows = data.payments
    .filter(
      (payment) =>
        projectIds.has(payment.projectId) &&
        Math.max(Number(payment.expectedAmount) || 0, 0) > paymentReceivedAmount(payment)
    )
    .sort(
      (a, b) =>
        (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") ||
        a.name.localeCompare(b.name, "zh-Hant")
    );
  const maxAccountBalance = Math.max(
    ...data.accounts.map((account) => Math.abs(financeAccountBalance(account, accountEntries))),
    1
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">年度總覽</h2>
        <div className="grid min-w-full gap-2 sm:min-w-0 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            年度
            <select className={cn(inputClass, "mt-1 min-w-32 py-2")} value={year} onChange={(event) => setYear(event.target.value)}>
              {years.map((value) => <option key={value} value={value}>{value} 年</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            未來公司存簿
            <select
              className={cn(inputClass, "mt-1 min-w-48 py-2")}
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={!data.accounts.length}
            >
              {data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="合約總額" value={money(summary.contract)} icon={ReceiptText} />
        <Metric label="已收款" value={money(summary.received)} icon={ArrowDownToLine} tone="teal" />
        <Metric label="待收款" value={money(summary.receivable)} icon={CircleDollarSign} tone="amber" />
        <Metric label="未來公司存簿金額" value={money(futureCompanyBalance)} icon={WalletCards} tone={futureCompanyBalance >= 0 ? "teal" : "red"} />
        <Metric label="利潤" value={money(summary.profit)} icon={Banknote} tone={summary.profit >= 0 ? "teal" : "red"} />
      </div>

      {pendingDrafts.length ? (
        <button
          className="flex w-full items-center justify-between gap-4 border border-amber-200 bg-amber-50 px-4 py-3 text-left"
          type="button"
          onClick={openDrafts}
        >
          <span className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden />
            <span>
              <span className="block text-sm font-semibold text-amber-950">有 {pendingDrafts.length} 筆財務草稿等待確認</span>
              <span className="mt-0.5 block text-xs text-amber-800">確認後才會更新案件金額與公司存簿。</span>
            </span>
          </span>
          <ChevronRight className="h-5 w-5 text-amber-700" aria-hidden />
        </button>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="案件盈餘排行">
          {rankedRows.length ? (
            <Table>
              <thead>
                <tr><Th>案件</Th><Th>合約總額</Th><Th>成本</Th><Th>利潤</Th><Th>獲利成數</Th><Th>待收</Th></tr>
              </thead>
              <tbody>
                {rankedRows.map(({ project, settings, totals }) => (
                  <tr key={project.id} className="border-t border-stone-100">
                    <Td>{[settings?.code, project.name].filter(Boolean).join(" ")}</Td>
                    <Td>{money(totals.contract)}</Td>
                    <Td>{money(totals.costs)}</Td>
                    <Td><span className={totals.profit >= 0 ? "text-emerald-700" : "text-red-700"}>{money(totals.profit)}</span></Td>
                    <Td>{percent(totals.contract ? totals.profit / totals.contract : 0)}</Td>
                    <Td><span className={totals.receivable ? "text-amber-700" : ""}>{money(totals.receivable)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState title="尚無案件" description={`${year} 年目前沒有案件財務資料。`} />}
        </Section>

        <Section title="公司存簿餘額">
          {data.accounts.length ? (
            <div className="space-y-4 p-4">
              {data.accounts.map((account) => {
                const balance = financeAccountBalance(account, accountEntries);
                const width = Math.max(2, Math.abs(balance) / maxAccountBalance * 100);
                return (
                  <div key={account.id} className="grid items-center gap-2 text-sm sm:grid-cols-[minmax(90px,auto)_1fr_auto]">
                    <span className="font-medium text-slate-700">{account.name}</span>
                    <div className="h-2 overflow-hidden rounded bg-stone-100">
                      <div className={cn("h-full rounded", balance >= 0 ? "bg-teal-600" : "bg-red-500")} style={{ width: `${width}%` }} />
                    </div>
                    <span className={cn("font-semibold tabular-nums", balance >= 0 ? "text-emerald-700" : "text-red-700")}>{money(balance)}</span>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="尚無帳戶" description="新增公司存簿後會顯示餘額。" />}
        </Section>
      </div>

      <Section title="待收款提醒">
        {receivableRows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>預計日期</Th>
                <Th>案件</Th>
                <Th>款項</Th>
                <Th>應收</Th>
                <Th>已收</Th>
                <Th>待收款</Th>
                <Th>狀態</Th>
              </tr>
            </thead>
            <tbody>
              {receivableRows.map((payment) => {
                const received = paymentReceivedAmount(payment);
                return (
                <tr key={payment.id} className="border-t border-stone-100">
                  <Td>{payment.dueDate || "—"}</Td>
                  <Td>{projects.find((project) => project.id === payment.projectId)?.name || "找不到案件"}</Td>
                  <Td>{payment.name}</Td>
                  <Td>{money(payment.expectedAmount)}</Td>
                  <Td>{money(received)}</Td>
                  <Td><span className="font-semibold text-amber-700">{money(Math.max(payment.expectedAmount - received, 0))}</span></Td>
                  <Td>{paymentStatusLabel(payment.status)}</Td>
                </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="目前沒有待收款" description={`${year} 年沒有尚未收足的收款項目。`} />
        )}
      </Section>
    </div>
  );
}

function FinanceDrafts({
  drafts,
  projectsById,
  accounts,
  contractsByProject,
  saving,
  onApprove,
  onIgnore
}: {
  drafts: FinanceDraft[];
  projectsById: Map<string, Project>;
  accounts: FinanceAccount[];
  contractsByProject: Map<string, FinanceProjectSettings[]>;
  saving: boolean;
  onApprove: (draft: FinanceDraft, accountId: string, contractId: string) => void;
  onIgnore: (draft: FinanceDraft) => void;
}) {
  const defaultAccount = accounts.find((item) => item.defaultForIncome) ?? accounts[0];
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});
  const [contractSelections, setContractSelections] = useState<Record<string, string>>({});

  if (!drafts.length) {
    return (
      <EmptyState
        title="目前沒有待確認財務草稿"
        description="之後 LINE 偵測到內部人員提及收款、追加、減項或成本時，會先放在這裡等待確認。"
      />
    );
  }

  return (
    <Section title="待確認入帳" description="AI 只負責辨識與預填；按下確認後才會正式更新財務資料。">
      <div className="divide-y divide-stone-200">
        {drafts.map((draft) => {
          const selectedAccount = accountSelections[draft.id] || draft.accountId || defaultAccount?.id || "";
          const contracts = contractsByProject.get(draft.projectId) || [];
          const selectedContract =
            contractSelections[draft.id] ||
            draft.contractId ||
            (contracts.length === 1 ? contracts[0].id : "") ||
            "";
          return (
            <article key={draft.id} className="grid gap-4 px-4 py-5 lg:grid-cols-[1fr_260px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {draftTypeLabel(draft.draftType)}
                  </span>
                  {draft.amountMismatch ? (
                    <span className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">金額不一致</span>
                  ) : null}
                  {draft.duplicateWarning ? (
                    <span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">疑似重複</span>
                  ) : null}
                </div>
                <h3 className="mt-3 font-semibold text-slate-950">{draft.title || "未命名項目"}</h3>
                <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <div>案件：{projectsById.get(draft.projectId)?.name || "找不到案件"}</div>
                  <div>金額：{money(draft.totalAmount || draft.amount)}</div>
                  <div>日期：{draft.date || "未設定"}</div>
                  <div>發話人：{draft.sourceSenderName || "未知"}</div>
                </dl>
                {draft.adjustments.length ? (
                  <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    <p className="font-semibold">同一則訊息包含追加減</p>
                    {draft.adjustments.map((adjustment, index) => (
                      <p key={`${draft.id}-${adjustment.type}-${index}`} className="mt-1">
                        {adjustment.type === "add" ? "追加" : "減項"}：
                        {adjustment.name || "項目未填"} {money(adjustment.amount)}
                      </p>
                    ))}
                    <p className="mt-1 text-xs text-amber-800">確認後會同時建立收款與追加減紀錄。</p>
                  </div>
                ) : null}
                <div className="mt-3 border-l-2 border-stone-300 pl-3 text-sm leading-6 text-slate-600">
                  {draft.sourceMessageText || "沒有原始訊息"}
                </div>
                {draft.duplicateWarning ? <p className="mt-2 text-sm text-amber-700">{draft.duplicateWarning}</p> : null}
              </div>
              <div className="space-y-3">
                {contracts.length > 1 ? (
                  <label className="block text-sm font-medium text-slate-700">
                    所屬合約
                    <select
                      className={inputClass}
                      value={selectedContract}
                      onChange={(event) =>
                        setContractSelections((current) => ({
                          ...current,
                          [draft.id]: event.target.value
                        }))
                      }
                    >
                      <option value="">請選擇合約</option>
                      {contracts.map((contract) => (
                        <option key={contract.id} value={contract.id}>
                          {contract.name}
                          {contract.isPrimary ? "（主合約）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="rounded-md bg-stone-50 px-3 py-2 text-sm text-slate-600">
                    合約：{contracts[0]?.name || "尚未建立合約"}
                  </div>
                )}
                {(draft.draftType === "payment" || draft.draftType === "cost") && accounts.length ? (
                  <label className="block text-sm font-medium text-slate-700">
                    {draft.draftType === "payment" ? "入金帳戶" : "出金帳戶"}
                    <select
                      className={inputClass}
                      value={selectedAccount}
                      onChange={(event) =>
                        setAccountSelections((current) => ({ ...current, [draft.id]: event.target.value }))
                      }
                    >
                      {accounts.filter((item) => item.active).map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                          {account.defaultForIncome ? "（預設）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Button
                  className="w-full"
                  type="button"
                  disabled={
                    saving ||
                    draft.amountMismatch ||
                    !draft.projectId ||
                    !selectedContract ||
                    ((draft.draftType === "payment" || draft.draftType === "cost") && !selectedAccount)
                  }
                  onClick={() => onApprove(draft, selectedAccount, selectedContract)}
                >
                  <Check className="h-4 w-4" aria-hidden />
                  確認入帳
                </Button>
                <Button className="w-full" variant="secondary" type="button" disabled={saving} onClick={() => onIgnore(draft)}>
                  忽略
                </Button>
                {draft.amountMismatch ? (
                  <p className="text-xs leading-5 text-red-700">
                    原文金額不一致，請忽略這筆草稿，再到案件財務手動新增正確紀錄。
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </Section>
  );
}

function FinanceProjects({
  projects,
  data,
  contractsByProject,
  onOpen,
  onEdit
}: {
  projects: Project[];
  data: FinanceData;
  contractsByProject: Map<string, FinanceProjectSettings[]>;
  onOpen: (projectId: string) => void;
  onEdit: (project: Project) => void;
}) {
  if (!projects.length) {
    return <EmptyState title="尚未建立案件" description="請先到案件列表建立案件，再設定財務資料。" />;
  }

  return (
    <Section title="案件財務" description="案件名稱與客戶資料直接沿用 AI 案件秘書，不需重複建立。">
      <Table>
        <thead>
          <tr>
            <Th>案件</Th>
            <Th>狀態</Th>
            <Th>合約總額</Th>
            <Th>已收款</Th>
            <Th>工程成本</Th>
            <Th>利潤</Th>
            <Th align="right">操作</Th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const totals = projectFinanceTotalsForContracts(
              contractsByProject.get(project.id) || [],
              data.payments.filter((item) => item.projectId === project.id),
              data.adjustments.filter((item) => item.projectId === project.id),
              data.costs.filter((item) => item.projectId === project.id)
            );
            return (
              <tr key={project.id} className="border-t border-stone-100 hover:bg-stone-50">
                <Td>
                  <button className="text-left font-semibold text-slate-950 hover:text-teal-700" type="button" onClick={() => onOpen(project.id)}>
                    {project.name}
                  </button>
                  <span className="mt-1 block text-xs text-slate-500">{project.clientName}</span>
                </Td>
                <Td>{project.status}</Td>
                <Td>{money(totals.contract)}</Td>
                <Td>{money(totals.received)}</Td>
                <Td>{money(totals.costs)}</Td>
                <Td>
                  <span className={totals.profit >= 0 ? "text-emerald-700" : "text-red-700"}>{money(totals.profit)}</span>
                </Td>
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    <IconButton label="設定財務資料" icon={Pencil} onClick={() => onEdit(project)} />
                    <IconButton label="查看案件收支" icon={ChevronRight} onClick={() => onOpen(project.id)} />
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

function FinanceProjectDetail({
  project,
  contracts,
  selectedContractId,
  onSelectContract,
  payments,
  adjustments,
  costs,
  accountsById,
  projectTab,
  setProjectTab,
  onBack,
  onAddContract,
  onEditContract,
  onAddPayment,
  onEditPayment,
  onDeletePayment,
  onAddAdjustment,
  onEditAdjustment,
  onDeleteAdjustment,
  onAddCost,
  onEditCost,
  onDeleteCost
}: {
  project: Project;
  contracts: FinanceProjectSettings[];
  selectedContractId: string;
  onSelectContract: (contractId: string) => void;
  payments: FinancePayment[];
  adjustments: FinanceAdjustment[];
  costs: FinanceCost[];
  accountsById: Map<string, FinanceAccount>;
  projectTab: ProjectTab;
  setProjectTab: (tab: ProjectTab) => void;
  onBack: () => void;
  onAddContract: () => void;
  onEditContract: (settings: FinanceProjectSettings) => void;
  onAddPayment: (contractId: string) => void;
  onEditPayment: (item: FinancePayment, contractId: string) => void;
  onDeletePayment: (item: FinancePayment) => void;
  onAddAdjustment: (contractId: string) => void;
  onEditAdjustment: (item: FinanceAdjustment, contractId: string) => void;
  onDeleteAdjustment: (item: FinanceAdjustment) => void;
  onAddCost: (contractId: string) => void;
  onEditCost: (item: FinanceCost, contractId: string) => void;
  onDeleteCost: (item: FinanceCost) => void;
}) {
  const primaryContract = primaryFinanceContract(contracts);
  const selectedContract =
    selectedContractId === "all"
      ? undefined
      : contracts.find((item) => item.id === selectedContractId);
  const activeContractId = selectedContract?.id || primaryContract?.id || "";
  const filteredPayments =
    selectedContractId === "all"
      ? payments
      : payments.filter((item) =>
          financeRecordBelongsToContract(item, activeContractId, contracts)
        );
  const filteredAdjustments =
    selectedContractId === "all"
      ? adjustments
      : adjustments.filter((item) =>
          financeRecordBelongsToContract(item, activeContractId, contracts)
        );
  const filteredCosts =
    selectedContractId === "all"
      ? costs
      : costs.filter((item) =>
          financeRecordBelongsToContract(item, activeContractId, contracts)
        );
  const totals =
    selectedContractId === "all"
      ? projectFinanceTotalsForContracts(contracts, payments, adjustments, costs)
      : projectFinanceTotals(selectedContract, filteredPayments, filteredAdjustments, filteredCosts);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950" type="button" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件財務
          </button>
          <h2 className="mt-3 text-xl font-semibold text-slate-950">{project.name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {project.clientName}｜{selectedContract?.code || `${contracts.length} 份合約`}
          </p>
        </div>
        <Button type="button" onClick={onAddContract}>
          <Plus className="h-4 w-4" aria-hidden />
          新增合約
        </Button>
      </div>

      {contracts.length ? (
        <div className="flex flex-wrap items-center gap-2 border border-stone-200 bg-white p-3">
          <button
            className={cn(
              "min-h-10 rounded-md border px-3 text-sm font-semibold",
              selectedContractId === "all"
                ? "border-teal-700 bg-teal-700 text-white"
                : "border-stone-200 bg-white text-slate-600 hover:bg-stone-50"
            )}
            type="button"
            onClick={() => onSelectContract("all")}
          >
            全部合約
          </button>
          {contracts.map((contract) => (
            <button
              key={contract.id}
              className={cn(
                "min-h-10 rounded-md border px-3 text-sm font-semibold",
                selectedContractId === contract.id
                  ? "border-teal-700 bg-teal-700 text-white"
                  : "border-stone-200 bg-white text-slate-600 hover:bg-stone-50"
              )}
              type="button"
              onClick={() => onSelectContract(contract.id)}
            >
              {contract.name}
              {contract.isPrimary ? "（主）" : ""}
            </button>
          ))}
          {selectedContract ? (
            <IconButton
              label={`編輯${selectedContract.name}`}
              icon={Pencil}
              onClick={() => onEditContract(selectedContract)}
            />
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="尚未建立合約"
          description="先新增主合約，之後可在同一案件下繼續新增其他合約。"
          action={
            <Button type="button" onClick={onAddContract}>
              <Plus className="h-4 w-4" aria-hidden />
              新增主合約
            </Button>
          }
        />
      )}

      {contracts.length ? (
        <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="合約總額" value={money(totals.contract)} icon={ReceiptText} />
        <Metric label="已收款" value={money(totals.received)} icon={ArrowDownToLine} tone="teal" />
        <Metric label="已付成本" value={money(totals.paidCosts)} icon={ArrowUpFromLine} tone="red" />
        <Metric label="實際利潤" value={money(totals.actualProfit)} icon={Banknote} />
        <Metric label="追加總額" value={money(totals.additions)} icon={Plus} tone="amber" />
        <Metric label="減項總額" value={money(totals.deductions)} icon={Trash2} />
        <Metric label="待收款" value={money(totals.receivable)} icon={CircleDollarSign} tone="amber" />
        <Metric
          label="預估利潤 / 成數"
          value={`${money(totals.estimatedProfit)} / ${percent(totals.estimatedProfitRate)}`}
          icon={WalletCards}
          tone={totals.estimatedProfit >= 0 ? "teal" : "red"}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-stone-200">
        {[
          ["payments", "收款入金"],
          ["adjustments", "追加減金額"],
          ["costs", "工程成本出金"]
        ].map(([key, label]) => (
          <button
            key={key}
            className={cn(
              "min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-semibold",
              projectTab === key ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500"
            )}
            type="button"
            onClick={() => setProjectTab(key as ProjectTab)}
          >
            {label}
          </button>
        ))}
      </div>

      {projectTab === "payments" ? (
        <ProjectPayments
          payments={filteredPayments}
          accountsById={accountsById}
          contracts={contracts}
          showContract={selectedContractId === "all"}
          onAdd={() => onAddPayment(activeContractId)}
          onEdit={(item) =>
            onEditPayment(
              item,
              item.contractId || primaryContract?.id || activeContractId
            )
          }
          onDelete={onDeletePayment}
        />
      ) : null}
      {projectTab === "adjustments" ? (
        <ProjectAdjustments
          adjustments={filteredAdjustments}
          contracts={contracts}
          showContract={selectedContractId === "all"}
          onAdd={() => onAddAdjustment(activeContractId)}
          onEdit={(item) =>
            onEditAdjustment(
              item,
              item.contractId || primaryContract?.id || activeContractId
            )
          }
          onDelete={onDeleteAdjustment}
        />
      ) : null}
      {projectTab === "costs" ? (
        <ProjectCosts
          costs={filteredCosts}
          accountsById={accountsById}
          contracts={contracts}
          showContract={selectedContractId === "all"}
          onAdd={() => onAddCost(activeContractId)}
          onEdit={(item) =>
            onEditCost(
              item,
              item.contractId || primaryContract?.id || activeContractId
            )
          }
          onDelete={onDeleteCost}
        />
      ) : null}
        </>
      ) : null}
    </div>
  );
}

function ProjectPayments({
  payments,
  accountsById,
  contracts,
  showContract,
  onAdd,
  onEdit,
  onDelete
}: {
  payments: FinancePayment[];
  accountsById: Map<string, FinanceAccount>;
  contracts: FinanceProjectSettings[];
  showContract: boolean;
  onAdd: () => void;
  onEdit: (item: FinancePayment) => void;
  onDelete: (item: FinancePayment) => void;
}) {
  return (
    <Section
      title="收款表單"
      action={
        <Button type="button" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden />
          新增收款
        </Button>
      }
    >
      {payments.length ? (
        <Table>
          <thead>
            <tr>
              {showContract ? <Th>合約</Th> : null}<Th>款項名稱</Th><Th>預計日期</Th><Th>實收日期</Th><Th>應收金額</Th><Th>已收金額</Th><Th>入金帳戶</Th><Th>狀態</Th><Th align="right">操作</Th>
            </tr>
          </thead>
          <tbody>
            {payments.map((item) => (
              <tr key={item.id} className="border-t border-stone-100">
                {showContract ? <Td>{financeContractName(item, contracts)}</Td> : null}
                <Td><strong>{item.name}</strong><span className="mt-1 block text-xs text-slate-500">{item.notes}</span></Td>
                <Td>{item.dueDate || "—"}</Td><Td>{item.paidDate || "—"}</Td><Td>{money(item.expectedAmount)}</Td><Td>{money(item.receivedAmount)}</Td>
                <Td>{accountsById.get(item.accountId)?.name || "未設定"}</Td><Td>{paymentStatusLabel(item.status)}</Td>
                <Td align="right"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="尚無收款紀錄" description="新增預計收款或已收款，存簿會依狀態自動連動。" />}
    </Section>
  );
}

function ProjectAdjustments({
  adjustments,
  contracts,
  showContract,
  onAdd,
  onEdit,
  onDelete
}: {
  adjustments: FinanceAdjustment[];
  contracts: FinanceProjectSettings[];
  showContract: boolean;
  onAdd: () => void;
  onEdit: (item: FinanceAdjustment) => void;
  onDelete: (item: FinanceAdjustment) => void;
}) {
  return (
    <Section title="追加減金額表單" action={<Button type="button" onClick={onAdd}><Plus className="h-4 w-4" aria-hidden />新增追加減</Button>}>
      {adjustments.length ? (
        <Table>
          <thead><tr>{showContract ? <Th>合約</Th> : null}<Th>日期</Th><Th>類型</Th><Th>項目名稱</Th><Th>金額</Th><Th>備註</Th><Th align="right">操作</Th></tr></thead>
          <tbody>
            {adjustments.map((item) => (
              <tr key={item.id} className="border-t border-stone-100">
                {showContract ? <Td>{financeContractName(item, contracts)}</Td> : null}
                <Td>{item.date || "—"}</Td>
                <Td><span className={item.type === "add" ? "text-emerald-700" : "text-red-700"}>{item.type === "add" ? "追加" : "減項"}</span></Td>
                <Td>{item.name || "未填寫"}</Td><Td>{money(item.amount)}</Td><Td>{item.notes || "—"}</Td>
                <Td align="right"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="尚無追加減紀錄" description="追加會增加合約總額，減項會降低合約總額；項目名稱可以留空。" />}
    </Section>
  );
}

function ProjectCosts({
  costs,
  accountsById,
  contracts,
  showContract,
  onAdd,
  onEdit,
  onDelete
}: {
  costs: FinanceCost[];
  accountsById: Map<string, FinanceAccount>;
  contracts: FinanceProjectSettings[];
  showContract: boolean;
  onAdd: () => void;
  onEdit: (item: FinanceCost) => void;
  onDelete: (item: FinanceCost) => void;
}) {
  return (
    <Section title="工程成本表單" action={<Button type="button" onClick={onAdd}><Plus className="h-4 w-4" aria-hidden />新增成本</Button>}>
      {costs.length ? (
        <Table>
          <thead><tr>{showContract ? <Th>合約</Th> : null}<Th>工程分類</Th><Th>細項</Th><Th>廠商／工班</Th><Th>日期</Th><Th>成本金額</Th><Th>出金帳戶</Th><Th>狀態</Th><Th align="right">操作</Th></tr></thead>
          <tbody>
            {costs.map((item) => (
              <tr key={item.id} className="border-t border-stone-100">
                {showContract ? <Td>{financeContractName(item, contracts)}</Td> : null}
                <Td>{item.category || "—"}</Td><Td>{item.item || "—"}</Td><Td>{item.vendor || "—"}</Td><Td>{item.date || "—"}</Td>
                <Td>{money(item.amount)}</Td><Td>{accountsById.get(item.accountId)?.name || "未設定"}</Td><Td>{item.status === "paid" ? "已付" : "未付"}</Td>
                <Td align="right"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="尚無工程成本" description="成本標成已付後，公司存簿才會自動顯示出金。" />}
    </Section>
  );
}

function FinanceAccounts({
  accounts,
  entries,
  projectsById,
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
  onReorderAccounts,
  onAddLedger,
  onEditLedger,
  onDeleteLedger,
  ledger
}: {
  accounts: FinanceAccount[];
  entries: FinanceAccountEntry[];
  projectsById: Map<string, Project>;
  onAddAccount: () => void;
  onEditAccount: (item: FinanceAccount) => void;
  onDeleteAccount: (item: FinanceAccount) => void;
  onReorderAccounts: (accountIds: string[]) => void;
  onAddLedger: () => void;
  onEditLedger: (item: FinanceLedger) => void;
  onDeleteLedger: (item: FinanceLedger) => void;
  ledger: FinanceLedger[];
}) {
  const ledgerById = new Map(ledger.map((item) => [item.id, item]));
  const [orderedAccounts, setOrderedAccounts] = useState(accounts);
  const [draggedAccountId, setDraggedAccountId] = useState("");

  useEffect(() => {
    setOrderedAccounts(accounts);
  }, [accounts]);

  function commitAccountOrder(nextAccounts: FinanceAccount[]) {
    setOrderedAccounts(nextAccounts);
    onReorderAccounts(nextAccounts.map((item) => item.id));
  }

  function moveAccount(accountId: string, direction: -1 | 1) {
    const currentIndex = orderedAccounts.findIndex((item) => item.id === accountId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedAccounts.length) return;

    const nextAccounts = [...orderedAccounts];
    const [account] = nextAccounts.splice(currentIndex, 1);
    nextAccounts.splice(nextIndex, 0, account);
    commitAccountOrder(nextAccounts);
  }

  function dropAccount(targetAccountId: string) {
    if (!draggedAccountId || draggedAccountId === targetAccountId) {
      setDraggedAccountId("");
      return;
    }

    const sourceIndex = orderedAccounts.findIndex((item) => item.id === draggedAccountId);
    const targetIndex = orderedAccounts.findIndex((item) => item.id === targetAccountId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextAccounts = [...orderedAccounts];
    const [account] = nextAccounts.splice(sourceIndex, 1);
    nextAccounts.splice(targetIndex, 0, account);
    setDraggedAccountId("");
    commitAccountOrder(nextAccounts);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onAddAccount}><Plus className="h-4 w-4" aria-hidden />新增帳戶</Button>
        <Button type="button" onClick={onAddLedger}><Plus className="h-4 w-4" aria-hidden />手動入出金</Button>
      </div>
      <div>
        <p className="mb-2 text-xs text-slate-500">拖曳把手即可自由排序；也可使用上下移動按鈕。順序會儲存並套用到所有財務頁面。</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {orderedAccounts.map((account, index) => (
          <div
            key={account.id}
            className={cn(
              "border bg-white p-4 transition-colors",
              draggedAccountId === account.id ? "border-teal-500 bg-teal-50/40" : "border-stone-200"
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropAccount(account.id)}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-950">{account.name}</h3>
                  {account.defaultForIncome ? <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">預設收款</span> : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">{account.notes || "沒有備註"}</p>
              </div>
              <div className="flex flex-wrap gap-1 sm:flex-nowrap">
                <button
                  className="inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 active:cursor-grabbing"
                  type="button"
                  draggable
                  aria-label={`拖曳調整 ${account.name} 的順序`}
                  title="拖曳調整順序"
                  onDragStart={() => setDraggedAccountId(account.id)}
                  onDragEnd={() => setDraggedAccountId("")}
                >
                  <GripVertical className="h-4 w-4" aria-hidden />
                </button>
                <IconButton
                  label="上移"
                  icon={ArrowUpFromLine}
                  onClick={() => moveAccount(account.id, -1)}
                  disabled={index === 0}
                />
                <IconButton
                  label="下移"
                  icon={ArrowDownToLine}
                  onClick={() => moveAccount(account.id, 1)}
                  disabled={index === orderedAccounts.length - 1}
                />
                <IconButton label="編輯帳戶" icon={Pencil} onClick={() => onEditAccount(account)} />
                <IconButton label="刪除帳戶" icon={Trash2} danger onClick={() => onDeleteAccount(account)} />
              </div>
            </div>
            <div className="mt-5 text-2xl font-semibold text-slate-950">{money(financeAccountBalance(account, entries))}</div>
            <div className="mt-1 text-xs text-slate-500">目前帳面餘額</div>
          </div>
        ))}
        </div>
      </div>

      <Section title="存簿流水" description="收款與已付成本會自動連動；手動流水可以修改或刪除。">
        {entries.length ? (
          <Table>
            <thead><tr><Th>日期</Th><Th>帳戶</Th><Th>類型</Th><Th>分類</Th><Th>案件</Th><Th>項目</Th><Th>入金</Th><Th>出金</Th><Th align="right">操作</Th></tr></thead>
            <tbody>
              {entries.map((entry) => {
                const manualId = entry.source === "manual" ? entry.id.replace("manual:", "") : "";
                const manual = manualId ? ledgerById.get(manualId) : undefined;
                return (
                  <tr key={entry.id} className="border-t border-stone-100">
                    <Td>{entry.date || "—"}</Td><Td>{accounts.find((item) => item.id === entry.accountId)?.name || "未設定"}</Td>
                    <Td>{entry.type === "in" ? "入金" : "出金"}</Td><Td>{entry.category}</Td><Td>{projectsById.get(entry.projectId)?.name || "—"}</Td><Td>{entry.item || "—"}</Td>
                    <Td>{entry.type === "in" ? money(entry.amount) : "—"}</Td><Td>{entry.type === "out" ? money(entry.amount) : "—"}</Td>
                    <Td align="right">
                      {manual ? <RowActions onEdit={() => onEditLedger(manual)} onDelete={() => onDeleteLedger(manual)} /> : <span className="text-xs text-slate-400">自動連動</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : <EmptyState title="尚無存簿流水" description="確認收款、支付成本或新增手動流水後會顯示在這裡。" />}
      </Section>
    </div>
  );
}

type BankRow = { id: string; date: string; type: "in" | "out"; amount: number; note: string };

function FinanceReconcile({
  accounts,
  entries,
  onAdd
}: {
  accounts: FinanceAccount[];
  entries: FinanceAccountEntry[];
  onAdd: (preset: Partial<FinanceLedger>) => void;
}) {
  const [rows, setRows] = useState<BankRow[]>([]);
  const [accountId, setAccountId] = useState(accounts.find((item) => item.defaultForIncome)?.id || accounts[0]?.id || "");
  const fileRef = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setRows(parseBankCsv(text));
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <div className="space-y-5">
      <Section
        title="銀行對帳"
        description="匯入 CSV 後依日期、入出金方向與金額比對公司存簿；不會自動修改正式資料。"
        action={
          <Button type="button" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden />
            匯入銀行 CSV
          </Button>
        }
      >
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            對帳帳戶
            <select className={inputClass} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <div className="text-sm leading-6 text-slate-500">CSV 建議欄位：日期、存入／收入、提出／支出、摘要。系統也接受「類型、金額」格式。</div>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </Section>

      <Section title="比對結果">
        {rows.length ? (
          <Table>
            <thead><tr><Th>日期</Th><Th>類型</Th><Th>金額</Th><Th>銀行摘要</Th><Th>比對狀態</Th><Th align="right">操作</Th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const matched = entries.some((entry) => entry.accountId === accountId && entry.date === row.date && entry.type === row.type && entry.amount === row.amount);
                return (
                  <tr key={row.id} className="border-t border-stone-100">
                    <Td>{row.date}</Td><Td>{row.type === "in" ? "入金" : "出金"}</Td><Td>{money(row.amount)}</Td><Td>{row.note || "—"}</Td>
                    <Td><span className={matched ? "text-emerald-700" : "text-amber-700"}>{matched ? "已比對" : "尚未比對"}</span></Td>
                    <Td align="right">
                      {!matched ? (
                        <button className="text-sm font-semibold text-teal-700" type="button" onClick={() => onAdd({ date: row.date, accountId, type: row.type, amount: row.amount, item: row.note, category: "其他" })}>
                          加入存簿
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : <EmptyState title="尚未匯入銀行資料" description="選擇銀行匯出的 CSV 檔案後，這裡會顯示逐筆比對結果。" />}
      </Section>
    </div>
  );
}

function FinanceDataTools({
  projects,
  data,
  projectsById,
  onImport,
  onClear
}: {
  projects: Project[];
  data: FinanceData;
  projectsById: Map<string, Project>;
  onImport: (data: FinanceData) => void;
  onClear: () => void;
}) {
  const importRef = useRef<HTMLInputElement>(null);

  function exportJson() {
    downloadFile(`財務管理備份-${today()}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  function exportCsv() {
    const rows: string[][] = [["資料類型", "案件", "日期", "分類／款項", "細項", "帳戶 ID", "應收", "已收／入金", "成本／出金", "狀態", "備註"]];
    data.payments.forEach((item) => rows.push(["收款", projectsById.get(item.projectId)?.name || "", item.paidDate || item.dueDate, item.name, "", item.accountId, String(item.expectedAmount), String(item.receivedAmount), "", paymentStatusLabel(item.status), item.notes]));
    data.adjustments.forEach((item) => rows.push(["追加減", projectsById.get(item.projectId)?.name || "", item.date, item.type === "add" ? "追加" : "減項", item.name, "", String(item.amount), "", "", item.type === "add" ? "追加" : "減項", item.notes]));
    data.costs.forEach((item) => rows.push(["成本", projectsById.get(item.projectId)?.name || "", item.date, item.category, item.item, item.accountId, "", "", String(item.amount), item.status === "paid" ? "已付" : "未付", item.notes]));
    data.ledger.forEach((item) => rows.push(["手動流水", "", item.date, item.category, item.item, item.accountId, "", item.type === "in" ? String(item.amount) : "", item.type === "out" ? String(item.amount) : "", item.type === "in" ? "入金" : "出金", item.notes]));
    downloadFile(`財務管理-${today()}.csv`, `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`, "text/csv");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="匯出" description="備份全部財務資料，或匯出可給試算表使用的 CSV。">
        <div className="flex flex-wrap gap-2 p-4">
          <Button type="button" onClick={exportJson}><Download className="h-4 w-4" aria-hidden />匯出 JSON</Button>
          <Button variant="secondary" type="button" onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" aria-hidden />匯出 CSV</Button>
        </div>
      </Section>
      <Section title="匯入" description="匯入由本財務模組輸出的 JSON 備份；相同 ID 的資料會更新。">
        <div className="p-4">
          <Button variant="secondary" type="button" onClick={() => importRef.current?.click()}><Upload className="h-4 w-4" aria-hidden />選擇 JSON 備份</Button>
          <input
            ref={importRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const parsed = JSON.parse(String(reader.result || "{}"));
                  if (!isFinanceBackup(parsed)) throw new Error("格式不符");
                  onImport(parsed);
                } catch {
                  window.alert("這不是有效的財務模組 JSON 備份。");
                }
              };
              reader.readAsText(file, "utf-8");
              event.target.value = "";
            }}
          />
        </div>
      </Section>
      <Section title="目前資料" description="案件沿用 AI 案件秘書；這裡只統計財務資料。">
        <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
          <DataCount label="案件" value={projects.length} />
          <DataCount label="帳戶" value={data.accounts.length} />
          <DataCount label="收款" value={data.payments.length} />
          <DataCount label="追加減" value={data.adjustments.length} />
          <DataCount label="工程成本" value={data.costs.length} />
          <DataCount label="待確認草稿" value={data.drafts.filter((item) => item.status === "pending").length} />
        </dl>
      </Section>
      <Section title="清空財務資料" description="只清除財務資料，不會刪除案件、LINE 對話、工期、摘要或備忘錄。">
        <div className="p-4">
          <Button variant="danger" type="button" onClick={onClear}><Trash2 className="h-4 w-4" aria-hidden />清空財務資料</Button>
        </div>
      </Section>
    </div>
  );
}

function FinanceModal({
  modal,
  accounts,
  contracts,
  saving,
  onClose,
  onSubmit
}: {
  modal: Exclude<ModalState, null>;
  accounts: FinanceAccount[];
  contracts: FinanceProjectSettings[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const defaultAccount = accounts.find((item) => item.defaultForIncome) ?? accounts[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <form className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white shadow-xl" onSubmit={onSubmit}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{modalTitle(modal)}</h2>
          <IconButton label="關閉" icon={X} onClick={onClose} />
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {modal.kind === "contract" ? <ProjectSettingsFields modal={modal} /> : null}
          {modal.kind === "payment" ? <PaymentFields item={modal.item} accounts={accounts} contracts={contracts} defaultContractId={modal.contractId} defaultAccountId={defaultAccount?.id || ""} /> : null}
          {modal.kind === "adjustment" ? <AdjustmentFields item={modal.item} contracts={contracts} defaultContractId={modal.contractId} /> : null}
          {modal.kind === "cost" ? <CostFields item={modal.item} accounts={accounts} contracts={contracts} defaultContractId={modal.contractId} defaultAccountId={defaultAccount?.id || ""} /> : null}
          {modal.kind === "account" ? <AccountFields item={modal.item} /> : null}
          {modal.kind === "ledger" ? <LedgerFields item={modal.item} preset={modal.preset} accounts={accounts} defaultAccountId={defaultAccount?.id || ""} /> : null}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-stone-200 bg-white px-5 py-4">
          <Button variant="secondary" type="button" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={saving}>{saving ? "儲存中" : "儲存"}</Button>
        </div>
      </form>
    </div>
  );
}

function ProjectSettingsFields({ modal }: { modal: Extract<Exclude<ModalState, null>, { kind: "contract" }> }) {
  const settings = modal.settings;
  const initialContractAmount = Math.max(Number(settings?.contractAmount) || 0, 0);
  const initialEstimatedCost = Math.max(
    Number(settings?.estimatedCost) || Math.round(initialContractAmount * 0.6),
    0
  );
  const [contractAmount, setContractAmount] = useState(String(initialContractAmount));
  const [estimatedCost, setEstimatedCost] = useState(String(initialEstimatedCost));
  const [estimatedCostEdited, setEstimatedCostEdited] = useState(
    Boolean(Number(settings?.estimatedCost))
  );

  function handleContractAmountChange(value: string) {
    setContractAmount(value);
    if (!estimatedCostEdited) {
      setEstimatedCost(String(Math.round(Math.max(Number(value) || 0, 0) * 0.6)));
    }
  }

  function handleEstimatedCostChange(value: string) {
    setEstimatedCost(value);
    setEstimatedCostEdited(Boolean(Number(value)));
  }

  function restoreEstimatedCostIfEmpty() {
    if (!Number(estimatedCost)) {
      setEstimatedCost(String(Math.round(Math.max(Number(contractAmount) || 0, 0) * 0.6)));
      setEstimatedCostEdited(false);
    }
  }

  return (
    <>
      <ReadOnlyField label="案件名稱" value={modal.project.name} />
      <ReadOnlyField label="客戶名稱" value={modal.project.clientName} />
      <Field
        label="合約名稱"
        name="name"
        defaultValue={settings?.name || (modal.isPrimary ? "主合約" : "")}
        placeholder="例如 室內裝修工程、系統櫃工程"
        required
      />
      <Field label="合約編號" name="code" defaultValue={settings?.code || ""} placeholder="例如 C-2026-001" />
      <Field label="地址" name="address" defaultValue={settings?.address || ""} />
      <Field
        label="本案簽約金額"
        name="contractAmount"
        type="number"
        min="0"
        value={contractAmount}
        onChange={(event) => handleContractAmountChange(event.target.value)}
        required
      />
      <label className="text-sm font-medium text-slate-700">
        預估總成本
        <input
          className={inputClass}
          name="estimatedCost"
          type="number"
          min="0"
          value={estimatedCost}
          onChange={(event) => handleEstimatedCostChange(event.target.value)}
          onBlur={restoreEstimatedCostIfEmpty}
        />
        <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
          留空或填 0 時，自動以本案簽約金額的 60% 估算；可自行修改。
        </span>
      </label>
      <Field label="簽約日期" name="startDate" type="date" defaultValue={settings?.startDate || ""} />
      <SelectField label="合約狀態" name="status" defaultValue={settings?.status || "active"}>
        <option value="active">進行中</option>
        <option value="completed">已完成</option>
        <option value="cancelled">已取消</option>
      </SelectField>
      <ReadOnlyField label="合約層級" value={modal.isPrimary ? "主合約" : "其他合約"} />
      <TextArea label="備註" name="notes" defaultValue={settings?.notes || ""} wide />
    </>
  );
}

function PaymentFields({ item, accounts, contracts, defaultContractId, defaultAccountId }: { item?: FinancePayment; accounts: FinanceAccount[]; contracts: FinanceProjectSettings[]; defaultContractId: string; defaultAccountId: string }) {
  return (
    <>
      <ContractField contracts={contracts} defaultContractId={item?.contractId || defaultContractId} />
      <Field label="款項名稱" name="name" defaultValue={item?.name || ""} placeholder="例如 水電進場款" required />
      <Field label="預計收款日" name="dueDate" type="date" defaultValue={item?.dueDate || today()} />
      <Field label="實際收款日" name="paidDate" type="date" defaultValue={item?.paidDate || ""} />
      <Field label="應收金額" name="expectedAmount" type="number" min="0" defaultValue={item?.expectedAmount || 0} required />
      <Field label="已收金額" name="receivedAmount" type="number" min="0" defaultValue={item?.receivedAmount || 0} />
      <SelectField label="入金帳戶" name="accountId" defaultValue={item?.accountId || defaultAccountId}>
        {accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </SelectField>
      <SelectField label="狀態" name="status" defaultValue={item?.status || "unpaid"}>
        <option value="unpaid">未收</option><option value="partial">部分收</option><option value="paid">已收</option>
      </SelectField>
      <TextArea label="備註" name="notes" defaultValue={item?.notes || ""} wide />
    </>
  );
}

function AdjustmentFields({ item, contracts, defaultContractId }: { item?: FinanceAdjustment; contracts: FinanceProjectSettings[]; defaultContractId: string }) {
  return (
    <>
      <ContractField contracts={contracts} defaultContractId={item?.contractId || defaultContractId} />
      <Field label="日期" name="date" type="date" defaultValue={item?.date || today()} />
      <SelectField label="類型" name="type" defaultValue={item?.type || "add"}><option value="add">追加</option><option value="deduct">減項</option></SelectField>
      <Field label="項目名稱（選填）" name="name" defaultValue={item?.name || ""} placeholder="可以留空" wide />
      <Field label="金額" name="amount" type="number" min="0" defaultValue={item?.amount || 0} required />
      <TextArea label="備註" name="notes" defaultValue={item?.notes || ""} wide />
    </>
  );
}

function CostFields({ item, accounts, contracts, defaultContractId, defaultAccountId }: { item?: FinanceCost; accounts: FinanceAccount[]; contracts: FinanceProjectSettings[]; defaultContractId: string; defaultAccountId: string }) {
  return (
    <>
      <ContractField contracts={contracts} defaultContractId={item?.contractId || defaultContractId} />
      <Field label="工程分類" name="category" defaultValue={item?.category || ""} placeholder="例如 木工工程" />
      <Field label="細項名稱" name="item" defaultValue={item?.item || ""} />
      <Field label="廠商／工班" name="vendor" defaultValue={item?.vendor || ""} />
      <Field label="日期" name="date" type="date" defaultValue={item?.date || today()} />
      <Field label="成本金額" name="amount" type="number" min="0" defaultValue={item?.amount || 0} required />
      <SelectField label="出金帳戶" name="accountId" defaultValue={item?.accountId || defaultAccountId}>
        {accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </SelectField>
      <SelectField label="狀態" name="status" defaultValue={item?.status || "unpaid"}><option value="unpaid">未付</option><option value="paid">已付</option></SelectField>
      <TextArea label="備註" name="notes" defaultValue={item?.notes || ""} wide />
    </>
  );
}

function ContractField({
  contracts,
  defaultContractId
}: {
  contracts: FinanceProjectSettings[];
  defaultContractId: string;
}) {
  const selectedContract =
    contracts.find((item) => item.id === defaultContractId) ||
    primaryFinanceContract(contracts);

  if (contracts.length <= 1) {
    return (
      <div className="text-sm">
        <div className="font-medium text-slate-700">所屬合約</div>
        <input type="hidden" name="contractId" value={selectedContract?.id || ""} />
        <div className="mt-1.5 rounded-md bg-stone-100 px-3 py-2.5 text-slate-600">
          {selectedContract?.name || "請先建立合約"}
        </div>
      </div>
    );
  }

  return (
    <SelectField
      label="所屬合約"
      name="contractId"
      defaultValue={selectedContract?.id || contracts[0].id}
    >
      {contracts.map((contract) => (
        <option key={contract.id} value={contract.id}>
          {contract.name}
          {contract.isPrimary ? "（主合約）" : ""}
        </option>
      ))}
    </SelectField>
  );
}

function AccountFields({ item }: { item?: FinanceAccount }) {
  return (
    <>
      <Field label="帳戶名稱" name="name" defaultValue={item?.name || ""} required />
      <Field label="期初餘額" name="openingBalance" type="number" defaultValue={item?.openingBalance || 0} />
      <CheckboxField label="設為案件收款預設帳戶" name="defaultForIncome" defaultChecked={item?.defaultForIncome || false} />
      <CheckboxField label="啟用帳戶" name="active" defaultChecked={item?.active !== false} />
      <TextArea label="備註" name="notes" defaultValue={item?.notes || ""} wide />
    </>
  );
}

function LedgerFields({ item, preset, accounts, defaultAccountId }: { item?: FinanceLedger; preset?: Partial<FinanceLedger>; accounts: FinanceAccount[]; defaultAccountId: string }) {
  return (
    <>
      <Field label="日期" name="date" type="date" defaultValue={item?.date || preset?.date || today()} required />
      <SelectField label="帳戶" name="accountId" defaultValue={item?.accountId || preset?.accountId || defaultAccountId}>
        {accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </SelectField>
      <SelectField label="類型" name="type" defaultValue={item?.type || preset?.type || "in"}><option value="in">入金</option><option value="out">出金</option></SelectField>
      <SelectField label="分類" name="category" defaultValue={item?.category || preset?.category || "其他"}>
        {["其他", "薪資", "水電費", "租金", "稅金", "保險", "會計費", "雜支"].map((value) => <option key={value}>{value}</option>)}
      </SelectField>
      <Field label="金額" name="amount" type="number" min="0" defaultValue={item?.amount || preset?.amount || 0} required />
      <Field label="項目" name="item" defaultValue={item?.item || preset?.item || ""} />
      <TextArea label="備註" name="notes" defaultValue={item?.notes || preset?.notes || ""} wide />
    </>
  );
}

async function submitFinanceModal(
  modal: Exclude<ModalState, null>,
  form: FormData,
  actor: ReturnType<typeof toAuditActor>,
  runAction: (action: () => Promise<unknown>, successMessage: string) => Promise<void>,
  data: FinanceData
) {
  if (modal.kind === "contract") {
    await runAction(
      () =>
        saveFinanceContract(
          modal.settings?.id || (modal.isPrimary ? modal.project.id : ""),
          {
            projectId: modal.project.id,
            name: text(form, "name"),
            code: text(form, "code"),
            address: text(form, "address"),
            contractAmount: amount(form, "contractAmount"),
            estimatedCost: amount(form, "estimatedCost"),
            startDate: text(form, "startDate"),
            status: text(form, "status") as FinanceProjectSettings["status"],
            isPrimary: modal.isPrimary,
            sortOrder: modal.sortOrder,
            notes: text(form, "notes")
          },
          actor
        ),
      modal.settings ? "合約資料已更新。" : "合約已建立。"
    );
    return;
  }
  if (modal.kind === "payment") {
    const contractId = text(form, "contractId") || modal.contractId;
    const contracts = projectFinanceContracts(data.projectSettings, modal.projectId);
    const status = text(form, "status") as FinancePayment["status"];
    const expectedAmount = amount(form, "expectedAmount");
    const receivedInput = amount(form, "receivedAmount");
    if (
      !confirmDuplicateFinanceEntry(
        data.payments.filter(
          (item) =>
            item.projectId === modal.projectId &&
            item.id !== modal.item?.id &&
            financeRecordBelongsToContract(item, contractId, contracts)
        ),
        text(form, "name"),
        expectedAmount,
        (item) => item.name,
        (item) => item.expectedAmount,
        "收款"
      )
    ) {
      return;
    }
    await runAction(
      () =>
        saveFinancePayment(
          modal.item?.id || "",
          {
            projectId: modal.projectId,
            contractId,
            name: text(form, "name"),
            dueDate: text(form, "dueDate"),
            paidDate: text(form, "paidDate"),
            expectedAmount,
            receivedAmount: status === "paid" && !receivedInput ? expectedAmount : receivedInput,
            accountId: text(form, "accountId"),
            status,
            notes: text(form, "notes"),
            source: modal.item?.source || "manual",
            sourceMessageId: modal.item?.sourceMessageId || ""
          },
          actor
        ),
      "收款已儲存，公司存簿已連動。"
    );
    return;
  }
  if (modal.kind === "adjustment") {
    const contractId = text(form, "contractId") || modal.contractId;
    const contracts = projectFinanceContracts(data.projectSettings, modal.projectId);
    if (
      !confirmDuplicateFinanceEntry(
        data.adjustments.filter(
          (item) =>
            item.projectId === modal.projectId &&
            item.id !== modal.item?.id &&
            financeRecordBelongsToContract(item, contractId, contracts)
        ),
        text(form, "name"),
        amount(form, "amount"),
        (item) => item.name,
        (item) => item.amount,
        "追加減"
      )
    ) {
      return;
    }
    await runAction(
      () =>
        saveFinanceAdjustment(
          modal.item?.id || "",
          {
            projectId: modal.projectId,
            contractId,
            date: text(form, "date"),
            type: text(form, "type") as FinanceAdjustment["type"],
            name: text(form, "name"),
            amount: amount(form, "amount"),
            notes: text(form, "notes"),
            source: modal.item?.source || "manual",
            sourceMessageId: modal.item?.sourceMessageId || ""
          },
          actor
        ),
      "追加減已儲存，合約總額已更新。"
    );
    return;
  }
  if (modal.kind === "cost") {
    const contractId = text(form, "contractId") || modal.contractId;
    const contracts = projectFinanceContracts(data.projectSettings, modal.projectId);
    if (
      !confirmDuplicateFinanceEntry(
        data.costs.filter(
          (item) =>
            item.projectId === modal.projectId &&
            item.id !== modal.item?.id &&
            financeRecordBelongsToContract(item, contractId, contracts)
        ),
        text(form, "item") || text(form, "category"),
        amount(form, "amount"),
        (item) => item.item || item.category,
        (item) => item.amount,
        "工程成本"
      )
    ) {
      return;
    }
    await runAction(
      () =>
        saveFinanceCost(
          modal.item?.id || "",
          {
            projectId: modal.projectId,
            contractId,
            category: text(form, "category"),
            item: text(form, "item"),
            vendor: text(form, "vendor"),
            date: text(form, "date"),
            amount: amount(form, "amount"),
            accountId: text(form, "accountId"),
            status: text(form, "status") as FinanceCost["status"],
            notes: text(form, "notes"),
            source: modal.item?.source || "manual",
            sourceMessageId: modal.item?.sourceMessageId || ""
          },
          actor
        ),
      "工程成本已儲存，公司存簿已連動。"
    );
    return;
  }
  if (modal.kind === "account") {
    await runAction(
      () =>
        saveFinanceAccount(
          modal.item?.id || "",
          {
            name: text(form, "name"),
            openingBalance: amount(form, "openingBalance"),
            notes: text(form, "notes"),
            defaultForIncome: form.get("defaultForIncome") === "on",
            active: form.get("active") === "on",
            sortOrder: modal.item?.sortOrder ?? data.accounts.length
          },
          actor
        ),
      "帳戶已儲存。"
    );
    return;
  }
  await runAction(
    () =>
      saveFinanceLedger(
        modal.item?.id || "",
        {
          date: text(form, "date"),
          accountId: text(form, "accountId"),
          type: text(form, "type") as FinanceLedger["type"],
          category: text(form, "category"),
          amount: amount(form, "amount"),
          item: text(form, "item"),
          notes: text(form, "notes")
        },
        actor
      ),
    "手動流水已儲存。"
  );
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden border border-stone-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div><h2 className="text-sm font-semibold text-slate-950">{title}</h2>{description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, icon: Icon, tone = "slate" }: { label: string; value: string; icon: typeof WalletCards; tone?: "slate" | "teal" | "amber" | "red" }) {
  const toneClass = { slate: "bg-slate-100 text-slate-700", teal: "bg-teal-50 text-teal-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700" }[tone];
  return (
    <div className="border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3"><span className="text-xs font-medium text-slate-500">{label}</span><span className={cn("flex h-8 w-8 items-center justify-center rounded-md", toneClass)}><Icon className="h-4 w-4" aria-hidden /></span></div>
      <div className="mt-3 truncate text-lg font-semibold text-slate-950" title={value}>{value}</div>
    </div>
  );
}

function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="min-w-full text-sm">{children}</table></div>;
}
function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return <th className={cn("whitespace-nowrap bg-stone-50 px-4 py-3 text-xs font-semibold text-slate-500", align === "right" ? "text-right" : "text-left")}>{children}</th>;
}
function Td({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return <td className={cn("whitespace-nowrap px-4 py-3 text-slate-600", align === "right" ? "text-right" : "text-left")}>{children}</td>;
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return <div className="flex justify-end gap-2"><IconButton label="編輯" icon={Pencil} onClick={onEdit} /><IconButton label="刪除" icon={Trash2} danger onClick={onDelete} /></div>;
}

function IconButton({ label, icon: Icon, onClick, danger = false, disabled = false }: { label: string; icon: typeof Pencil; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return <button className={cn("inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white disabled:cursor-not-allowed disabled:opacity-35", danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-300 text-slate-600 hover:bg-slate-50")} type="button" onClick={onClick} aria-label={label} title={label} disabled={disabled}><Icon className="h-4 w-4" aria-hidden /></button>;
}

function Field({ label, name, wide = false, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; wide?: boolean }) {
  return <label className={cn("text-sm font-medium text-slate-700", wide && "sm:col-span-2")}>{label}<input {...props} name={name} className={inputClass} /></label>;
}
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="text-sm"><div className="font-medium text-slate-700">{label}</div><div className="mt-1.5 rounded-md bg-stone-100 px-3 py-2.5 text-slate-600">{value || "—"}</div></div>;
}
function TextArea({ label, name, defaultValue, wide = false }: { label: string; name: string; defaultValue: string; wide?: boolean }) {
  return <label className={cn("text-sm font-medium text-slate-700", wide && "sm:col-span-2")}>{label}<textarea name={name} className={cn(inputClass, "min-h-24 resize-y")} defaultValue={defaultValue} /></label>;
}
function SelectField({ label, name, defaultValue, children }: { label: string; name: string; defaultValue: string; children: ReactNode }) {
  return <label className="text-sm font-medium text-slate-700">{label}<select name={name} className={inputClass} defaultValue={defaultValue}>{children}</select></label>;
}
function CheckboxField({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return <label className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-3 text-sm font-medium text-slate-700"><input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-teal-700" />{label}</label>;
}
function DataCount({ label, value }: { label: string; value: number }) {
  return <div className="border-b border-stone-100 pb-2"><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{value}</dd></div>;
}

const inputClass = "mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value) || 0);
}
function percent(value: number) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 1000) / 10}%`;
}
function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}
function text(form: FormData, name: string) {
  return String(form.get(name) || "").trim();
}
function amount(form: FormData, name: string) {
  const value = Number(form.get(name));
  return Number.isFinite(value) ? value : 0;
}
function paymentStatusLabel(status: FinancePayment["status"]) {
  return status === "paid" ? "已收" : status === "partial" ? "部分收" : "未收";
}
function draftTypeLabel(type: FinanceDraft["draftType"]) {
  if (type === "adjustment_add") return "追加";
  if (type === "adjustment_deduct") return "減項";
  if (type === "cost") return "工程成本";
  return "案件收款";
}
function modalTitle(modal: Exclude<ModalState, null>) {
  if (modal.kind === "contract") return modal.settings ? "編輯合約" : modal.isPrimary ? "新增主合約" : "新增合約";
  if (modal.kind === "payment") return modal.item ? "編輯收款" : "新增收款";
  if (modal.kind === "adjustment") return modal.item ? "編輯追加減" : "新增追加減";
  if (modal.kind === "cost") return modal.item ? "編輯成本" : "新增成本";
  if (modal.kind === "account") return modal.item ? "編輯帳戶" : "新增帳戶";
  return modal.item ? "編輯手動流水" : "手動入出金";
}

function financeContractName(
  record: { contractId: string },
  contracts: FinanceProjectSettings[]
) {
  const contractId = record.contractId || primaryFinanceContract(contracts)?.id || "";
  return contracts.find((item) => item.id === contractId)?.name || "主合約";
}
function csvCell(value: string) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}
function downloadFile(name: string, content: string, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
function isFinanceBackup(value: unknown): value is FinanceData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FinanceData>;
  return ["projectSettings", "accounts", "payments", "adjustments", "costs", "ledger", "drafts"].every(
    (key) => Array.isArray(candidate[key as keyof FinanceData])
  );
}
function parseBankCsv(text: string): BankRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.trim().toLowerCase());
  const dateIndex = findHeader(headers, ["日期", "交易日期", "date"]);
  const inIndex = findHeader(headers, ["存入", "收入", "入金", "deposit", "credit"]);
  const outIndex = findHeader(headers, ["提出", "支出", "出金", "withdraw", "debit"]);
  const typeIndex = findHeader(headers, ["類型", "type"]);
  const amountIndex = findHeader(headers, ["金額", "amount"]);
  const noteIndex = findHeader(headers, ["摘要", "備註", "說明", "description", "memo"]);

  return lines.slice(1).flatMap((line, index) => {
    const cells = splitCsvLine(line);
    const incoming = inIndex >= 0 ? parseMoney(cells[inIndex]) : 0;
    const outgoing = outIndex >= 0 ? parseMoney(cells[outIndex]) : 0;
    const genericAmount = amountIndex >= 0 ? parseMoney(cells[amountIndex]) : 0;
    const typeText = typeIndex >= 0 ? String(cells[typeIndex] || "").toLowerCase() : "";
    const type: "in" | "out" = outgoing || /出|支|out|debit/.test(typeText) ? "out" : "in";
    const rowAmount = outgoing || incoming || genericAmount;
    if (!rowAmount) return [];
    return [{ id: `bank-${index}`, date: normalizeDate(cells[dateIndex]), type, amount: rowAmount, note: noteIndex >= 0 ? String(cells[noteIndex] || "").trim() : "" }];
  });
}
function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else { quoted = !quoted; }
    } else if (char === "," && !quoted) { values.push(current); current = ""; } else { current += char; }
  }
  values.push(current);
  return values;
}
function findHeader(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.some((name) => header.includes(name)));
}
function parseMoney(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}
function normalizeDate(value: string | undefined) {
  const raw = String(value || "").trim().replaceAll("/", "-");
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : raw;
}

function confirmDuplicateFinanceEntry<T>(
  entries: T[],
  name: string,
  entryAmount: number,
  getName: (item: T) => string,
  getAmount: (item: T) => number,
  label: string
) {
  const normalizedName = name.trim().replace(/\s+/g, "").toLowerCase();
  const sameName = normalizedName
    ? entries.filter((item) => getName(item).trim().replace(/\s+/g, "").toLowerCase() === normalizedName)
    : [];
  const sameAmount = entryAmount ? entries.filter((item) => Number(getAmount(item)) === entryAmount) : [];
  if (!sameName.length && !sameAmount.length) return true;

  const warnings = [`同一案件可能已有重複${label}：`];
  if (sameName.length) warnings.push(`名稱相同：${name || "未命名項目"}`);
  if (sameAmount.length) warnings.push(`金額相同：${money(entryAmount)}`);
  warnings.push("仍要儲存嗎？");
  return window.confirm(warnings.join("\n"));
}
