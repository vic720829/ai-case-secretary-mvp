import { randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  MAX_AUDIO_SIZE_BYTES,
  buildFallbackAudioDraftAnalysis as buildFallbackAnalysisForAudioDraft,
  buildMemoContentFromAudioDraftAnalysis as buildMemoContentFromAudioDraft,
  getAudioExtension as getAudioDraftExtension,
  getConfiguredTimeoutMs,
  inferAudioContentType as inferAudioDraftContentType,
  isAllowedAudioContentType,
  normalizeStringList as normalizeAudioDraftStringList,
  sanitizePathSegment as sanitizeAudioDraftPathSegment,
  stripJsonFence as stripAudioDraftJsonFence,
  type AudioDraftAnalysis
} from "@/lib/audioMemoDrafts";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import type { MessageAttachment } from "@/lib/types";
import { transcribeAudioSegments, type AudioTranscriptionInput } from "@/services/audioTranscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_DRAFTS_COLLECTION = "project_memo_audio_drafts";
const MAX_AUDIO_SEGMENTS = 8;

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

  const projectSnapshot = await getAdminDb().collection("projects").doc(projectId).get();
  if (!projectSnapshot.exists) {
    return NextResponse.json({ ok: false, error: "找不到案件。" }, { status: 404 });
  }

  if (!canAccessProject(caller, projectSnapshot.data())) {
    return NextResponse.json({ ok: false, error: "沒有讀取此案件語音備忘錄的權限。" }, { status: 403 });
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
    const audioFiles = getAudioFilesFromFormData(formData);

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "缺少案件 ID。" }, { status: 400 });
    }

    if (!audioFiles.length) {
      return NextResponse.json({ ok: false, error: "Please choose at least one audio file." }, { status: 400 });
    }

    if (audioFiles.length > MAX_AUDIO_SEGMENTS) {
      return NextResponse.json({ ok: false, error: `You can upload up to ${MAX_AUDIO_SEGMENTS} audio segments at once.` }, { status: 400 });
    }

    const projectSnapshot = await getAdminDb().collection("projects").doc(projectId).get();
    if (!projectSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
    }

    if (!canAccessProject(caller, projectSnapshot.data())) {
      return NextResponse.json({ ok: false, error: "沒有建立此案件語音備忘錄的權限。" }, { status: 403 });
    }

    const preparedFiles = await Promise.all(
      audioFiles.map(async (audioFile, index) => {
        if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
          throw new Error(`${audioFile.name || `audio segment ${index + 1}`} exceeds 25MB.`);
        }

        const contentType = audioFile.type || inferAudioDraftContentType(audioFile.name);
        if (!isAllowedAudioContentType(contentType)) {
          throw new Error(`${audioFile.name || `audio segment ${index + 1}`} is not a supported audio format.`);
        }

        const buffer = Buffer.from(await audioFile.arrayBuffer());
        const fileName = audioFile.name || `audio-${index + 1}.${getAudioDraftExtension(audioFile.name, contentType)}`;
        const sourceAttachment = await saveAudioFile({
          projectId,
          fileName,
          contentType,
          buffer,
          senderName: caller.displayName || caller.email
        });

        return {
          fileName,
          contentType,
          buffer,
          sourceAttachment
        };
      })
    );

    const transcription = await transcribeAudioSegments(
      preparedFiles.map(
        (item): AudioTranscriptionInput => ({
          fileName: item.fileName,
          contentType: item.contentType,
          buffer: item.buffer
        })
      )
    );
    const transcript = transcription.transcript;
    const sourceAttachments = preparedFiles.map((item) => item.sourceAttachment);
    const sourceAttachment = sourceAttachments[0];
    if (!sourceAttachment) {
      return NextResponse.json({ ok: false, error: "No audio attachment was saved." }, { status: 500 });
    }
    const analysis = await analyzeTranscript({
      transcript,
      projectName: String(projectSnapshot.data()?.name ?? ""),
      clientName: String(projectSnapshot.data()?.clientName ?? "")
    });
    const content = buildMemoContentFromAudioDraft(analysis, transcript);
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
      speakerNotes: analysis.speakerNotes,
      sourceType: "audio",
      sourceAttachment: toFirestoreAttachment(sourceAttachment),
      sourceAttachments: sourceAttachments.map(toFirestoreAttachment),
      audioSegmentCount: sourceAttachments.length,
      transcriptionSegments: transcription.segments.map((segment) => ({
        index: segment.index,
        fileName: segment.fileName,
        transcript: segment.transcript
      })),
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

