import assert from "node:assert/strict";
import {
  buildFinanceAccountEntries,
  financeRecordBelongsToContract,
  totalFinanceAccountBalance,
  projectFinanceTotals,
  projectFinanceTotalsForContracts
} from "../src/lib/financeCalculations.ts";

const payment = {
  id: "payment-1",
  projectId: "project-1",
  name: "本期工程款",
  dueDate: "2026-07-24",
  paidDate: "2026-07-24",
  expectedAmount: 300000,
  receivedAmount: 300000,
  accountId: "account-1",
  status: "paid",
  notes: "",
  source: "manual",
  sourceMessageId: "",
  createdAt: null,
  updatedAt: null
};

const additionTotals = projectFinanceTotals(
  { projectId: "project-1", contractAmount: 300000, estimatedCost: 0, notes: "", createdAt: null, updatedAt: null },
  [payment],
  [
    {
      id: "addition-1",
      projectId: "project-1",
      date: "2026-07-24",
      type: "add",
      name: "追加項目",
      amount: 20000,
      notes: "",
      source: "manual",
      sourceMessageId: "",
      createdAt: null,
      updatedAt: null
    }
  ],
  []
);

assert.equal(additionTotals.received, 320000);

const deductionTotals = projectFinanceTotals(
  { projectId: "project-1", contractAmount: 300000, estimatedCost: 0, notes: "", createdAt: null, updatedAt: null },
  [payment],
  [
    {
      id: "deduction-1",
      projectId: "project-1",
      date: "2026-07-24",
      type: "deduct",
      name: "減項",
      amount: 20000,
      notes: "",
      source: "manual",
      sourceMessageId: "",
      createdAt: null,
      updatedAt: null
    }
  ],
  []
);

assert.equal(deductionTotals.received, 280000);

const futureCashTotals = projectFinanceTotals(
  { projectId: "project-1", contractAmount: 1000000, estimatedCost: 600000, notes: "", createdAt: null, updatedAt: null },
  [{ ...payment, expectedAmount: 400000, receivedAmount: 400000 }],
  [],
  [
    {
      id: "cost-1",
      projectId: "project-1",
      category: "工程成本",
      item: "已付工程款",
      vendor: "廠商",
      date: "2026-07-24",
      amount: 200000,
      accountId: "account-1",
      status: "paid",
      notes: "",
      source: "manual",
      sourceMessageId: "",
      createdAt: null,
      updatedAt: null
    },
    {
      id: "cost-2",
      projectId: "project-1",
      category: "工程成本",
      item: "尚未支付工程款",
      vendor: "廠商",
      date: "2026-07-25",
      amount: 100000,
      accountId: "",
      status: "unpaid",
      notes: "",
      source: "manual",
      sourceMessageId: "",
      createdAt: null,
      updatedAt: null
    }
  ]
);

assert.equal(futureCashTotals.paidCosts, 200000);
assert.equal(futureCashTotals.unpaidCosts, 100000);
assert.equal(futureCashTotals.profit, 700000);
assert.equal(futureCashTotals.profitRate, 0.7);
assert.equal(futureCashTotals.estimatedCostRemaining, 400000);
assert.equal(futureCashTotals.estimatedProfit, 600000);
assert.equal(futureCashTotals.estimatedProfitRate, 0.6);
assert.equal(futureCashTotals.futureCash, 500000);

const accountEntries = buildFinanceAccountEntries({
  projectSettings: [],
  accounts: [],
  payments: [
    {
      ...payment,
      receivedAmount: 300000,
      accountId: "account-1"
    }
  ],
  adjustments: [],
  costs: [
    {
      id: "paid-cost",
      projectId: "project-1",
      category: "工程成本",
      item: "材料款",
      vendor: "廠商",
      date: "2026-07-24",
      amount: 50000,
      accountId: "account-2",
      status: "paid",
      notes: "",
      source: "manual",
      sourceMessageId: "",
      createdAt: null,
      updatedAt: null
    }
  ],
  ledger: [],
  drafts: []
});

assert.equal(
  totalFinanceAccountBalance(
    [
      { id: "account-1", name: "帳戶一", openingBalance: 100000 },
      { id: "account-2", name: "帳戶二", openingBalance: 200000 }
    ],
    accountEntries
  ),
  550000
);

const contracts = [
  {
    id: "project-1",
    projectId: "project-1",
    name: "裝修主合約",
    code: "C-001",
    address: "",
    contractAmount: 300000,
    estimatedCost: 180000,
    startDate: "2026-07-01",
    status: "active",
    isPrimary: true,
    sortOrder: 0,
    notes: "",
    createdAt: null,
    updatedAt: null
  },
  {
    id: "contract-2",
    projectId: "project-1",
    name: "系統櫃合約",
    code: "C-002",
    address: "",
    contractAmount: 200000,
    estimatedCost: 100000,
    startDate: "2026-07-10",
    status: "active",
    isPrimary: false,
    sortOrder: 1,
    notes: "",
    createdAt: null,
    updatedAt: null
  }
];
const legacyPayment = { ...payment, contractId: "" };
const subcontractPayment = {
  ...payment,
  id: "payment-2",
  contractId: "contract-2",
  expectedAmount: 100000,
  receivedAmount: 100000
};
const subcontractAddition = {
  id: "addition-2",
  projectId: "project-1",
  contractId: "contract-2",
  date: "2026-07-24",
  type: "add",
  name: "系統櫃追加",
  amount: 20000,
  notes: "",
  source: "manual",
  sourceMessageId: "",
  createdAt: null,
  updatedAt: null
};
const multiContractTotals = projectFinanceTotalsForContracts(
  contracts,
  [legacyPayment, subcontractPayment],
  [subcontractAddition],
  []
);

assert.equal(financeRecordBelongsToContract(legacyPayment, "project-1", contracts), true);
assert.equal(financeRecordBelongsToContract(legacyPayment, "contract-2", contracts), false);
assert.equal(multiContractTotals.contract, 520000);
assert.equal(multiContractTotals.received, 420000);
assert.equal(multiContractTotals.estimatedCost, 280000);

console.log("Finance calculation tests passed.");
