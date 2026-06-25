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
  postback?: {
    data?: string;
  };
};

export type LinePushMessage =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "template";
      altText: string;
      template: {
        type: "buttons";
        title?: string;
        text: string;
        actions: Array<{
          type: "postback";
          label: string;
          data: string;
          displayText?: string;
        }>;
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

export async function getLineSenderName(event: LineWebhookEvent) {
  const userId = event.source?.userId;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!userId) return "LINE 使用者";
  if (!accessToken) return userId;

  const encodedUserId = encodeURIComponent(userId);
  const sourceType = event.source?.type;
  const groupId = event.source?.groupId;
  const roomId = event.source?.roomId;

  let profileUrl = `https://api.line.me/v2/bot/profile/${encodedUserId}`;
  if (sourceType === "group" && groupId) {
    profileUrl = `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodedUserId}`;
  }
  if (sourceType === "room" && roomId) {
    profileUrl = `https://api.line.me/v2/bot/room/${encodeURIComponent(roomId)}/member/${encodedUserId}`;
  }

  try {
    const response = await fetch(profileUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) return userId;

    const profile = (await response.json()) as { displayName?: string };
    return profile.displayName?.trim() || userId;
  } catch {
    return userId;
  }
}

export async function getLineGroupName(event: LineWebhookEvent) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const sourceType = event.source?.type;
  const groupId = event.source?.groupId;

  if (!accessToken || sourceType !== "group" || !groupId) return "";

  try {
    const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) return "";

    const summary = (await response.json()) as { groupName?: string };
    return summary.groupName?.trim() ?? "";
  } catch {
    return "";
  }
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

export async function downloadLineMessageContent(messageId: string) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!messageId || !accessToken) return null;

  const response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) return null;

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream"
  };
}

export async function pushLineText(to: string, text: string) {
  return pushLineMessages(to, [{ type: "text", text }]);
}

export async function pushLineMessages(to: string, messages: LinePushMessage[]) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!to || !accessToken) return;

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to,
      messages: messages.slice(0, 5).map(normalizeLinePushMessage)
    })
  });

  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status}`);
  }
}

function normalizeLinePushMessage(message: LinePushMessage): LinePushMessage {
  if (message.type === "text") {
    return {
      ...message,
      text: message.text.slice(0, 4900)
    };
  }

  return {
    ...message,
    altText: message.altText.slice(0, 400),
    template: {
      ...message.template,
      title: message.template.title?.slice(0, 40),
      text: message.template.text.slice(0, 160),
      actions: message.template.actions.slice(0, 4).map((action) => ({
        ...action,
        label: action.label.slice(0, 20),
        data: action.data.slice(0, 300),
        displayText: action.displayText?.slice(0, 300)
      }))
    }
  };
}
