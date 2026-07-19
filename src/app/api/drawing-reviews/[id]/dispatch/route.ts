import { NextResponse } from "next/server";
import { getAdminDb, getGoogleCloudAccessToken } from "@/lib/firebaseAdmin";
import { canAccessProject, canCreateDrawingReview, verifyApiCaller } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyApiCaller(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!canCreateDrawingReview(auth.caller)) {
    return NextResponse.json({ ok: false, error: "目前角色只能查看審圖結果。" }, { status: 403 });
  }

  const { id } = await params;
  const database = getAdminDb();
  const reviewRef = database.collection("drawing_reviews").doc(id);
  const reviewSnapshot = await reviewRef.get();
  const review = reviewSnapshot.data();

  if (!reviewSnapshot.exists || !review) {
    return NextResponse.json({ ok: false, error: "找不到審圖工作。" }, { status: 404 });
  }

  const projectSnapshot = await database.collection("projects").doc(String(review.projectId ?? "")).get();
  if (!canAccessProject(auth.caller, projectSnapshot.data())) {
    return NextResponse.json({ ok: false, error: "沒有此案件的審圖權限。" }, { status: 403 });
  }

  const cloudRunJob = process.env.DRAWING_REVIEW_CLOUD_RUN_JOB?.trim();
  const workerUrl = process.env.DRAWING_REVIEW_WORKER_URL?.trim();
  if (!cloudRunJob && !workerUrl) {
    return NextResponse.json({
      ok: true,
      dispatched: false,
      status: "queued",
      message: "PDF 已安全上傳；背景審圖服務尚未設定，工作會保留在等待佇列。"
    }, { status: 202 });
  }

  if (cloudRunJob) {
    try {
      const response = await fetch(`https://run.googleapis.com/v2/${cloudRunJob}:run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getGoogleCloudAccessToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          overrides: {
            containerOverrides: [{
              env: [{ name: "DRAWING_REVIEW_ID", value: reviewSnapshot.id }]
            }],
            taskCount: 1,
            timeout: "3600s"
          }
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `CLOUD_RUN_JOB_${response.status}`);
      }
      await reviewRef.update({
        statusMessage: "已交付 Cloud Run 背景審圖工作。",
        updatedAt: new Date()
      });
      return NextResponse.json({ ok: true, dispatched: true, mode: "cloud-run-job", status: "queued" }, { status: 202 });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Cloud Run Job 暫時無法啟動。";
      return NextResponse.json({ ok: false, error: `審圖工作已保留，可稍後重試：${message}` }, { status: 502 });
    }
  }

  if (!workerUrl) {
    return NextResponse.json({ ok: false, error: "背景審圖服務尚未設定。" }, { status: 500 });
  }

  const workerToken = process.env.DRAWING_REVIEW_WORKER_TOKEN?.trim();
  if (!workerToken) {
    return NextResponse.json({ ok: false, error: "背景審圖服務金鑰尚未設定。" }, { status: 500 });
  }

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reviewId: reviewSnapshot.id,
        projectId: String(review.projectId ?? ""),
        sourceStoragePath: String(review.sourceStoragePath ?? ""),
        ruleSetVersion: String(review.ruleSetVersion ?? "")
      }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `WORKER_${response.status}`);
    }

    await reviewRef.update({
      statusMessage: "已交付背景審圖服務。",
      updatedAt: new Date()
    });

    return NextResponse.json({ ok: true, dispatched: true, status: "queued" }, { status: 202 });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "背景審圖服務暫時無法連線。";
    return NextResponse.json({ ok: false, error: `審圖工作已保留，可稍後重試：${message}` }, { status: 502 });
  }
}
