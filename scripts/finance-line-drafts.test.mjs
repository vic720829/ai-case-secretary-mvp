import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { analyzeFinanceMessage } from "../src/lib/financeMessageRules.ts";

const paymentWithAddition = analyzeFinanceMessage(
  "已收到 水電進場款 600000 元，追加 20000，共 620000 元整"
);
assert.equal(paymentWithAddition.length, 1);
assert.equal(paymentWithAddition[0].draftType, "payment");
assert.equal(paymentWithAddition[0].title, "水電進場款");
assert.equal(paymentWithAddition[0].amount, 600000);
assert.equal(paymentWithAddition[0].totalAmount, 620000);
assert.equal(paymentWithAddition[0].amountMismatch, false);
assert.deepEqual(paymentWithAddition[0].adjustments, [
  { type: "add", name: "", amount: 20000 }
]);

const paymentWithDeduction = analyzeFinanceMessage(
  "已收到 水電進場款 30萬，減項 2萬，共 28萬元"
);
assert.equal(paymentWithDeduction.length, 1);
assert.equal(paymentWithDeduction[0].amount, 300000);
assert.equal(paymentWithDeduction[0].totalAmount, 280000);
assert.deepEqual(paymentWithDeduction[0].adjustments, [
  { type: "deduct", name: "", amount: 20000 }
]);

const calculatedTotal = analyzeFinanceMessage("收到 木工進場款 30萬 追加系統櫃 2萬");
assert.equal(calculatedTotal.length, 1);
assert.equal(calculatedTotal[0].totalAmount, 320000);
assert.deepEqual(calculatedTotal[0].adjustments, [
  { type: "add", name: "系統櫃", amount: 20000 }
]);

const standaloneAdjustment = analyzeFinanceMessage("追加 系統櫃抽屜 25000元");
assert.equal(standaloneAdjustment.length, 1);
assert.equal(standaloneAdjustment[0].draftType, "adjustment_add");
assert.equal(standaloneAdjustment[0].title, "系統櫃抽屜");
assert.equal(standaloneAdjustment[0].amount, 25000);

const paidCost = analyzeFinanceMessage("已付 木工師傅 15萬元");
assert.equal(paidCost.length, 1);
assert.equal(paidCost[0].draftType, "cost");
assert.equal(paidCost[0].amount, 150000);

assert.deepEqual(analyzeFinanceMessage("水電進場款 60萬元"), []);
assert.deepEqual(analyzeFinanceMessage("收到水電進場款 60萬元了嗎？"), []);
assert.deepEqual(analyzeFinanceMessage("還沒收到水電進場款 60萬元"), []);
assert.deepEqual(analyzeFinanceMessage("客戶說明天會匯款"), []);

const mismatch = analyzeFinanceMessage("已收到 工程款 30萬，追加 2萬，共 35萬");
assert.equal(mismatch.length, 1);
assert.equal(mismatch[0].amountMismatch, true);

const rootDir = process.cwd();
const handlerSource = fs.readFileSync(
  path.join(rootDir, "src", "app", "api", "line", "webhook", "handler.ts"),
  "utf8"
);
const financeServiceSource = fs.readFileSync(
  path.join(rootDir, "src", "services", "financeLineDrafts.ts"),
  "utf8"
);

assert.match(
  handlerSource,
  /shouldAnalyzeProjectConversation\s*&&\s*senderRole\s*===\s*"internal"/,
  "finance drafts must only be created for known internal members in a bound project group"
);
assert.doesNotMatch(
  financeServiceSource,
  /replyLineText|pushLineMessages|services\/line/,
  "finance draft creation must never reply or push into the customer group"
);

console.log("Finance LINE draft tests passed.");
