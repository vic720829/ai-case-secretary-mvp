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
    require: (moduleName) => {
      if (moduleName in requireMap) return requireMap[moduleName];
      throw new Error(`Unexpected test import: ${moduleName}`);
    }
  };

  moduleContext.exports = moduleContext.module.exports;
  vm.runInNewContext(compiled, moduleContext, { filename: sourcePath });

  return moduleContext.module.exports;
}

const audioMemoDrafts = loadTsModule(path.join("src", "lib", "audioMemoDrafts.ts"));

const {
  MAX_AUDIO_SIZE_BYTES,
  isAllowedAudioContentType,
  inferAudioContentType,
  getAudioExtension,
  sanitizePathSegment,
  normalizeStringList,
  stripJsonFence,
  buildFallbackAudioDraftAnalysis,
  buildMemoContentFromAudioDraftAnalysis,
  getConfiguredTimeoutMs,
  canReviewAudioMemoDraft
} = audioMemoDrafts;

const { formatCombinedTranscript } = loadTsModule(path.join("src", "services", "audioTranscription.ts"), {
  "@/lib/audioMemoDrafts": audioMemoDrafts
});

assert.equal(MAX_AUDIO_SIZE_BYTES, 25 * 1024 * 1024, "audio upload limit should stay at 25MB");

assert.equal(isAllowedAudioContentType("audio/mpeg"), true, "mp3 audio should be accepted");
assert.equal(isAllowedAudioContentType("audio/m4a"), true, "m4a audio should be accepted");
assert.equal(isAllowedAudioContentType("video/mp4"), true, "mp4 voice/video note should be accepted");
assert.equal(isAllowedAudioContentType("text/plain"), false, "plain text file must not be accepted as audio");

assert.equal(inferAudioContentType("meeting.mp3"), "audio/mpeg");
assert.equal(inferAudioContentType("meeting.M4A"), "audio/m4a");
assert.equal(inferAudioContentType("meeting.unknown"), "audio/mpeg", "unknown extension uses safe audio default");

assert.equal(getAudioExtension("recording.m4a", "audio/mp4"), "m4a");
assert.equal(getAudioExtension("recording", "audio/webm"), "webm");
assert.equal(getAudioExtension("bad name.$$mp3", "audio/mpeg"), "mp3");

assert.equal(sanitizePathSegment("project/../A 01"), "project____A_01");
assert.equal(sanitizePathSegment(""), "unknown");

assert.deepEqual(
  normalizeStringList(["  A  ", "", "B", null, undefined, "C"]),
  ["A", "B", "C"],
  "string list normalization should trim values and skip empty values"
);
assert.equal(normalizeStringList(Array.from({ length: 20 }, (_, index) => index)).length, 12, "lists should be capped");

assert.equal(stripJsonFence("```json\n{\"ok\":true}\n```"), "{\"ok\":true}");

const fallback = buildFallbackAudioDraftAnalysis("這是一段會議錄音逐字稿");
assert.equal(fallback.title, "語音轉備忘錄草稿");
assert.equal(fallback.summary, "這是一段會議錄音逐字稿");

const memoContent = buildMemoContentFromAudioDraftAnalysis(
  {
    title: "會議紀錄",
    summary: "客戶決定改尺寸。",
    decisions: ["客戶同意改尺寸"],
    changes: ["櫃體加寬 5 公分"],
    actionItems: ["設計師更新圖面"],
    payments: [],
    invoices: [],
    risks: ["需確認木工是否影響工期"],
    speakerNotes: ["客戶：同意改尺寸", "設計師：承諾更新圖面"]
  },
  "原始逐字稿內容"
);
assert.match(memoContent, /AI 語音摘要/);
assert.match(memoContent, /客戶同意改尺寸/);
assert.match(memoContent, /發言角色整理/);
assert.match(memoContent, /設計師：承諾更新圖面/);
assert.match(memoContent, /原始逐字稿內容/);

const combinedTranscript = formatCombinedTranscript([
  { index: 1, fileName: "part-1.m4a", transcript: "第一段內容" },
  { index: 2, fileName: "part-2.m4a", transcript: "第二段內容" }
]);
assert.match(combinedTranscript, /錄音分段 1：part-1\.m4a/);
assert.match(combinedTranscript, /第一段內容/);
assert.match(combinedTranscript, /錄音分段 2：part-2\.m4a/);

assert.equal(getConfiguredTimeoutMs("100", 25_000), 3_000, "timeout should have a safe minimum");
assert.equal(getConfiguredTimeoutMs("90000", 25_000), 60_000, "timeout should have a safe maximum");
assert.equal(getConfiguredTimeoutMs("bad", 25_000), 25_000, "bad timeout env should fall back");

assert.equal(canReviewAudioMemoDraft("pending"), true);
assert.equal(canReviewAudioMemoDraft("approved"), false);
assert.equal(canReviewAudioMemoDraft("rejected"), false);

console.log("Audio memo draft tests passed.");
