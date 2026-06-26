import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { buildLineAdminWelcomeText } from "@/services/lineAdminWelcome";
import { pushLineText } from "@/services/line";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FirebaseLookupResponse = {
  users?: Array<{
    localId?: string;
  }>;
  error?: {
    message?: string;
  };
};

export async function POST(request: Request) {
  try {
    const caller = await verifyAdminCaller(request);
    if (!caller.ok) {
      return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
    }

    const body = (await request.json()) as { groupId?: string };
    const groupId = String(body.groupId ?? "").trim();

    if (!groupId) {
      return NextResponse.json({ ok: false, error: "缺少 LINE groupId。" }, { status: 400 });
    }

    const db = getAdminDb();
    const snapshot = await db.collection("line_groups").where("groupId", "==", groupId).limit(1).get();
    const groupDoc = snapshot.empty ? null : snapshot.docs[0];
    const group = groupDoc?.data();

    if (!groupDoc || group?.groupType !== "admin") {
      return NextResponse.json({ ok: false, error: "這個 LINE 群組尚未設定為公司後台群。" }, { status: 404 });
    }

    if (group.allowAssistantReplies === false) {
      return NextResponse.json({ ok: false, error: "這個後台群目前未允許機器人回覆。" }, { status: 400 });
    }

    await pushLineText(groupId, buildLineAdminWelcomeText());
    await groupDoc.ref.set(
      {
        welcomeSentAt: FieldValue.serverTimestamp(),
        welcomeSentBy: caller.uid,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (caught) {
    return NextResponse.json(
      { ok: false, error: caught instanceof Error ? caught.message : "發送公司後台群說明失敗。" },
      { status: 500 }
    );
  }
}

async function verifyAdminCaller(request: Request): Promise<
  | { ok: true; uid: string }
  | { ok: false; status: number; error: string }
> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return { ok: false, status: 401, error: "尚未登入，請重新登入後再試。" };
  }

  try {
    const decoded = await lookupFirebaseIdToken(token);
    const userSnapshot = await getAdminDb().collection("users").doc(decoded.uid).get();
    const user = userSnapshot.data();
    const role = String(user?.role ?? "") as UserRole;
    const active = user?.active !== false;

    if (!userSnapshot.exists || !active || (role !== "owner" && role !== "admin")) {
      return { ok: false, status: 403, error: "只有 Owner 或 Admin 可以發送後台群說明。" };
    }

    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, error: "登入驗證失效，請重新登入後再試。" };
  }
}

async function lookupFirebaseIdToken(idToken: string) {
  const result = await callFirebaseIdentityToolkit<FirebaseLookupResponse>("accounts:lookup", { idToken });
  const user = result.users?.[0];
  const uid = String(user?.localId ?? "");

  if (!uid) {
    throw new Error("INVALID_ID_TOKEN");
  }

  return { uid };
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
    throw new Error("Firebase API key 尚未設定。");
  }

  return apiKey;
}
