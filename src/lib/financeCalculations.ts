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
  actualProfit: number;
  estimatedCost: number;
  estimatedProfit: number;
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
  const costsTotal = costs.reduce((sum, item) => sum + Math.max(Number(item.amount) || 0, 0), 0);
  const paidCosts = costs.reduce((sum, item) => sum + paidCostAmount(item), 0);
  const unpaidCosts = Math.max(costsTotal - paidCosts, 0);
  const estimatedCost = Math.max(Number(settings?.estimatedCost) || Math.round(contract * 0.6), 0);

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
    profit: contract - costsTotal,
    actualProfit: contract - paidCosts,
    estimatedCost,
    estimatedProfit: contract - estimatedCost,
    futureCash: receivable - unpaidCosts
  };
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
