import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, "src", "services", "lineAdminGroups.ts");
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

const { canReceiveAdminNotification, normalizeAdminNotificationLevel } = moduleContext.module.exports;

assert.equal(typeof canReceiveAdminNotification, "function");
assert.equal(typeof normalizeAdminNotificationLevel, "function");

assert.equal(canReceiveAdminNotification("primary", "primary"), true);
assert.equal(canReceiveAdminNotification("secondary", "primary"), false);
assert.equal(canReceiveAdminNotification("critical_only", "primary"), false);
assert.equal(canReceiveAdminNotification("test", "primary"), false);
assert.equal(canReceiveAdminNotification("none", "primary"), false);

assert.equal(canReceiveAdminNotification("primary", "daily"), true);
assert.equal(canReceiveAdminNotification("secondary", "daily"), true);
assert.equal(canReceiveAdminNotification("critical_only", "daily"), false);
assert.equal(canReceiveAdminNotification("test", "daily"), false);
assert.equal(canReceiveAdminNotification("none", "daily"), false);

assert.equal(canReceiveAdminNotification("primary", "critical"), true);
assert.equal(canReceiveAdminNotification("secondary", "critical"), true);
assert.equal(canReceiveAdminNotification("critical_only", "critical"), true);
assert.equal(canReceiveAdminNotification("test", "critical"), false);
assert.equal(canReceiveAdminNotification("none", "critical"), false);

assert.equal(normalizeAdminNotificationLevel("secondary"), "secondary");
assert.equal(normalizeAdminNotificationLevel("bad-value"), "primary");
assert.equal(normalizeAdminNotificationLevel(undefined), "primary");

console.log("LINE notification routing tests passed.");
