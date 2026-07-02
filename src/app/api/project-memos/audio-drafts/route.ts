import { randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import type { MessageAttachment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_DRAFTS_COLLECTION = "project_memo_audio_drafts";
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
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

type AudioDraftAnalysis = {
  title: string;
  summary: string;
  decisions: string[];
  changes: string[];
  actionItems: string[];
  payments: string[];
  invoices: string[];
  risks: string[];
};

export async function GET(request: Request) {
  const caller = await verifyAudioDraftCaller(request);

  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";

  if (!projectId) {
    return NextResponse.json({ ok: false, error: "缺少案件 ID。" }, { status: 400 });
  }

  const snapshot = await getAdminDb()
    .collection(AUDIO_DRAFTS_COLLECTION)
    .where("projectId", "==", projectId)
    .get();
  const drafts = snapshot.docs
    .map((doc) => serializeAudioDraft(doc.id, doc.data()))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 30);

  return NextResponse.json({ ok: true, drafts });
}

export async function POST(request: Request) {
  const caller = await verifyAudioDraftCaller(request);

  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") ?? "");
    const file = formData.get("file");

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "缺少案件 ID。" }, { status: 400 });
    }

    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ ok: false, error: "請選擇要轉文字的語音檔。" }, { status: 400 });
    }

    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: "語音檔超過 25MB，請壓縮或剪短後再上傳。" }, { status: 400 });
    }

    const contentType = file.type || inferAudioContentType(file.name);
    if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
      return NextResponse.json({ ok: false, error: "語音格式不支援，請上傳 mp3、m4a、wav、webm 或 mp4。" }, { status: 400 });
    }

    const projectSnapshot = await getAdminDb().collection("projects").doc(projectId).get();
    if (!projectSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "找不到案件。" }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sourceAttachment = await saveAudioFile({
      projectId,
      fileName: file.name || "audio",
      contentType,
      buffer,
      senderName: caller.displayName || caller.email
    });
    const transcript = await transcribeAudioFile({
      fileName: file.name || `audio.${getAudioExtension(file.name, contentType)}`,
      contentType,
      buffer
    });
    const analysis = await analyzeTranscript({
      transcript,
      projectName: String(projectSnapshot.data()?.name ?? ""),
      clientName: String(projectSnapshot.data()?.clientName ?? "")
    });
    const content = buildMemoContentFromAnalysis(analysis, transcript);
    const draftRef = await getAdminDb().collection(AUDIO_DRAFTS_COLLECTION).add({
      projectId,
      title: analysis.title || "語音會議紀錄",
      transcript,
      summary: analysis.summary,
      content,
      decisions: analysis.decisions,
      changes: analysis.changes,
      actionItems: analysis.actionItems,
      payments: analysis.payments,
      invoices: analysis.invoices,
      risks: analysis.risks,
      sourceType: "audio",
      sourceAttachment: toFirestoreAttachment(sourceAttachment),
      reviewStatus: "pending",
      createdBy: caller.displayName || caller.email,
      createdByUid: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    const draftSnapshot = await draftRef.get();

    return NextResponse.json({ ok: true, draft: serializeAudioDraft(draftSnapshot.id, draftSnapshot.data() ?? {}) });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "語音轉文字失敗，請稍後再試。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function saveAudioFile(input: {
  projectId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  senderName: string;
}): Promise<MessageAttachment> {
  const messageId = randomUUID();
  const token = randomUUID();
  const extension = getAudioExtension(input.fileName, input.contentType);
  const storagePath = `project-memo-audio/${sanitizePathSegment(input.projectId)}/${Date.now()}-${messageId}.${extension}`;
  const bucket = getAdminStorageBucket();

  await bucket.file(storagePath).save(input.buffer, {
    metadata: {
      contentType: input.contentType,
      metadata: {
        firebaseStorageDownloadTokens: token
      }
    }
  });

  return {
    messageId,
    fileUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      storagePath
    )}?alt=media&token=${token}`,
    fileType: "audio",
    senderName: input.senderName,
    senderRole: "internal",
    text: input.fileName,
    createdAt: new Date()
  };
}

async function transcribeAudioFile(input: { fileName: string; contentType: string; buffer: Buffer }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定，無法進行語音轉文字。");

  const preferredModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
  const models = preferredModel === "whisper-1" ? ["whisper-1"] : [preferredModel, "whisper-1"];
  let lastError = "語音轉文字失敗。";

  for (const model of models) {
    const body = new FormData();
    const bytes = Uint8Array.from(input.buffer);
    body.append("model", model);
    body.append("language", "zh");
    body.append("file", new Blob([bytes], { type: input.contentType }), input.fileName);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body
    });
    const result = (await response.json()) as { text?: string; error?: { message?: string } };

    if (response.ok && result.text?.trim()) return result.text.trim();

    lastError = result.error?.message || `語音轉文字失敗（${response.status}）。`;
  }

  throw new Error(lastError);
}

async function analyzeTranscript(input: { transcript: string; projectName: string; clientName: string }): Promise<AudioDraftAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) return buildFallbackAnalysis(input.transcript);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          "你是室內設計公司的會議紀錄秘書。",
          "請根據語音逐字稿整理成內部備忘錄草稿，只回 JSON，不要 markdown。",
          "不要替公司承諾，不要編造逐字稿沒有出現的資訊。",
          "若沒有相關內容，陣列留空。",
          "JSON 格式：",
          '{"title":"30字內標題","summary":"120字內摘要","decisions":["客戶決議"],"changes":["變更事項"],"actionItems":["待辦建議"],"payments":["付款事項"],"invoices":["發票事項"],"risks":["風險提醒"]}',
          `案件：${input.projectName || "未命名案件"}`,
          `客戶：${input.clientName || "未填客戶"}`,
          "",
          "逐字稿：",
          input.transcript
        ].join("\n")
      })
    });

    if (!response.ok) return buildFallbackAnalysis(input.transcript);

    const result = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const outputText =
      result.output_text ??
      result.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n") ??
      "";
    const parsed = JSON.parse(stripJsonFence(outputText)) as Partial<AudioDraftAnalysis>;

    return {
      title: String(parsed.title ?? "").trim() || "語音會議紀錄",
      summary: String(parsed.summary ?? "").trim() || input.transcript.slice(0, 120),
      decisions: normalizeStringList(parsed.decisions),
      changes: normalizeStringList(parsed.changes),
      actionItems: normalizeStringList(parsed.actionItems),
      payments: normalizeStringList(parsed.payments),
      invoices: normalizeStringList(parsed.invoices),
      risks: normalizeStringList(parsed.risks)
    };
  } catch {
    return buildFallbackAnalysis(input.transcript);
  }
}

function buildMemoContentFromAnalysis(analysis: AudioDraftAnalysis, transcript: string) {
  return [
    "【AI 會議摘要】",
    analysis.summary || "目前沒有明確摘要。",
    "",
    formatSection("客戶決議", analysis.decisions),
    formatSection("變更事項", analysis.changes),
    formatSection("待辦建議", analysis.actionItems),
    formatSection("付款事項", analysis.payments),
    formatSection("發票事項", analysis.invoices),
    formatSection("風險提醒", analysis.risks),
    "【逐字稿】",
    transcript
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSection(title: string, items: string[]) {
  if (!items.length) return "";

  return [`【${title}】`, ...items.map((item) => `- ${item}`), ""].join("\n");
}

function buildFallbackAnalysis(transcript: string): AudioDraftAnalysis {
  return {
    title: "語音會議紀錄",
    summary: transcript.slice(0, 120),
    decisions: [],
    changes: [],
    actionItems: [],
    payments: [],
    invoices: [],
    risks: []
  };
}

async function verifyAudioDraftCaller(request: Request): Promise<
  | { ok: true; uid: string; email: string; displayName: string }
  | { ok: false; status: number; error: string }
> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return { ok: false, status: 401, error: "請先登入。" };
  }

  try {
    const decoded = await lookupFirebaseIdToken(token);
    const userSnapshot = await getAdminDb().collection("users").doc(decoded.uid).get();
    const user = userSnapshot.data();
    const role = String(user?.role ?? "");
    const active = user?.active !== false;

    if (!userSnapshot.exists || !active || !["owner", "admin", "staff"].includes(role)) {
      return { ok: false, status: 403, error: "沒有使用語音備忘錄草稿的權限。" };
    }

    return {
      ok: true,
      uid: decoded.uid,
      email: String(user?.email ?? decoded.email ?? ""),
      displayName: String(user?.displayName ?? decoded.displayName ?? "")
    };
  } catch {
    return { ok: false, status: 401, error: "登入狀態已失效，請重新登入。" };
  }
}

type FirebaseLookupResponse = {
  users?: Array<{
    localId?: string;
    email?: string;
    displayName?: string;
  }>;
  error?: {
    message?: string;
  };
};

async function lookupFirebaseIdToken(idToken: string) {
  const result = await callFirebaseIdentityToolkit<FirebaseLookupResponse>("accounts:lookup", { idToken });
  const user = result.users?.[0];
  const uid = String(user?.localId ?? "");

  if (!uid) {
    throw new Error("INVALID_ID_TOKEN");
  }

  return {
    uid,
    email: String(user?.email ?? ""),
    displayName: String(user?.displayName ?? "")
  };
}

async function callFirebaseIdentityToolkit<T extends { error?: { message?: string } }>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const apiKey = getFirebaseApiKey();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
  const result = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(result.error?.message || `FIREBASE_AUTH_${response.status}`);
  }

  return result;
}

function serializeAudioDraft(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    projectId: String(data.projectId ?? ""),
    title: String(data.title ?? ""),
    transcript: String(data.transcript ?? ""),
    summary: String(data.summary ?? ""),
    content: String(data.content ?? ""),
    decisions: normalizeStringList(data.decisions),
    changes: normalizeStringList(data.changes),
    actionItems: normalizeStringList(data.actionItems),
    payments: normalizeStringList(data.payments),
    invoices: normalizeStringList(data.invoices),
    risks: normalizeStringList(data.risks),
    reviewStatus: String(data.reviewStatus ?? "pending"),
    sourceAttachment: serializeAttachment(data.sourceAttachment),
    approvedMemoId: String(data.approvedMemoId ?? ""),
    createdBy: String(data.createdBy ?? ""),
    reviewedBy: String(data.reviewedBy ?? ""),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    reviewedAt: timestampToIso(data.reviewedAt)
  };
}

function serializeAttachment(value: unknown): MessageAttachment | null {
  if (!value || typeof value !== "object") return null;
  const attachment = value as Record<string, unknown>;
  const fileUrl = String(attachment.fileUrl ?? "");
  const messageId = String(attachment.messageId ?? "");

  if (!fileUrl || !messageId) return null;

  return {
    messageId,
    fileUrl,
    fileType: "audio",
    senderName: String(attachment.senderName ?? ""),
    senderRole: "internal",
    text: String(attachment.text ?? ""),
    createdAt: timestampToDate(attachment.createdAt)
  };
}

function toFirestoreAttachment(attachment: MessageAttachment) {
  return {
    ...attachment,
    createdAt: attachment.createdAt ? Timestamp.fromDate(attachment.createdAt) : FieldValue.serverTimestamp()
  };
}

function timestampToIso(value: unknown) {
  const date = timestampToDate(value);
  return date ? date.toISOString() : null;
}

function timestampToDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : [];
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function getFirebaseApiKey() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";

  if (!apiKey) {
    throw new Error("Firebase API key is not configured.");
  }

  return apiKey;
}

function inferAudioContentType(fileName: string) {
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

function getAudioExtension(fileName: string, contentType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (extension) return extension.slice(0, 8);
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("flac")) return "flac";
  return "mp3";
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
}
