import assert from "node:assert/strict";
import { drawingReviewRules, DRAWING_REVIEW_RULE_SET_VERSION } from "../src/lib/drawingReviewRules.ts";

assert.equal(DRAWING_REVIEW_RULE_SET_VERSION, "company-v1.1");
assert.equal(drawingReviewRules.length, 54);
assert.equal(new Set(drawingReviewRules.map((rule) => rule.code)).size, drawingReviewRules.length);

for (const rule of drawingReviewRules) {
  assert.ok(rule.code, "每條規則都必須有編號");
  assert.ok(rule.title, `${rule.code} 必須有名稱`);
  assert.ok(rule.check, `${rule.code} 必須有檢查內容`);
  assert.ok(["fatal", "warning", "insufficient"].includes(rule.severity), `${rule.code} 嚴重度不正確`);
}

assert.match(drawingReviewRules.find((rule) => rule.code === "DESK-HEIGHT-001")?.check ?? "", /760 mm/);
assert.match(drawingReviewRules.find((rule) => rule.code === "WARDROBE-HINGED-001")?.check ?? "", /600 mm/);
assert.match(drawingReviewRules.find((rule) => rule.code === "WARDROBE-SLIDING-001")?.check ?? "", /650 mm/);
assert.equal(drawingReviewRules.find((rule) => rule.code === "WOOD-FLOOR-001")?.severity, "warning");
assert.match(drawingReviewRules.find((rule) => rule.code === "SHOE-CABINET-001")?.appliesWhen ?? "", /350–379 mm/);
assert.match(drawingReviewRules.find((rule) => rule.code === "SHOE-CABINET-001")?.check ?? "", /380 mm/);
assert.match(drawingReviewRules.find((rule) => rule.code === "SHOE-CABINET-002")?.appliesWhen ?? "", /小於 350 mm/);
assert.equal(drawingReviewRules.find((rule) => rule.code === "SHOE-CABINET-002")?.severity, "insufficient");
assert.ok(drawingReviewRules.every((rule) => rule.category && rule.appliesWhen));

console.log("Drawing review rule contract tests passed.");
