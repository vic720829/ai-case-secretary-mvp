import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { buildDailyConversationSummaryMessages } from "@/services/dailyConversationSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await verifyCaller(request);

  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  try {
    const db = getAdminDb();
    const yesterday = taipeiYesterday();
    const yesterdaySnapshot = await db.collection("daily_summaries").doc(yesterday).get();

    if (!yesterdaySnapshot.exists) {
      await buildDailyConversationSummaryMessages();
    }

    const snapshot = await db.collection("daily_summaries").orderBy("summaryDate", "desc").limit(31).get();
    const summaries = snapshot.docs.map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        summaryDate: String(data.summaryDate ?? doc.id),
        contextStartDate: String(data.contextStartDate ?? ""),
        title: String(data.title ?? "昨日 LINE 對話摘要"),
        text: String(data.text ?? ""),
        source: data.source === "ai" ? "ai" : "fallback",
        projectIds: Array.isArray(data.projectIds) ? data.projectIds.map(String) : [],
        projectCount: Number(data.projectCount ?? 0),
        messageCount: Number(data.messageCount ?? 0),
        generatedAt: timestampToIso(data.generatedAt ?? data.updatedAt ?? data.createdAt)
      };
    });

    return NextResponse.json({ ok: true, summaries });
  } catch (caught) {
    console.error("List daily summaries failed", caught);
    return NextResponse.json({ ok: false, error: "每日摘要讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

async function verifyCaller(request: Request): Promise<
  | { ok: true; uid: string }
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

    if (!userSnapshot.exists || user?.active === false || !["owner", "admin", "manager"].includes(role)) {
      return { ok: false, status: 403, error: "你沒有查看每日摘要的權限。" };
    }

    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, error: "登入狀態已失效，請重新登入。" };
  }
}

type FirebaseLookupResponse = {
  users?: Array<{
    localId?: string;
  }>;
  error?: {
    message?: string;
  };
};

async function lookupFirebaseIdToken(idToken: string) {
  const result = await callFirebaseIdentityToolkit<FirebaseLookupResponse>("accounts:lookup", { idToken });
  const uid = String(result.users?.[0]?.localId ?? "");

  if (!uid) {
    throw new Error("INVALID_ID_TOKEN");
  }

  return { uid };
}

async function callFirebaseIdentityToolkit<T extends { error?: { message?: string } }>(
  endpoint: string,
  body: Record<string, unknown>
) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";

  if (!apiKey) {
    throw new Error("FIREBASE_API_KEY_NOT_CONFIGURED");
  }

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

function timestampToIso(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return "";
}

function taipeiYesterday() {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 1970);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 1);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 1);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() - 1);

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}
