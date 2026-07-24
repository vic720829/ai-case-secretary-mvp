import { FieldValue } from "firebase-admin/firestore";
import { analyzeFinanceMessage } from "@/lib/financeMessageRules";

type CreateFinanceLineDraftsInput = {
  projectId: string;
  groupId: string;
  sourceMessageId: string;
  sourceLineMessageId: string;
  sourceSenderId: string;
  sourceSenderName: string;
  text: string;
  timestamp?: number;
};

export type CreateFinanceLineDraftsResult = {
  created: number;
  draftIds: string[];
  amountMismatch: boolean;
  errorMessage: string;
};

export async function createFinanceDraftsFromLineMessage(
  db: FirebaseFirestore.Firestore,
  input: CreateFinanceLineDraftsInput
): Promise<CreateFinanceLineDraftsResult> {
  if (!input.projectId || !input.sourceMessageId || !input.text.trim()) {
    return emptyResult();
  }

  const suggestions = analyzeFinanceMessage(input.text);
  if (!suggestions.length) return emptyResult();

  const existing = await db
    .collection("finance_drafts")
    .where("sourceMessageId", "==", input.sourceMessageId)
    .limit(1)
    .get();
  if (!existing.empty) {
    return {
      created: 0,
      draftIds: existing.docs.map((item) => item.id),
      amountMismatch: existing.docs.some((item) => item.data().amountMismatch === true),
      errorMessage: ""
    };
  }

  const date = taipeiDateString(input.timestamp);
  const batch = db.batch();
  const draftIds: string[] = [];

  suggestions.forEach((suggestion, index) => {
    const draftRef = db
      .collection("finance_drafts")
      .doc(`${input.sourceMessageId}_${suggestion.draftType}_${index + 1}`);
    draftIds.push(draftRef.id);
    batch.set(draftRef, {
      projectId: input.projectId,
      contractId: "",
      groupId: input.groupId,
      draftType: suggestion.draftType,
      title: suggestion.title,
      amount: suggestion.amount,
      totalAmount: suggestion.totalAmount,
      adjustments: suggestion.adjustments,
      date,
      accountId: "",
      notes: `LINE 原文：${input.text}`,
      sourceMessageId: input.sourceMessageId,
      sourceLineMessageId: input.sourceLineMessageId,
      sourceMessageText: input.text,
      sourceSenderId: input.sourceSenderId,
      sourceSenderName: input.sourceSenderName,
      confidence: suggestion.confidence,
      amountMismatch: suggestion.amountMismatch,
      duplicateWarning: "",
      status: "pending",
      reviewedBy: "",
      reviewedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await batch.commit();

  return {
    created: draftIds.length,
    draftIds,
    amountMismatch: suggestions.some((item) => item.amountMismatch),
    errorMessage: ""
  };
}

export function financeDraftErrorResult(caught: unknown): CreateFinanceLineDraftsResult {
  return {
    ...emptyResult(),
    errorMessage: caught instanceof Error ? caught.message : "Unknown finance draft error"
  };
}

function emptyResult(): CreateFinanceLineDraftsResult {
  return {
    created: 0,
    draftIds: [],
    amountMismatch: false,
    errorMessage: ""
  };
}

function taipeiDateString(timestamp?: number) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}
