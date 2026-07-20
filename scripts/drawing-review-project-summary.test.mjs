import assert from "node:assert/strict";
import { buildDrawingProjectSummarySnapshot } from "../src/lib/drawingReviewProjectSummary.ts";

const snapshot = buildDrawingProjectSummarySnapshot({
  summaryText: "  客戶希望玄關設置雨傘收納。  ",
  sections: [
    { title: "客戶需求整理", items: ["玄關設置雨傘收納", "客廳使用電動窗簾"] },
    { title: "", items: ["不應保留"] }
  ],
  source: "ai",
  model: "gpt-test",
  refreshedBy: "Vic",
  updatedAt: { toDate: () => new Date("2026-07-20T01:02:03.000Z") }
});

assert.ok(snapshot);
assert.equal(snapshot.summaryText, "客戶希望玄關設置雨傘收納。");
assert.equal(snapshot.sections.length, 1);
assert.deepEqual(snapshot.sections[0].items, ["玄關設置雨傘收納", "客廳使用電動窗簾"]);
assert.equal(snapshot.source, "ai");
assert.equal(snapshot.sourceUpdatedAt, "2026-07-20T01:02:03.000Z");

assert.equal(buildDrawingProjectSummarySnapshot({ summaryText: "", sections: [] }), null);
assert.equal(buildDrawingProjectSummarySnapshot(null), null);

console.log("drawing review project summary tests passed");
