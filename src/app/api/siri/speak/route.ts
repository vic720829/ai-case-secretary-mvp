import { timingSafeEqual } from "node:crypto";
import { answerQuestionFromFirestore } from "@/services/aiAssistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (!verifySiriToken(request, url)) {
    return textResponse("Siri token 不正確。", 401);
  }

  const question = normalizeQuestion(url.searchParams.get("question") ?? url.searchParams.get("q"));
  const projectId = normalizeQuestion(url.searchParams.get("projectId"));

  return answerAsPlainText(question, projectId);
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  if (!verifySiriToken(request, url)) {
    return textResponse("Siri token 不正確。", 401);
  }

  const question = normalizeQuestion(await request.text());
  const projectId = normalizeQuestion(url.searchParams.get("projectId"));

  return answerAsPlainText(question, projectId);
}

async function answerAsPlainText(question: string, projectId: string) {
  if (!question) {
    return textResponse("請先說出你想問的問題。", 400);
  }

  if (question.length > 500) {
    return textResponse("問題太長了，請縮短一點再問。", 400);
  }

  try {
    const answer = await answerQuestionFromFirestore(question, projectId);

    return textResponse(answer);
  } catch (caught) {
    console.error("Siri speak request failed", caught);

    return textResponse("系統暫時無法回答，請稍後再試。", 500);
  }
}

function normalizeQuestion(value: unknown) {
  return String(value ?? "").trim();
}

function verifySiriToken(request: Request, url: URL) {
  const expectedToken = process.env.SIRI_ASSISTANT_TOKEN ?? "";
  if (!expectedToken) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const headerToken = request.headers.get("x-siri-assistant-token") ?? "";
  const queryToken = url.searchParams.get("token") ?? "";
  const receivedToken = bearerToken || headerToken || queryToken;

  if (!receivedToken) return false;

  const expected = Buffer.from(expectedToken);
  const received = Buffer.from(receivedToken);

  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

function textResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
