import { NextResponse } from "next/server";
import { downloadLineMessageContent } from "@/services/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await context.params;

  if (!/^\d+$/.test(messageId)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const content = await downloadLineMessageContent(messageId);

  if (!content) {
    return NextResponse.json({ error: "LINE content not found" }, { status: 404 });
  }

  return new Response(content.buffer, {
    headers: {
      "Content-Type": content.contentType,
      "Cache-Control": "private, max-age=3600"
    }
  });
}
