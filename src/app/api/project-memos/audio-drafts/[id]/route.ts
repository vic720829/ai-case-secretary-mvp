import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { canReviewAudioMemoDraft } from "@/lib/audioMemoDrafts";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { MessageAttachment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_DRAFTS_COLLECTION = "project_memo_audio_drafts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await verifyAudioDraftActionCaller(request);

  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  const { id } = await params;

  try {
    const body = (await request.json()) as {
      action?: string;
      title?: string;
      content?: string;
    };
    const action = body.action === "approve" || body.action === "reject" ? body.action : "";

    if (!action) {
      return NextResponse.json({ ok: false, error: "缺少操作。" }, { status: 400 });
    }

    const db = getAdminDb();
    const draftRef = db.collection(AUDIO_DRAFTS_COLLECTION).doc(id);
    const draftSnapshot = await draftRef.get();

    if (!draftSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "找不到語音備忘錄草稿。" }, { status: 404 });
    }

    const draft = draftSnapshot.data() ?? {};
    if (!canReviewAudioMemoDraft(String(draft.reviewStatus ?? "pending"))) {
      return NextResponse.json({ ok: false, error: "這筆語音草稿已經處理過。" }, { status: 409 });
    }
    const projectId = String(draft.projectId ?? "");
    const projectSnapshot = projectId ? await db.collection("projects").doc(projectId).get() : null;

    if (!projectSnapshot?.exists || !canAccessProject(caller, projectSnapshot.data())) {
      return NextResponse.json({ ok: false, error: "沒有處理此案件語音草稿的權限。" }, { status: 403 });
    }

    if (action === "reject") {
      await draftRef.set(
        {
          reviewStatus: "rejected",
          reviewedBy: caller.displayName || caller.email,
          reviewedByUid: caller.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return NextResponse.json({ ok: true });
    }

    const title = String(body.title ?? draft.title ?? "").trim();
    const content = String(body.content ?? draft.content ?? "").trim();

    if (!title) {
      return NextResponse.json({ ok: false, error: "請輸入備忘錄標題。" }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ ok: false, error: "請輸入備忘錄內容。" }, { status: 400 });
    }

    const sourceAttachment = readAttachment(draft.sourceAttachment);
    const sourceAttachments = readAttachments(draft.sourceAttachments);
    const attachments = sourceAttachments.length ? sourceAttachments : sourceAttachment ? [sourceAttachment] : [];
    const memoRef = db.collection("project_memos").doc(id);
    const batch = db.batch();

    batch.set(memoRef, {
      projectId: String(draft.projectId ?? ""),
      title,
      content,
      sourceAudioDraftId: id,
      sourceType: "audio_transcript",
      aiGenerated: true,
      attachments: attachments.map(toFirestoreAttachment),
      attachmentMessageIds: attachments.map((attachment) => attachment.messageId),
      attachmentCount: attachments.length,
      createdBy: caller.displayName || caller.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.set(
      draftRef,
      {
        title,
        content,
        reviewStatus: "approved",
        approvedMemoId: memoRef.id,
        reviewedBy: caller.displayName || caller.email,
        reviewedByUid: caller.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({ ok: true, memoId: memoRef.id });
  } catch {
    return NextResponse.json({ ok: false, error: "處理語音草稿失敗，請稍後再試。" }, { status: 500 });
  }
}

async function verifyAudioDraftActionCaller(request: Request): Promise<
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
      return { ok: false, status: 403, error: "沒有審核語音備忘錄草稿的權限。" };
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

function getFirebaseApiKey() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";

  if (!apiKey) {
    throw new Error("Firebase API key is not configured.");
  }

  return apiKey;
}

function readAttachment(value: unknown): MessageAttachment | null {
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

function readAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.map(readAttachment).filter((attachment): attachment is MessageAttachment => Boolean(attachment));
}

function toFirestoreAttachment(attachment: MessageAttachment) {
  return {
    ...attachment,
    createdAt: attachment.createdAt ? Timestamp.fromDate(attachment.createdAt) : FieldValue.serverTimestamp()
  };
}

function timestampToDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}
