import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { refreshProjectAiSummary } from "@/services/projectAiSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await verifyProjectSummaryCaller(request);

  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  try {
    const summary = await refreshProjectAiSummary(id, caller.displayName || caller.email || caller.uid);

    return NextResponse.json({ ok: true, summary });
  } catch (caught) {
    const message = caught instanceof Error && caught.message === "PROJECT_NOT_FOUND" ? "找不到案件。" : "更新案件摘要失敗。";

    return NextResponse.json({ ok: false, error: message }, { status: caught instanceof Error && caught.message === "PROJECT_NOT_FOUND" ? 404 : 500 });
  }
}

async function verifyProjectSummaryCaller(request: Request): Promise<
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

    if (!userSnapshot.exists || !active || !["owner", "admin", "manager"].includes(role)) {
      return { ok: false, status: 403, error: "沒有更新案件摘要的權限。" };
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

function getFirebaseApiKey() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";

  if (!apiKey) {
    throw new Error("Firebase API key is not configured.");
  }

  return apiKey;
}
