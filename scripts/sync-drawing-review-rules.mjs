import { execFileSync } from "node:child_process";
import {
  DRAWING_REVIEW_RULE_SET_VERSION,
  drawingReviewRules
} from "../src/lib/drawingReviewRules.ts";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "ai-super-ba7f4";
const databaseRoot = `projects/${projectId}/databases/(default)/documents`;
const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`;

const accessToken = process.env.FIRESTORE_ACCESS_TOKEN || readGcloudAccessToken();
const ruleSet = {
  version: DRAWING_REVIEW_RULE_SET_VERSION,
  name: "宇亮寬宏施工圖審查規則 v1.1",
  status: "active",
  ruleCount: drawingReviewRules.length,
  ruleCodes: drawingReviewRules.map((rule) => rule.code)
};

const documents = [
  {
    name: `${databaseRoot}/drawing_rule_sets/${DRAWING_REVIEW_RULE_SET_VERSION}`,
    fields: toFirestoreFields(ruleSet)
  },
  ...drawingReviewRules.map((rule, index) => ({
    name: `${databaseRoot}/drawing_rules/${DRAWING_REVIEW_RULE_SET_VERSION}__${rule.code}`,
    fields: toFirestoreFields({
      ...rule,
      ruleSetVersion: DRAWING_REVIEW_RULE_SET_VERSION,
      enabled: true,
      sortOrder: index + 1
    })
  }))
];

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    writes: documents.map((document) => ({
      update: document,
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }]
    }))
  })
});

const result = await response.json();
if (!response.ok) {
  throw new Error(`Firestore rule sync failed (${response.status}): ${JSON.stringify(result)}`);
}

const failures = (result.status || []).filter((status) => status.code && status.code !== 0);
if (failures.length) {
  throw new Error(`Firestore rule sync returned ${failures.length} failed writes: ${JSON.stringify(failures)}`);
}

console.log(`Synced ${drawingReviewRules.length} rules for ${DRAWING_REVIEW_RULE_SET_VERSION} to ${projectId}.`);

function readGcloudAccessToken() {
  const windows = process.platform === "win32";
  const executable = windows ? (process.env.ComSpec || "cmd.exe") : "gcloud";
  const args = windows
    ? ["/d", "/s", "/c", "gcloud.cmd auth print-access-token --quiet"]
    : ["auth", "print-access-token", "--quiet"];
  const token = execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }).trim();
  if (!token) throw new Error("gcloud did not return an access token");
  return token;
}

function toFirestoreFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)]));
}

function toFirestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (value && typeof value === "object") return { mapValue: { fields: toFirestoreFields(value) } };
  return { nullValue: null };
}
