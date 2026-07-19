import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import type { UserRole } from "@/lib/types";

export type ApiCaller = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
};

export async function verifyApiCaller(request: Request): Promise<
  | { ok: true; caller: ApiCaller }
  | { ok: false; status: number; error: string }
> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) return { ok: false, status: 401, error: "請先登入。" };

  try {
    const decoded = await (await getAdminAuth()).verifyIdToken(token);
    const snapshot = await getAdminDb().collection("users").doc(decoded.uid).get();
    const data = snapshot.data();
    const role = normalizeRole(data?.role);

    if (!snapshot.exists || data?.active === false) {
      return { ok: false, status: 403, error: "此帳號目前無法使用。" };
    }

    return {
      ok: true,
      caller: {
        uid: decoded.uid,
        email: String(data?.email ?? decoded.email ?? ""),
        displayName: String(data?.displayName ?? decoded.name ?? ""),
        role
      }
    };
  } catch (caught) {
    const authError = caught as { code?: unknown; message?: unknown };
    console.error("Firebase ID token verification failed", {
      code: typeof authError?.code === "string" ? authError.code : "unknown",
      message: typeof authError?.message === "string" ? authError.message : "Unknown authentication error"
    });
    return { ok: false, status: 401, error: "登入狀態已失效，請重新登入。" };
  }
}

export function canAccessProject(caller: ApiCaller, projectData: Record<string, unknown> | undefined) {
  if (!projectData) return false;
  if (["owner", "admin", "manager"].includes(caller.role)) return true;
  return Array.isArray(projectData.memberUserIds) && projectData.memberUserIds.includes(caller.uid);
}

export function canCreateDrawingReview(caller: ApiCaller) {
  return caller.role !== "viewer";
}

function normalizeRole(value: unknown): UserRole {
  return value === "owner" || value === "admin" || value === "manager" || value === "viewer" ? value : "staff";
}