function getAudioFilesFromFormData(formData: FormData) {
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const legacyFile = formData.get("file");

  if (files.length) return files;
  return legacyFile instanceof File && legacyFile.size > 0 ? [legacyFile] : [];
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
  const extension = getAudioDraftExtension(input.fileName, input.contentType);
  const storagePath = `project-memo-audio/${sanitizeAudioDraftPathSegment(input.projectId)}/${Date.now()}-${messageId}.${extension}`;
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

async function analyzeTranscript(input: { transcript: string; projectName: string; clientName: string }): Promise<AudioDraftAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) return buildFallbackAnalysisForAudioDraft(input.transcript);

  try {
    const timeoutMs = getConfiguredTimeoutMs(process.env.OPENAI_ANALYSIS_TIMEOUT_MS, DEFAULT_ANALYSIS_TIMEOUT_MS);
    const { response, result } = await fetchJsonWithTimeout<{
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    }>(
      "https://api.openai.com/v1/responses",
      {
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
            "speakerNotes 是依照逐字稿內容推論的發言角色整理，不是真正聲紋辨識；若角色不明，用「未判斷」。",
            "若沒有相關內容，陣列留空。",
            "JSON 格式：",
            '{"title":"30字內標題","summary":"120字內摘要","decisions":["客戶決議"],"changes":["變更事項"],"actionItems":["待辦建議"],"payments":["付款事項"],"invoices":["發票事項"],"risks":["風險提醒"],"speakerNotes":["客戶：希望改尺寸","設計師：承諾明天提供圖面","工務：提醒木工進場前確認材料"]}',
            `案件：${input.projectName || "未命名案件"}`,
            `客戶：${input.clientName || "未填客戶"}`,
            "",
            "逐字稿：",
            input.transcript
          ].join("\n")
        })
      },
      timeoutMs
    );

    if (!response.ok) return buildFallbackAnalysisForAudioDraft(input.transcript);

    const outputText =
      result.output_text ??
      result.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n") ??
      "";
    const parsed = JSON.parse(stripAudioDraftJsonFence(outputText)) as Partial<AudioDraftAnalysis>;

    return {
      title: String(parsed.title ?? "").trim() || "語音會議紀錄",
      summary: String(parsed.summary ?? "").trim() || input.transcript.slice(0, 120),
      decisions: normalizeAudioDraftStringList(parsed.decisions),
      changes: normalizeAudioDraftStringList(parsed.changes),
      actionItems: normalizeAudioDraftStringList(parsed.actionItems),
      payments: normalizeAudioDraftStringList(parsed.payments),
      invoices: normalizeAudioDraftStringList(parsed.invoices),
      risks: normalizeAudioDraftStringList(parsed.risks),
      speakerNotes: normalizeAudioDraftStringList(parsed.speakerNotes)
    };
  } catch {
    return buildFallbackAnalysisForAudioDraft(input.transcript);
  }
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const result = (await response.json()) as T;

    return { response, result };
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyAudioDraftCaller(request: Request): Promise<
  | { ok: true; uid: string; email: string; displayName: string; role: string }
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

    if (!userSnapshot.exists || !active || !["owner", "admin", "manager", "staff"].includes(role)) {
      return { ok: false, status: 403, error: "沒有使用語音備忘錄草稿的權限。" };
    }

    return {
      ok: true,
      uid: decoded.uid,
      email: String(user?.email ?? decoded.email ?? ""),
      displayName: String(user?.displayName ?? decoded.displayName ?? ""),
      role
    };
  } catch {
    return { ok: false, status: 401, error: "登入狀態已失效，請重新登入。" };
  }
}

function canAccessProject(caller: { uid: string; role: string }, project: Record<string, unknown> | undefined) {
  if (!project) return false;
  if (caller.role === "owner" || caller.role === "admin" || caller.role === "manager") return true;

  return Array.isArray(project.memberUserIds) && project.memberUserIds.includes(caller.uid);
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
    decisions: normalizeAudioDraftStringList(data.decisions),
    changes: normalizeAudioDraftStringList(data.changes),
    actionItems: normalizeAudioDraftStringList(data.actionItems),
    payments: normalizeAudioDraftStringList(data.payments),
    invoices: normalizeAudioDraftStringList(data.invoices),
    risks: normalizeAudioDraftStringList(data.risks),
    speakerNotes: normalizeAudioDraftStringList(data.speakerNotes),
    reviewStatus: String(data.reviewStatus ?? "pending"),
    sourceAttachment: serializeAttachment(data.sourceAttachment),
    sourceAttachments: serializeAttachments(data.sourceAttachments),
    audioSegmentCount: Number(data.audioSegmentCount ?? 0),
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

function serializeAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.map(serializeAttachment).filter((attachment): attachment is MessageAttachment => Boolean(attachment));
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

function getFirebaseApiKey() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";

  if (!apiKey) {
    throw new Error("Firebase API key is not configured.");
  }

  return apiKey;
}
