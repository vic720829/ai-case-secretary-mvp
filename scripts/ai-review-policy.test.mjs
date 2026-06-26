import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, "src", "lib", "aiReviewPolicy.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const moduleContext = {
  exports: {},
  module: { exports: {} }
};

moduleContext.exports = moduleContext.module.exports;
vm.runInNewContext(compiled, moduleContext, { filename: sourcePath });

const { canReviewAiDraft, getAiReviewBlockedReason } = moduleContext.module.exports;

assert.equal(typeof canReviewAiDraft, "function");
assert.equal(typeof getAiReviewBlockedReason, "function");

assert.equal(canReviewAiDraft("pending"), true, "pending draft can be reviewed once");
assert.equal(canReviewAiDraft("approved"), false, "approved draft cannot be approved again");
assert.equal(canReviewAiDraft("rejected"), false, "rejected draft cannot be approved later");
assert.equal(canReviewAiDraft(""), false, "unknown review status must be blocked");

assert.match(
  getAiReviewBlockedReason("approved", "approve"),
  /cannot be approved again/,
  "second approve must be blocked"
);

assert.match(
  getAiReviewBlockedReason("approved", "reject"),
  /cannot be rejected again/,
  "reject after approve must be blocked"
);

assert.match(
  getAiReviewBlockedReason("rejected", "approve"),
  /cannot be approved again/,
  "approve after reject must be blocked"
);

const draft = { reviewStatus: "pending", taskCount: 0 };

if (canReviewAiDraft(draft.reviewStatus)) {
  draft.reviewStatus = "approved";
  draft.taskCount += 1;
}

if (canReviewAiDraft(draft.reviewStatus)) {
  draft.reviewStatus = "approved";
  draft.taskCount += 1;
}

assert.equal(draft.reviewStatus, "approved", "first approve wins");
assert.equal(draft.taskCount, 1, "second approve must not create another task");

console.log("AI review policy safety tests passed.");
