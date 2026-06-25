import { createHmac, timingSafeEqual } from "node:crypto";

export type LineWebhookEvent = {
  type: string;
  replyToken?: string;
  timestamp?: number;
  source?: {
    type?: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: "text" | "image" | "audio" | string;
    text?: string;
  };
};

export function verifyLineSignature(rawBody: string, signature: string | null) {
  if (process.env.LINE_SKIP_SIGNATURE_VERIFY === "true") return true;

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  const expected = Buffer.from(digest);
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function getEventGroupId(event: LineWebhookEvent) {
  return event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? "";
}

export async function replyLineText(replyToken: string | undefined, text: string) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!replyToken || !accessToken) return;

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: text.slice(0, 4900)
        }
      ]
    })
  });
}
