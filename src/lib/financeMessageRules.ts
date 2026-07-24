export type FinanceMessageAdjustment = {
  type: "add" | "deduct";
  name: string;
  amount: number;
};

export type FinanceMessageSuggestion = {
  draftType: "payment" | "adjustment_add" | "adjustment_deduct" | "cost";
  title: string;
  amount: number;
  totalAmount: number;
  adjustments: FinanceMessageAdjustment[];
  confidence: number;
  amountMismatch: boolean;
};

type AmountMatch = {
  amount: number;
  index: number;
  end: number;
  raw: string;
};

const paymentKeywords = /(?:已收到|已收訖|收訖|收到|已入帳|入帳|已收款)/g;
const costKeywords = /(?:已付款|已支付|已付|已匯給|付給|支付給)/g;
const adjustmentKeywords = /(?:追加|加項|減項|追減|扣減)/g;
const totalKeywords = /(?:共計|合計|總計|共|總額|實收|實付)\s*(?:為|是|[:：])?\s*/g;
const amountPattern =
  /(?:\d[\d,]*(?:\.\d+)?\s*萬(?:\s*\d+(?:\.\d+)?\s*(?:千|仟)?)?|\d[\d,]*(?:\.\d+)?\s*(?:千|仟)?)(?:\s*元(?:整)?)?/g;

export function analyzeFinanceMessage(text: string): FinanceMessageSuggestion[] {
  const normalized = normalizeFinanceText(text);
  if (!normalized || isQuestionOrNegative(normalized)) return [];

  const adjustments = extractAdjustments(normalized);
  const payment = extractMoneyMovement(normalized, paymentKeywords, "payment");
  const cost = extractMoneyMovement(normalized, costKeywords, "cost");
  const suggestions: FinanceMessageSuggestion[] = [];

  if (payment) {
    const explicitTotal = extractExplicitTotal(normalized);
    const additions = adjustments
      .filter((item) => item.type === "add")
      .reduce((sum, item) => sum + item.amount, 0);
    const deductions = adjustments
      .filter((item) => item.type === "deduct")
      .reduce((sum, item) => sum + item.amount, 0);
    const calculatedTotal = payment.amount + additions - deductions;
    const totalAmount = explicitTotal?.amount ?? calculatedTotal;

    suggestions.push({
      draftType: "payment",
      title: payment.title || "LINE 收款",
      amount: payment.amount,
      totalAmount,
      adjustments,
      confidence: explicitTotal ? 0.99 : 0.97,
      amountMismatch: Boolean(explicitTotal && Math.abs(explicitTotal.amount - calculatedTotal) > 1)
    });
  } else {
    adjustments.forEach((adjustment) => {
      suggestions.push({
        draftType: adjustment.type === "add" ? "adjustment_add" : "adjustment_deduct",
        title: adjustment.name,
        amount: adjustment.amount,
        totalAmount: adjustment.amount,
        adjustments: [],
        confidence: 0.96,
        amountMismatch: false
      });
    });
  }

  if (cost) {
    suggestions.push({
      draftType: "cost",
      title: cost.title || "LINE 成本支出",
      amount: cost.amount,
      totalAmount: cost.amount,
      adjustments: [],
      confidence: 0.97,
      amountMismatch: false
    });
  }

  return suggestions;
}

