import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();

function loadTsModule(relativePath, requireMap = {}) {
  const sourcePath = path.join(rootDir, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const moduleContext = {
    exports: {},
    module: { exports: {} },
    require: (id) => {
      if (id in requireMap) return requireMap[id];
      throw new Error(`Unexpected require: ${id}`);
    }
  };

  moduleContext.exports = moduleContext.module.exports;
  vm.runInNewContext(compiled, moduleContext, { filename: sourcePath });

  return moduleContext.module.exports;
}

const riskRules = loadTsModule(path.join("src", "lib", "riskRules.ts"));
const policy = loadTsModule(path.join("src", "lib", "lineNotificationPolicy.ts"), {
  "./riskRules": riskRules
});

const {
  getAiTaskRiskLevel,
  hasComplaintOrRepairRisk
} = riskRules;
const {
  getAiDraftImmediateNotificationAudience,
  shouldNotifyAiDraftsImmediately,
  shouldNotifyMergedAiTasksImmediately,
  getMergedAiTaskImmediateNotificationAudience
} = policy;

assert.equal(hasComplaintOrRepairRisk("這邊有缺失要修補"), true);
assert.equal(getAiTaskRiskLevel("followup", "這邊有缺失要修補"), "critical");
assert.equal(getAiTaskRiskLevel("complaint", "品質不好"), "critical");
assert.equal(getAiTaskRiskLevel("change", "客戶想改顏色"), "high");

const normalSuggestion = [{ title: "客戶詢問工期表", taskType: "followup" }];
const criticalSuggestion = [{ title: "客戶說這邊有缺失要修補", taskType: "followup" }];

assert.equal(
  getAiDraftImmediateNotificationAudience(normalSuggestion),
  null,
  "normal customer messages should wait for delayed reminder instead of immediate push"
);
assert.equal(
  getAiDraftImmediateNotificationAudience(criticalSuggestion),
  "critical",
  "complaint or repair messages must notify critical audience immediately"
);

assert.equal(
  shouldNotifyAiDraftsImmediately({
    result: { draftIds: ["draft1"], newDraftIds: ["draft1"] },
    suggestions: normalSuggestion
  }),
  false,
  "new normal drafts should not immediately notify admin groups"
);
assert.equal(
  shouldNotifyAiDraftsImmediately({
    result: { draftIds: ["draft1"], newDraftIds: ["draft1"] },
    suggestions: criticalSuggestion
  }),
  true,
  "new critical drafts should immediately notify admin groups"
);
assert.equal(
  shouldNotifyAiDraftsImmediately({
    result: { draftIds: ["draft1"], newDraftIds: [] },
    suggestions: criticalSuggestion,
    reusableDraftAlreadyNotified: true
  }),
  false,
  "critical reusable drafts already notified should respect cooldown-style suppression"
);

assert.equal(
  shouldNotifyMergedAiTasksImmediately([{ title: "客戶詢問工期表", taskType: "followup" }]),
  false,
  "merged normal events should not push immediately"
);
assert.equal(
  shouldNotifyMergedAiTasksImmediately([{ title: "客戶說品質不好要修補", taskType: "followup" }]),
  true,
  "merged critical events should push a merged summary immediately"
);
assert.equal(
  getMergedAiTaskImmediateNotificationAudience([{ title: "客戶說品質不好要修補", taskType: "followup" }]),
  "critical"
);

console.log("LINE notification policy tests passed.");
