import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { LineWebhookEvent } from "@/services/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineWebhookBody = {
  events?: unknown[];
};

export async function GET() {
  return NextResponse.json({ ok: true, service: "line-webhook" });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    await writeRouteDiagnosticLog({
      eventType: "signature_error",
      status: "error",
      reason: "Invalid LINE signature",
      errorMessage: signature ? "LINE signature did not match server secret" : "Missing x-line-signature header"
    });
    return NextResponse.json({ ok: false, error: "Invalid LINE signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    await writeRouteDiagnosticLog({
      eventType: "invalid_json",
      status: "error",
      reason: "Invalid JSON body",
      errorMessage: rawBody.slice(0, 300)
    });
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) {
    await writeRouteDiagnosticLog({
      eventType: "empty_events",
      status: "skipped",
      reason: "LINE webhook reached server with no events",
      errorMessage: ""
    });
    return NextResponse.json({ ok: true, results: [] });
  }

  try {
    const { handleLineWebhookEvents } = await import("./handler");
    return await handleLineWebhookEvents(events as LineWebhookEvent[]);
  } catch (caught) {
    console.error("LINE webhook handler failed", caught);

    return NextResponse.json(
      {
        ok: false,
        error: "LINE webhook handler failed"
      },
      { status: 500 }
    );
  }
}

function verifyLineSignature(rawBody: string, signature: string | null) {
  if (process.env.LINE_SKIP_SIGNATURE_VERIFY === "true") return true;

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  const expected = Buffer.from(digest);
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

async function writeRouteDiagnosticLog(input: {
  eventType: string;
  status: "success" | "skipped" | "error";
  reason: string;
  errorMessage: string;
}) {
  try {
    const db = getAdminDb();
    await db.collection("webhook_logs").add({
      eventType: input.eventType,
      status: input.status,
      groupId: "",
      userId: "",
      projectId: "",
      messageId: "",
      lineMessageId: "",
      messageType: "",
      senderName: "",
      senderRole: "",
      messageText: "",
      aiTaskDrafts: 0,
      adminNotifications: 0,
      adminNotificationFailures: 0,
      assistantReply: "",
      reason: input.reason,
      errorMessage: input.errorMessage,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch {
    // Diagnostic logging should never block LINE webhook responses.
  }
}
