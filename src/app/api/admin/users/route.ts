import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateUserBody = {
  email?: string;
  password?: string;
  displayName?: string;
  role?: string;
  active?: boolean;
};

type UpdateUserBody = {
  id?: string;
  displayName?: string;
  role?: string;
  active?: boolean;
};

export async function POST(request: Request) {
  try {
    const caller = await verifyAdminCaller(request);
    if (!caller.ok) {
      return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
    }

    const body = (await request.json()) as CreateUserBody;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim();
    const role = normalizeRole(body.role);
    const active = body.active !== false;

    if (!email) {
      return NextResponse.json({ ok: false, error: "請填員工 Email。" }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: "臨時密碼至少需要 6 碼。" }, { status: 400 });
    }

    if (!displayName) {
      return NextResponse.json({ ok: false, error: "請填員工名稱。" }, { status: 400 });
    }

    if (!role) {
      return NextResponse.json({ ok: false, error: "請選擇有效的角色。" }, { status: 400 });
    }

    const auth = await getAdminAuth();
    const db = getAdminDb();
    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
      disabled: !active
    });

    await db.collection("users").doc(userRecord.uid).set({
      email,
      displayName,
      role,
      active,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid
    });

    return NextResponse.json({ ok: true, id: userRecord.uid });
  } catch (caught) {
    return NextResponse.json({ ok: false, error: getAdminApiError(caught) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const caller = await verifyAdminCaller(request);
    if (!caller.ok) {
      return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
    }

    const body = (await request.json()) as UpdateUserBody;
    const id = String(body.id ?? "").trim();
    const displayName = String(body.displayName ?? "").trim();
    const role = normalizeRole(body.role);
    const active = body.active !== false;

    if (!id) {
      return NextResponse.json({ ok: false, error: "找不到要更新的員工。" }, { status: 400 });
    }

    if (!displayName) {
      return NextResponse.json({ ok: false, error: "請填員工名稱。" }, { status: 400 });
    }

    if (!role) {
      return NextResponse.json({ ok: false, error: "請選擇有效的角色。" }, { status: 400 });
    }

    if (id === caller.uid && !active) {
      return NextResponse.json({ ok: false, error: "不能停用目前登入中的自己。" }, { status: 400 });
    }

    if (id === caller.uid && role !== "owner" && role !== "admin") {
      return NextResponse.json({ ok: false, error: "不能把目前登入中的自己改成非管理角色。" }, { status: 400 });
    }

    const auth = await getAdminAuth();
    const db = getAdminDb();
    const userRecord = await auth.updateUser(id, {
      displayName,
      disabled: !active
    });

    await db.collection("users").doc(id).set(
      {
        email: userRecord.email ?? "",
        displayName,
        role,
        active,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, id });
  } catch (caught) {
    return NextResponse.json({ ok: false, error: getAdminApiError(caught) }, { status: 500 });
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
    const auth = await getAdminAuth();
    const decoded = await auth.verifyIdToken(token);
    const userSnapshot = await getAdminDb().collection("users").doc(decoded.uid).get();
    const user = userSnapshot.data();
    const role = String(user?.role ?? "");
    const active = user?.active !== false;

    if (!userSnapshot.exists || !active || (role !== "owner" && role !== "admin")) {
      return { ok: false, status: 403, error: "只有 Owner 或管理者可以新增員工。" };
    }

    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, error: "登入驗證失效，請重新登入後再試。" };
  }
}

function normalizeRole(value: unknown): UserRole | null {
  if (value === "owner" || value === "admin" || value === "staff" || value === "viewer") {
    return value;
  }

  return null;
}

function getAdminApiError(caught: unknown) {
  if (!(caught instanceof Error)) {
    return "新增員工失敗，請稍後再試。";
  }

  if (caught.message.includes("auth/email-already-exists")) {
    return "這個 Email 已經有登入帳號。";
  }

  if (caught.message.includes("auth/invalid-password")) {
    return "密碼格式不正確，請至少輸入 6 碼。";
  }

  if (caught.message.includes("auth/user-not-found")) {
    return "找不到這個員工的登入帳號。";
  }

  return caught.message;
}
