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

type ResetPasswordBody = {
  id?: string;
  password?: string;
};

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

type FirebaseSignUpResponse = {
  localId?: string;
  email?: string;
  displayName?: string;
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

    const body = (await request.json()) as CreateUserBody;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim();
    const role = normalizeRole(body.role);
    const active = body.active !== false;

    if (!email) {
      return NextResponse.json({ ok: false, error: "請填寫 Email。" }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: "密碼至少要 6 碼。" }, { status: 400 });
    }

    if (!displayName) {
      return NextResponse.json({ ok: false, error: "請填寫員工名稱。" }, { status: 400 });
    }

    if (!role) {
      return NextResponse.json({ ok: false, error: "請選擇有效的角色。" }, { status: 400 });
    }

    const authUser = await createFirebaseAuthUser({ email, password, displayName });
    const userId = String(authUser.localId ?? "");

    if (!userId) {
      throw new Error("AUTH_CREATE_FAILED");
    }

    await getAdminDb().collection("users").doc(userId).set({
      email: String(authUser.email ?? email),
      displayName: String(authUser.displayName ?? displayName),
      role,
      active,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid
    });

    return NextResponse.json({ ok: true, id: userId });
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
      return NextResponse.json({ ok: false, error: "請填寫員工名稱。" }, { status: 400 });
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

    await getAdminDb().collection("users").doc(id).set(
      {
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

export async function PUT(request: Request) {
  try {
    const caller = await verifyAdminCaller(request);
    if (!caller.ok) {
      return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
    }

    const body = (await request.json()) as ResetPasswordBody;
    const id = String(body.id ?? "").trim();
    const password = String(body.password ?? "");

    if (!id) {
      return NextResponse.json({ ok: false, error: "找不到要重設密碼的員工。" }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: "新密碼至少需要 6 碼。" }, { status: 400 });
    }

    const userSnapshot = await getAdminDb().collection("users").doc(id).get();

    if (!userSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "找不到員工資料。" }, { status: 404 });
    }

    await getAdminAuth().updateUser(id, { password });
    await getAdminDb().collection("users").doc(id).set(
      {
        passwordUpdatedAt: FieldValue.serverTimestamp(),
        passwordUpdatedBy: caller.uid,
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
    const decoded = await lookupFirebaseIdToken(token);
    const userSnapshot = await getAdminDb().collection("users").doc(decoded.uid).get();
    const user = userSnapshot.data();
    const role = String(user?.role ?? "");
    const active = user?.active !== false;

    if (!userSnapshot.exists || !active || (role !== "owner" && role !== "admin")) {
      return { ok: false, status: 403, error: "只有 Owner 或管理員可以管理員工。" };
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

async function createFirebaseAuthUser(input: { email: string; password: string; displayName: string }) {
  return callFirebaseIdentityToolkit<FirebaseSignUpResponse>("accounts:signUp", {
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    returnSecureToken: false
  });
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
    throw new Error("Firebase API key 未設定。");
  }

  return apiKey;
}

function normalizeRole(value: unknown): UserRole | null {
  if (value === "owner" || value === "admin" || value === "staff" || value === "viewer") {
    return value;
  }

  return null;
}

function getAdminApiError(caught: unknown) {
  if (!(caught instanceof Error)) {
    return "員工資料處理失敗，請稍後再試。";
  }

  if (caught.message.includes("EMAIL_EXISTS")) {
    return "這個 Email 已經有帳號了。";
  }

  if (caught.message.includes("WEAK_PASSWORD") || caught.message.includes("INVALID_PASSWORD")) {
    return "密碼格式不正確，請至少輸入 6 碼。";
  }

  if (caught.message.includes("OPERATION_NOT_ALLOWED")) {
    return "Firebase Authentication 尚未啟用 Email/Password 登入。";
  }

  if (caught.message.includes("INVALID_ID_TOKEN") || caught.message.includes("TOKEN_EXPIRED")) {
    return "登入驗證失效，請重新登入後再試。";
  }

  return caught.message;
}
