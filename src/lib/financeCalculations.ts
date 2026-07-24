import type {
  FinanceAccount,
  FinanceAdjustment,
  FinanceCost,
  FinanceData,
  FinanceLedger,
  FinancePayment,
  FinanceProjectSettings
} from "./types";

export type FinanceProjectTotals = {
  baseContract: number;
  additions: number;
  deductions: number;
  contract: number;
  received: number;
  receivable: number;
  costs: number;
  paidCosts: number;
  unpaidCosts: number;
  profit: number;
  profitRate: number;
  estimatedCost: number;
  estimatedCostRemaining: number;
  estimatedProfit: number;
  estimatedProfitRate: number;
  futureCash: number;
};

export type FinanceAccountEntry = {
  id: string;
  date: string;
  accountId: string;
  type: "in" | "out";
  category: string;
  projectId: string;
  item: string;
  amount: number;
  notes: string;
  source: "payment" | "cost" | "manual";
};

export function paymentReceivedAmount(payment: FinancePayment) {
  return payment.status === "unpaid" ? 0 : Math.max(Number(payment.receivedAmount) || 0, 0);
}

export function paidCostAmount(cost: FinanceCost) {
  return cost.status === "paid" ? Math.max(Number(cost.amount) || 0, 0) : 0;
}

export function projectFinanceTotals(
  settings: FinanceProjectSettings | undefined,
  payments: FinancePayment[],
  adjustments: FinanceAdjustment[],
  costs: FinanceCost[]
): FinanceProjectTotals {
  const baseContract = Math.max(Number(settings?.contractAmount) || 0, 0);
  const additions = adjustments.reduce(
    (sum, item) => sum + (item.type === "add" ? Math.max(Number(item.amount) || 0, 0) : 0),
    0
  );
  const deductions = adjustments.reduce(
    (sum, item) => sum + (item.type === "deduct" ? Math.max(Number(item.amount) || 0, 0) : 0),
    0
  );
  const contract = Math.max(baseContract + additions - deductions, 0);
  const paymentReceived = payments.reduce((sum, item) => sum + paymentReceivedAmount(item), 0);
  const received = Math.max(paymentReceived + additions - deductions, 0);
  const receivable = Math.max(contract - received, 0);
  const paidCosts = costs.reduce((sum, item) => sum + paidCostAmount(item), 0);
  const unpaidCosts = costs.reduce(
    (sum, item) =>
      sum + (item.status === "unpaid" ? Math.max(Number(item.amount) || 0, 0) : 0),
    0
  );
  const costsTotal = paidCosts + unpaidCosts;
  const profit = contract - unpaidCosts - paidCosts;
  const estimatedCost = Math.max(Number(settings?.estimatedCost) || Math.round(contract * 0.6), 0);
  const estimatedCostRemaining = estimatedCost - paidCosts;
  const estimatedProfit = contract - estimatedCostRemaining;

  return {
    baseContract,
    additions,
    deductions,
    contract,
    received,
    receivable,
    costs: costsTotal,
    paidCosts,
    unpaidCosts,
    profit,
    profitRate: contract ? profit / contract : 0,
    estimatedCost,
    estimatedCostRemaining,
    estimatedProfit,
    estimatedProfitRate: contract ? estimatedProfit / contract : 0,
    futureCash: receivable - estimatedCostRemaining
  };
}

export function projectFinanceContracts(
  settings: FinanceProjectSettings[],
  projectId: string
) {
  return settings
    .filter((item) => item.projectId === projectId)
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.sortOrder - b.sortOrder ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
        a.name.localeCompare(b.name, "zh-Hant")
    );
}

export function primaryFinanceContract(contracts: FinanceProjectSettings[]) {
  return (
    contracts.find((item) => item.isPrimary) ||
    contracts.find((item) => item.id === item.projectId) ||
    contracts[0]
  );
}

export function resolvedFinanceContractId(
  record: { contractId: string },
  contracts: FinanceProjectSettings[]
) {
  return record.contractId || primaryFinanceContract(contracts)?.id || "";
}

export function financeRecordBelongsToContract(
  record: { contractId: string },
  contractId: string,
  contracts: FinanceProjectSettings[]
) {
  return resolvedFinanceContractId(record, contracts) === contractId;
}

export function projectFinanceTotalsForContracts(
  contracts: FinanceProjectSettings[],
  payments: FinancePayment[],
  adjustments: FinanceAdjustment[],
  costs: FinanceCost[]
) {
  if (!contracts.length) {
    return projectFinanceTotals(undefined, payments, adjustments, costs);
  }

  const contractAmount = contracts.reduce(
    (sum, item) => sum + Math.max(Number(item.contractAmount) || 0, 0),
    0
  );
  const estimatedCost = contracts.reduce(
    (sum, item) =>
      sum +
      Math.max(
        Number(item.estimatedCost) || Math.round(Math.max(Number(item.contractAmount) || 0, 0) * 0.6),
        0
      ),
    0
  );

  return projectFinanceTotals(
    {
      id: "all",
      projectId: contracts[0].projectId,
      name: "全部合約",
      code: "",
      address: "",
      contractAmount,
      estimatedCost,
      startDate: "",
      status: "active",
      isPrimary: false,
      sortOrder: 0,
      notes: "",
      createdAt: null,
      updatedAt: null
    },
    payments,
    adjustments,
    costs
  );
}

export function buildFinanceAccountEntries(data: Pick<FinanceData, "payments" | "costs" | "ledger">) {
  const paymentEntries = data.payments
    .map((payment): FinanceAccountEntry | null => {
      const amount = paymentReceivedAmount(payment);
      if (!amount) return null;

      return {
        id: `payment:${payment.id}`,
        date: payment.paidDate || payment.dueDate,
        accountId: payment.accountId,
        type: "in",
        category: "案件收款",
        projectId: payment.projectId,
        item: payment.name,
        amount,
        notes: payment.notes,
        source: "payment"
      };
    })
    .filter((item): item is FinanceAccountEntry => Boolean(item));
  const costEntries = data.costs
    .map((cost): FinanceAccountEntry | null => {
      const amount = paidCostAmount(cost);
      if (!amount) return null;

      return {
        id: `cost:${cost.id}`,
        date: cost.date,
        accountId: cost.accountId,
        type: "out",
        category: "案件成本",
        projectId: cost.projectId,
        item: cost.item || cost.category,
        amount,
        notes: cost.notes,
        source: "cost"
      };
    })
    .filter((item): item is FinanceAccountEntry => Boolean(item));
  const manualEntries = data.ledger.map(
    (entry): FinanceAccountEntry => ({
      id: `manual:${entry.id}`,
      date: entry.date,
      accountId: entry.accountId,
      type: entry.type,
      category: entry.category,
      projectId: "",
      item: entry.item,
      amount: Math.max(Number(entry.amount) || 0, 0),
      notes: entry.notes,
      source: "manual"
    })
  );

  return [...paymentEntries, ...costEntries, ...manualEntries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
  );
}

export function financeAccountBalance(account: FinanceAccount, entries: FinanceAccountEntry[]) {
  return entries
    .filter((entry) => entry.accountId === account.id)
    .reduce(
      (balance, entry) => balance + (entry.type === "in" ? entry.amount : -entry.amount),
      Number(account.openingBalance) || 0
    );
}

export function ledgerRecordName(entry: FinanceLedger) {
  return entry.item || entry.category || "手動流水";
}
