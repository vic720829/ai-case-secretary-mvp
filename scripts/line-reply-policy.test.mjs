import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, "src", "lib", "lineReplyPolicy.ts");
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

const { canLineGroupUseAssistantReplies, canReplyInLineChat } = moduleContext.module.exports;

assert.equal(typeof canLineGroupUseAssistantReplies, "function");
assert.equal(typeof canReplyInLineChat, "function");

const customerQuestionTexts = ["說明", "今天工期是什麼？", "有缺失要處理的嗎？", "我的工期表呢？"];

for (const text of customerQuestionTexts) {
  assert.equal(
    canReplyInLineChat({
      groupType: "project",
      allowAssistantReplies: false,
      sourceType: "group",
      text
    }),
    false,
    `project customer group must never receive assistant replies: ${text}`
  );
}

assert.equal(
  canReplyInLineChat({
    groupType: "project",
    allowAssistantReplies: true,
    sourceType: "group"
  }),
  false,
  "project group must stay silent even if allowAssistantReplies is accidentally true"
);

assert.equal(
  canReplyInLineChat({
    groupType: "",
    allowAssistantReplies: true,
    sourceType: "group"
  }),
  false,
  "unbound group must stay silent"
);

assert.equal(
  canReplyInLineChat({
    groupType: "admin",
    allowAssistantReplies: false,
    sourceType: "group"
  }),
  false,
  "admin group with replies disabled must stay silent"
);

assert.equal(
  canReplyInLineChat({
    groupType: "admin",
    allowAssistantReplies: true,
    sourceType: "group"
  }),
  true,
  "admin group with replies enabled can receive assistant replies"
);

assert.equal(
  canReplyInLineChat({
    groupType: "admin",
    allowAssistantReplies: undefined,
    sourceType: "group"
  }),
  true,
  "admin group defaults to replies enabled unless explicitly disabled"
);

assert.equal(
  canReplyInLineChat({
    groupType: "admin",
    allowAssistantReplies: true,
    sourceType: "user"
  }),
  false,
  "one-on-one user chat must stay silent"
);

console.log("LINE reply policy safety tests passed.");
