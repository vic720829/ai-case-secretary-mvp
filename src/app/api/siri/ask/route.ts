import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { answerQuestionFromFirestore } from "@/services/aiAssistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SiriAskBody = {
  question?: unknown;
  q?: unknown;
  text?: unknown;
  projectId?: unknown;
};

export async function GET(request: Request) {
  const url = new URL(request.url);

  return handleSiriAsk(request, {
    question: url.searchParams.get("question") ?? url.searchParams.get("q") ?? "",
    projectId: url.searchParams.get("projectId") ?? ""
  });
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);

  return handleSiriAsk(request, body);
}

async function handleSiriAsk(request: Request, input: SiriAskBody) {
  if (!verifySiriToken(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized Siri assistant request" }, { status: 401 });
  }

  const question = normalizeQuestion(input.question ?? input.q ?? input.text);
  const projectId = normalizeProjectId(input.projectId);

  if (!question) {
    return NextResponse.json({ ok: false, error: "Missing question" }, { status: 400 });
  }

  if (question.length > 500) {
    return NextResponse.json({ ok: false, error: "Question is too long" }, { status: 400 });
  }

  try {
    const answer = await answerQuestionFromFirestore(question, projectId);

    return NextResponse.json({
      ok: true,
      question,
      answer,
      speakText: answer
    });
  } catch (caught) {
    console.error("Siri assistant request failed", caught);

    return NextResponse.json({ ok: false, error: "Siri assistant request failed" }, { status: 500 });
  }
}

async function readJsonBody(request: Request): Promise<SiriAskBody> {
  try {
    return (await request.json()) as SiriAskBody;
  } catch {
    return {};
  }
}

function normalizeQuestion(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeProjectId(value: unknown) {
  return String(value ?? "").trim();
}

function verifySiriToken(request: Request) {
  const expectedToken = process.env.SIRI_ASSISTANT_TOKEN ?? "";
  if (!expectedToken) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const headerToken = request.headers.get("x-siri-assistant-token") ?? "";
  const receivedToken = bearerToken || headerToken;

  if (!receivedToken) return false;

  const expected = Buffer.from(expectedToken);
  const received = Buffer.from(receivedToken);

  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
