import {
  DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
  getConfiguredTimeoutMs
} from "@/lib/audioMemoDrafts";

export type AudioTranscriptionInput = {
  fileName: string;
  contentType: string;
  buffer: Buffer;
};

export type AudioTranscriptionSegment = {
  index: number;
  fileName: string;
  transcript: string;
};

export type AudioTranscriptionResult = {
  transcript: string;
  segments: AudioTranscriptionSegment[];
};

export async function transcribeAudioBuffer(input: AudioTranscriptionInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定，無法進行語音轉文字。");

  const preferredModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
  const models = preferredModel === "whisper-1" ? ["whisper-1"] : [preferredModel, "whisper-1"];
  const timeoutMs = getConfiguredTimeoutMs(process.env.OPENAI_TRANSCRIPTION_TIMEOUT_MS, DEFAULT_TRANSCRIPTION_TIMEOUT_MS);
  let lastError = "語音轉文字失敗。";

  for (const model of models) {
    const body = new FormData();
    const bytes = Uint8Array.from(input.buffer);
    body.append("model", model);
    body.append("language", "zh");
    body.append("file", new Blob([bytes], { type: input.contentType }), input.fileName);

    try {
      const { response, result } = await fetchJsonWithTimeout<{ text?: string; error?: { message?: string } }>(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`
          },
          body
        },
        timeoutMs
      );

      if (response.ok && result.text?.trim()) return result.text.trim();

      lastError = result.error?.message || `語音轉文字失敗：${response.status}`;
    } catch (caught) {
      lastError = isAbortError(caught) ? "語音轉文字逾時，請先用較短音檔重試。" : getErrorMessage(caught);
    }
  }

  throw new Error(lastError);
}

export async function transcribeAudioSegments(inputs: AudioTranscriptionInput[]): Promise<AudioTranscriptionResult> {
  const segments: AudioTranscriptionSegment[] = [];

  for (const [index, input] of inputs.entries()) {
    const transcript = await transcribeAudioBuffer(input);
    segments.push({
      index: index + 1,
      fileName: input.fileName,
      transcript
    });
  }

  return {
    transcript: formatCombinedTranscript(segments),
    segments
  };
}

export function formatCombinedTranscript(segments: AudioTranscriptionSegment[]) {
  if (segments.length <= 1) return segments[0]?.transcript ?? "";

  return segments.map((segment) => `【錄音分段 ${segment.index}：${segment.fileName}】\n${segment.transcript}`).join("\n\n");
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const result = (await response.json()) as T;

    return { response, result };
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(caught: unknown) {
  return caught instanceof Error && caught.name === "AbortError";
}

function getErrorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : "外部語音服務暫時無法回應。";
}
