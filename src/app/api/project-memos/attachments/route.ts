import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import type { MessageAttachment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 8;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf"
]);

export async function POST(request: Request) {
  const caller = await verifyMemoUploadCaller(request);

  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") ?? "");
    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "缺少案件 ID。" }, { status: 400 });
    }

    if (!files.length) {
      return NextResponse.json({ ok: false, error: "請選擇要上傳的附件。" }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json({ ok: false, error: `一次最多上傳 ${MAX_FILES} 個附件。` }, { status: 400 });
    }

    const projectSnapshot = await getAdminDb().collection("projects").doc(projectId).get();
    if (!projectSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "找不到案件。" }, { status: 404 });
    }

    if (!canAccessProject(caller, projectSnapshot.data())) {
      return NextResponse.json({ ok: false, error: "沒有存取此備忘錄附件的權限。" }, { status: 403 });
    }

    const uploaded: MessageAttachment[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ ok: false, error: `「${file.name}」超過 10MB，請壓縮後再上傳。` }, { status: 400 });
      }

      const contentType = file.type || "application/octet-stream";
      if (!ALLOWED_TYPES.has(contentType)) {
        return NextResponse.json({ ok: false, error: `「${file.name}」格式不支援，請上傳圖片或 PDF。` }, { status: 400 });
      }

      const messageId = randomUUID();
      const token = randomUUID();
      const extension = getUploadExtension(file.name, contentType);
      const storagePath = `project-memos/${sanitizePathSegment(projectId)}/${Date.now()}-${messageId}.${extension}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const bucket = getAdminStorageBucket();

      await bucket.file(storagePath).save(buffer, {
        metadata: {
          contentType,
          metadata: {
            firebaseStorageDownloadTokens: token
          }
        }
      });

      const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
        storagePath
      )}?alt=media&token=${token}`;

      uploaded.push({
        messageId,
        fileUrl,
        fileType: contentType === "application/pdf" ? "file" : "image",
        senderName: caller.displayName || caller.email,
        senderRole: "internal",
        text: file.name,
        createdAt: new Date()
      });
    }

    return NextResponse.json({ ok: true, attachments: uploaded });
  } catch {
    return NextResponse.json({ ok: false, error: "附件上傳失敗，請稍後再試。" }, { status: 500 });
  }
}

async function verifyMemoUploadCaller(request: Request): Promise<
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
      return { ok: false, status: 403, error: "沒有上傳備忘錄附件的權限。" };
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

function getUploadExtension(fileName: string, contentType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (extension) return extension.slice(0, 8);
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return "jpg";
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
}
