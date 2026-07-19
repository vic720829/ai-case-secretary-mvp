import { NextResponse } from "next/server";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebaseAdmin";
import { canAccessProject, verifyApiCaller } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyApiCaller(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await params;
  const database = getAdminDb();
  const reviewSnapshot = await database.collection("drawing_reviews").doc(id).get();
  const review = reviewSnapshot.data();

  if (!reviewSnapshot.exists || !review) {
    return NextResponse.json({ ok: false, error: "找不到審圖工作。" }, { status: 404 });
  }

  const projectSnapshot = await database.collection("projects").doc(String(review.projectId ?? "")).get();
  if (!canAccessProject(auth.caller, projectSnapshot.data())) {
    return NextResponse.json({ ok: false, error: "沒有此案件的檔案權限。" }, { status: 403 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "report" ? "report" : "source";
  const storagePath = kind === "report" ? String(review.reportStoragePath ?? "") : String(review.sourceStoragePath ?? "");

  if (!storagePath) {
    return NextResponse.json({ ok: false, error: kind === "report" ? "審圖報告尚未產生。" : "找不到原始施工圖。" }, { status: 404 });
  }

  const file = getAdminStorageBucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return NextResponse.json({ ok: false, error: "檔案不存在或已被移除。" }, { status: 404 });

  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 10 * 60 * 1000
  });

  return NextResponse.json({ ok: true, url: signedUrl, expiresInSeconds: 600 });
}