function normalizeFinanceText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[，,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionOrNegative(text: string) {
  if (/[?？嗎]/.test(text) || /(?:是否|有沒有|有無)/.test(text)) return true;

  return /(?:未收到|沒收到|尚未收到|還沒收到|未入帳|沒入帳|尚未入帳|還沒入帳|未付款|沒付款|尚未付款|還沒付款)/.test(
    text
  );
}

function extractMoneyMovement(
  text: string,
  keywordPattern: RegExp,
  kind: "payment" | "cost"
): { title: string; amount: number } | null {
  const keywords = matchAll(text, keywordPattern);
  if (!keywords.length) return null;

  for (const keyword of keywords) {
    const segmentEnd = findNextBoundary(text, keyword.end);
    const segment = text.slice(keyword.end, segmentEnd);
    const amount = firstAmount(segment);
    if (!amount) continue;

    let title = cleanTitle(segment.slice(0, amount.index));
    if (!title) {
      const prefixStart = findPreviousBoundary(text, keyword.index);
      title = cleanTitle(text.slice(prefixStart, keyword.index));
    }

    return {
      title: stripMovementWords(title, kind),
      amount: amount.amount
    };
  }

  return null;
}

function extractAdjustments(text: string) {
  return matchAll(text, adjustmentKeywords)
    .map((keyword): FinanceMessageAdjustment | null => {
      const segmentEnd = findNextBoundary(text, keyword.end);
      const segment = text.slice(keyword.end, segmentEnd);
      const amount = firstAmount(segment);
      if (!amount) return null;

      return {
        type: keyword.raw === "追加" || keyword.raw === "加項" ? "add" : "deduct",
        name: cleanTitle(segment.slice(0, amount.index)),
        amount: amount.amount
      };
    })
    .filter((item): item is FinanceMessageAdjustment => Boolean(item));
}

function extractExplicitTotal(text: string) {
  const totalMatches = matchAll(text, totalKeywords);

  for (let index = totalMatches.length - 1; index >= 0; index -= 1) {
    const totalMatch = totalMatches[index];
    const amount = firstAmount(text.slice(totalMatch.end, totalMatch.end + 40));
    if (amount) return amount;
  }

  return null;
}

function firstAmount(text: string): AmountMatch | null {
  amountPattern.lastIndex = 0;
  const match = amountPattern.exec(text);
  if (!match) return null;

  const amount = parseAmount(match[0]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    amount,
    index: match.index,
    end: match.index + match[0].length,
    raw: match[0]
  };
}

function parseAmount(raw: string) {
  const value = raw
    .replace(/[，,\s]/g, "")
    .replace(/元整?$/, "");
  const tenThousands = value.match(/^(\d+(?:\.\d+)?)萬(?:(\d+(?:\.\d+)?)(千|仟)?)?$/);

  if (tenThousands) {
    const base = Number(tenThousands[1]) * 10_000;
    const remainderText = tenThousands[2];
    if (!remainderText) return base;

    const remainder = Number(remainderText);
    if (tenThousands[3]) return base + remainder * 1_000;
    if (/^\d$/.test(remainderText)) return base + remainder * 1_000;
    return base + remainder;
  }

  const thousands = value.match(/^(\d+(?:\.\d+)?)(?:千|仟)$/);
  if (thousands) return Number(thousands[1]) * 1_000;

  return Number(value);
}

function matchAll(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  const matches: Array<{ index: number; end: number; raw: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      raw: match[0]
    });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return matches;
}

function findNextBoundary(text: string, from: number) {
  const candidates = [
    findIndexAfter(text, /[。；;\n]/g, from),
    findMatchAfter(text, adjustmentKeywords, from),
    findMatchAfter(text, totalKeywords, from)
  ].filter((value) => value >= 0);

  return candidates.length ? Math.min(...candidates) : text.length;
}

function findPreviousBoundary(text: string, from: number) {
  const slice = text.slice(0, from);
  const indices = ["。", "；", ";", "\n"].map((separator) => slice.lastIndexOf(separator));
  return Math.max(...indices) + 1;
}

function findIndexAfter(text: string, pattern: RegExp, from: number) {
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match?.index ?? -1;
}

function findMatchAfter(text: string, pattern: RegExp, from: number) {
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match?.index ?? -1;
}

function cleanTitle(value: string) {
  return value
    .replace(/^[\s:：，,、\-]+|[\s:：，,、\-]+$/g, "")
    .replace(/^(?:款項|款別|金額)\s*(?:為|是|[:：])?\s*/g, "")
    .replace(/\s*(?:金額)?$/g, "")
    .trim();
}

function stripMovementWords(value: string, kind: "payment" | "cost") {
  if (kind === "payment") {
    return value.replace(/^(?:客戶|業主)\s*/g, "").trim();
  }

  return value.replace(/^(?:廠商|師傅)\s*/g, "").trim();
}
