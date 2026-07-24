import assert from "node:assert/strict";
import { projectFinanceTotals } from "../src/lib/financeCalculations.ts";

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
    }
  ]
);

assert.equal(futureCashTotals.estimatedCostRemaining, 400000);
assert.equal(futureCashTotals.estimatedProfit, 600000);
assert.equal(futureCashTotals.estimatedProfitRate, 0.6);
assert.equal(futureCashTotals.futureCash, 200000);

console.log("Finance calculation tests passed.");
