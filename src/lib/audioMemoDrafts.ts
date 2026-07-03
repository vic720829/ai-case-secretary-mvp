export const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 25_000;
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 15_000;

export const ALLOWED_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm"
]);

export type AudioDraftAnalysis = {
  title: string;
  summary: string;
  decisions: string[];
  changes: string[];
  actionItems: string[];
  payments: string[];
  invoices: string[];
  risks: string[];
  speakerNotes: string[];
};

export function isAllowedAudioContentType(contentType: string) {
  return ALLOWED_AUDIO_TYPES.has(contentType);
}

export function inferAudioContentType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/m4a";
  if (extension === "wav") return "audio/wav";
  if (extension === "webm") return "audio/webm";
  if (extension === "mp4") return "video/mp4";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "flac") return "audio/flac";
  return "audio/mpeg";
}

export function getAudioExtension(fileName: string, contentType: string) {
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (extension) return extension.slice(0, 8);
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("flac")) return "flac";
  return "mp3";
}

export function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
}

export function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item) => item !== null && item !== undefined)
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
}

export function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function buildFallbackAudioDraftAnalysis(transcript: string): AudioDraftAnalysis {
  return {
    title: "語音轉備忘錄草稿",
    summary: transcript.slice(0, 120),
    decisions: [],
    changes: [],
    actionItems: [],
    payments: [],
    invoices: [],
    risks: [],
    speakerNotes: []
  };
}

export function buildMemoContentFromAudioDraftAnalysis(analysis: AudioDraftAnalysis, transcript: string) {
  return [
    "AI 語音摘要",
    analysis.summary || "尚未整理出摘要。",
    "",
    formatSection("客戶決議", analysis.decisions),
    formatSection("變更事項", analysis.changes),
    formatSection("待辦事項", analysis.actionItems),
    formatSection("付款事項", analysis.payments),
    formatSection("發票事項", analysis.invoices),
    formatSection("風險提醒", analysis.risks),
    formatSection("發言角色整理", analysis.speakerNotes),
    "原始逐字稿",
    transcript
  ]
    .filter(Boolean)
    .join("\n");
}

export function getConfiguredTimeoutMs(value: string | undefined, fallbackMs: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackMs;

  return Math.min(60_000, Math.max(3_000, Math.round(parsed)));
}

export function canReviewAudioMemoDraft(reviewStatus: string) {
  return reviewStatus === "pending";
}

function formatSection(title: string, items: string[]) {
  if (!items.length) return "";

  return [`【${title}】`, ...items.map((item) => `- ${item}`), ""].join("\n");
}
