import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
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
    return NextResponse.json({ ok: false, error: "Invalid LINE signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const { handleLineWebhookEvents } = await import("./handler");
  return handleLineWebhookEvents(events as LineWebhookEvent[]);
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
