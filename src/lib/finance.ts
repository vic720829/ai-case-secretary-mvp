import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  AuditActor,
  FinanceAccount,
  FinanceAccountInput,
  FinanceAdjustment,
  FinanceAdjustmentInput,
  FinanceCost,
  FinanceCostInput,
  FinanceData,
  FinanceDraft,
  FinanceLedger,
  FinanceLedgerInput,
  FinancePayment,
  FinancePaymentInput,
  FinanceProjectSettings,
  FinanceProjectSettingsInput
} from "./types";

const FINANCE_PROJECTS_COLLECTION = "finance_project_settings";
const FINANCE_ACCOUNTS_COLLECTION = "finance_accounts";
const FINANCE_PAYMENTS_COLLECTION = "finance_payments";
const FINANCE_ADJUSTMENTS_COLLECTION = "finance_adjustments";
const FINANCE_COSTS_COLLECTION = "finance_costs";
const FINANCE_LEDGER_COLLECTION = "finance_ledger";
const FINANCE_DRAFTS_COLLECTION = "finance_drafts";
const AUDIT_LOGS_COLLECTION = "audit_logs";

export const DEFAULT_FINANCE_ACCOUNT_ID = "tai-shin-kuan-hong";
export const DEFAULT_FINANCE_ACCOUNT_NAME = "台新（寬宏）";

function requireDb() {
  if (!db) {
    throw new Error("Firebase 尚未設定。");
  }

  return db;
}

function timestampToDate(value: unknown) {
  return value instanceof Timestamp ? value.toDate() : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  return value === true;
}

function financeProjectSettingsFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: stringValue(data.projectId) || snapshot.id,
    code: stringValue(data.code),
    address: stringValue(data.address),
    contractAmount: numberValue(data.contractAmount),
    collectionAmount: numberValue(data.collectionAmount),
    estimatedCost: numberValue(data.estimatedCost),
    startDate: stringValue(data.startDate),
    notes: stringValue(data.notes),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinanceProjectSettings;
}

function financeAccountFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: stringValue(data.name),
    openingBalance: numberValue(data.openingBalance),
    notes: stringValue(data.notes),
    defaultForIncome: booleanValue(data.defaultForIncome),
    active: data.active !== false,
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinanceAccount;
}

function financePaymentFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();
  const status = data.status === "paid" || data.status === "partial" ? data.status : "unpaid";

  return {
    id: snapshot.id,
    projectId: stringValue(data.projectId),
    name: stringValue(data.name),
    dueDate: stringValue(data.dueDate),
    paidDate: stringValue(data.paidDate),
    expectedAmount: numberValue(data.expectedAmount),
    receivedAmount: numberValue(data.receivedAmount),
    accountId: stringValue(data.accountId),
    status,
    notes: stringValue(data.notes),
    source: data.source === "line" ? "line" : "manual",
    sourceMessageId: stringValue(data.sourceMessageId),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinancePayment;
}

function financeAdjustmentFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: stringValue(data.projectId),
    date: stringValue(data.date),
    type: data.type === "deduct" ? "deduct" : "add",
    name: stringValue(data.name),
    amount: numberValue(data.amount),
    notes: stringValue(data.notes),
    source: data.source === "line" ? "line" : "manual",
    sourceMessageId: stringValue(data.sourceMessageId),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinanceAdjustment;
}

function financeCostFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    projectId: stringValue(data.projectId),
    category: stringValue(data.category),
    item: stringValue(data.item),
    vendor: stringValue(data.vendor),
    date: stringValue(data.date),
    amount: numberValue(data.amount),
    accountId: stringValue(data.accountId),
    status: data.status === "paid" ? "paid" : "unpaid",
    notes: stringValue(data.notes),
    source: data.source === "line" ? "line" : "manual",
    sourceMessageId: stringValue(data.sourceMessageId),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinanceCost;
}

function financeLedgerFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    date: stringValue(data.date),
    accountId: stringValue(data.accountId),
    type: data.type === "out" ? "out" : "in",
    category: stringValue(data.category),
    amount: numberValue(data.amount),
    item: stringValue(data.item),
    notes: stringValue(data.notes),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinanceLedger;
}

function financeDraftFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data();
  const draftType =
    data.draftType === "adjustment_add" ||
    data.draftType === "adjustment_deduct" ||
    data.draftType === "cost"
      ? data.draftType
      : "payment";
  const status = data.status === "approved" || data.status === "ignored" ? data.status : "pending";

  return {
    id: snapshot.id,
    projectId: stringValue(data.projectId),
    draftType,
    title: stringValue(data.title),
    amount: numberValue(data.amount),
    totalAmount: numberValue(data.totalAmount),
    date: stringValue(data.date),
    accountId: stringValue(data.accountId),
    notes: stringValue(data.notes),
    sourceMessageId: stringValue(data.sourceMessageId),
    sourceMessageText: stringValue(data.sourceMessageText),
    sourceSenderId: stringValue(data.sourceSenderId),
    sourceSenderName: stringValue(data.sourceSenderName),
    confidence: numberValue(data.confidence),
    amountMismatch: booleanValue(data.amountMismatch),
    duplicateWarning: stringValue(data.duplicateWarning),
    status,
    reviewedBy: stringValue(data.reviewedBy),
    reviewedAt: timestampToDate(data.reviewedAt),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt)
  } satisfies FinanceDraft;
}

function sortNewest<T extends { createdAt: Date | null }>(items: T[]) {
  return items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listFinanceData(): Promise<FinanceData> {
  const database = requireDb();
  const [
    projectSettingsSnapshot,
    accountsSnapshot,
    paymentsSnapshot,
    adjustmentsSnapshot,
    costsSnapshot,
    ledgerSnapshot,
    draftsSnapshot
  ] = await Promise.all([
    getDocs(collection(database, FINANCE_PROJECTS_COLLECTION)),
    getDocs(collection(database, FINANCE_ACCOUNTS_COLLECTION)),
    getDocs(collection(database, FINANCE_PAYMENTS_COLLECTION)),
    getDocs(collection(database, FINANCE_ADJUSTMENTS_COLLECTION)),
    getDocs(collection(database, FINANCE_COSTS_COLLECTION)),
    getDocs(collection(database, FINANCE_LEDGER_COLLECTION)),
    getDocs(collection(database, FINANCE_DRAFTS_COLLECTION))
  ]);

  return {
    projectSettings: projectSettingsSnapshot.docs.map(financeProjectSettingsFromDoc),
    accounts: sortNewest(accountsSnapshot.docs.map(financeAccountFromDoc)),
    payments: sortNewest(paymentsSnapshot.docs.map(financePaymentFromDoc)),
    adjustments: sortNewest(adjustmentsSnapshot.docs.map(financeAdjustmentFromDoc)),
    costs: sortNewest(costsSnapshot.docs.map(financeCostFromDoc)),
    ledger: sortNewest(ledgerSnapshot.docs.map(financeLedgerFromDoc)),
    drafts: sortNewest(draftsSnapshot.docs.map(financeDraftFromDoc))
  };
}

function auditRef(database: Firestore) {
  return doc(collection(database, AUDIT_LOGS_COLLECTION));
}

function addAudit(
  batch: ReturnType<typeof writeBatch>,
  database: Firestore,
  actor: AuditActor | null | undefined,
  action: "create" | "update" | "delete",
  resourceType: string,
  resourceId: string,
  resourceName: string
) {
  if (!actor) return;

  batch.set(auditRef(database), {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorName: actor.displayName || actor.email,
    action,
    resourceType,
    resourceId,
    resourceName,
    changes: [
      {
        field: "財務資料",
        before: action === "create" ? "" : "原始資料",
        after: action === "delete" ? "" : "已更新"
      }
    ],
    createdAt: serverTimestamp()
  });
}

async function saveRecord<T extends object>(
  collectionName: string,
  id: string,
  input: T,
  actor: AuditActor | null | undefined,
  resourceType: string,
  resourceName: string
) {
  const database = requireDb();
  const ref = id ? doc(database, collectionName, id) : doc(collection(database, collectionName));
  const existing = await getDoc(ref);
  const batch = writeBatch(database);

  batch.set(
    ref,
    {
      ...input,
      createdAt: existing.exists() ? existing.data().createdAt ?? serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  addAudit(batch, database, actor, existing.exists() ? "update" : "create", resourceType, ref.id, resourceName);
  await batch.commit();

  return ref.id;
}

async function deleteRecord(
  collectionName: string,
  id: string,
  actor: AuditActor | null | undefined,
  resourceType: string,
  resourceName: string
) {
  const database = requireDb();
  const batch = writeBatch(database);

  batch.delete(doc(database, collectionName, id));
  addAudit(batch, database, actor, "delete", resourceType, id, resourceName);
  await batch.commit();
}

export async function ensureDefaultFinanceAccount(actor?: AuditActor | null) {
  const database = requireDb();
  const snapshot = await getDocs(collection(database, FINANCE_ACCOUNTS_COLLECTION));
  const existingDefault = snapshot.docs.find((item) => item.data().defaultForIncome === true);

  if (existingDefault) return existingDefault.id;

  const matchingAccount = snapshot.docs.find((item) => item.data().name === DEFAULT_FINANCE_ACCOUNT_NAME);
  const accountId = matchingAccount?.id ?? DEFAULT_FINANCE_ACCOUNT_ID;

  await saveRecord(
    FINANCE_ACCOUNTS_COLLECTION,
    accountId,
    {
      name: DEFAULT_FINANCE_ACCOUNT_NAME,
      openingBalance: matchingAccount ? numberValue(matchingAccount.data().openingBalance) : 0,
      notes: matchingAccount ? stringValue(matchingAccount.data().notes) : "案件收款預設帳戶",
      defaultForIncome: true,
      active: true
    } satisfies FinanceAccountInput,
    actor,
    "finance_account",
    DEFAULT_FINANCE_ACCOUNT_NAME
  );

  return accountId;
}

export function saveFinanceProjectSettings(input: FinanceProjectSettingsInput, actor?: AuditActor | null) {
  return saveRecord(
    FINANCE_PROJECTS_COLLECTION,
    input.projectId,
    input,
    actor,
    "finance_project_settings",
    input.code || input.projectId
  );
}

export async function saveFinanceAccount(id: string, input: FinanceAccountInput, actor?: AuditActor | null) {
  if (!input.defaultForIncome) {
    return saveRecord(FINANCE_ACCOUNTS_COLLECTION, id, input, actor, "finance_account", input.name);
  }

  const database = requireDb();
  const ref = id ? doc(database, FINANCE_ACCOUNTS_COLLECTION, id) : doc(collection(database, FINANCE_ACCOUNTS_COLLECTION));
  const [existing, accountsSnapshot] = await Promise.all([
    getDoc(ref),
    getDocs(collection(database, FINANCE_ACCOUNTS_COLLECTION))
  ]);
  const batch = writeBatch(database);

  accountsSnapshot.docs.forEach((account) => {
    if (account.id !== ref.id && account.data().defaultForIncome === true) {
      batch.update(account.ref, {
        defaultForIncome: false,
        updatedAt: serverTimestamp()
      });
    }
  });
  batch.set(
    ref,
    {
      ...input,
      createdAt: existing.exists() ? existing.data().createdAt ?? serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  addAudit(batch, database, actor, existing.exists() ? "update" : "create", "finance_account", ref.id, input.name);
  await batch.commit();

  return ref.id;
}

export function deleteFinanceAccount(id: string, name: string, actor?: AuditActor | null) {
  return deleteRecord(FINANCE_ACCOUNTS_COLLECTION, id, actor, "finance_account", name);
}

export function saveFinancePayment(id: string, input: FinancePaymentInput, actor?: AuditActor | null) {
  return saveRecord(FINANCE_PAYMENTS_COLLECTION, id, input, actor, "finance_payment", input.name);
}

export function deleteFinancePayment(id: string, name: string, actor?: AuditActor | null) {
  return deleteRecord(FINANCE_PAYMENTS_COLLECTION, id, actor, "finance_payment", name);
}

export function saveFinanceAdjustment(id: string, input: FinanceAdjustmentInput, actor?: AuditActor | null) {
  return saveRecord(FINANCE_ADJUSTMENTS_COLLECTION, id, input, actor, "finance_adjustment", input.name || "未命名追加減");
}

export function deleteFinanceAdjustment(id: string, name: string, actor?: AuditActor | null) {
  return deleteRecord(FINANCE_ADJUSTMENTS_COLLECTION, id, actor, "finance_adjustment", name || "未命名追加減");
}

export function saveFinanceCost(id: string, input: FinanceCostInput, actor?: AuditActor | null) {
  return saveRecord(FINANCE_COSTS_COLLECTION, id, input, actor, "finance_cost", input.item || input.category);
}

export function deleteFinanceCost(id: string, name: string, actor?: AuditActor | null) {
  return deleteRecord(FINANCE_COSTS_COLLECTION, id, actor, "finance_cost", name);
}

export function saveFinanceLedger(id: string, input: FinanceLedgerInput, actor?: AuditActor | null) {
  return saveRecord(FINANCE_LEDGER_COLLECTION, id, input, actor, "finance_ledger", input.item || input.category);
}

export function deleteFinanceLedger(id: string, name: string, actor?: AuditActor | null) {
  return deleteRecord(FINANCE_LEDGER_COLLECTION, id, actor, "finance_ledger", name);
}

export async function ignoreFinanceDraft(id: string, reviewedBy: string) {
  const database = requireDb();

  await updateDoc(doc(database, FINANCE_DRAFTS_COLLECTION, id), {
    status: "ignored",
    reviewedBy,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function approveFinanceDraft(
  draft: FinanceDraft,
  accountId: string,
  reviewedBy: string,
  actor?: AuditActor | null
) {
  const database = requireDb();
  const draftRef = doc(database, FINANCE_DRAFTS_COLLECTION, draft.id);
  const targetRef = financeDraftTargetRef(database, draft);
  const batch = writeBatch(database);
  const amount = draft.totalAmount || draft.amount;
  const base = {
    projectId: draft.projectId,
    notes: draft.notes || `來源：${draft.sourceMessageText}`,
    source: "line" as const,
    sourceMessageId: draft.sourceMessageId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (draft.draftType === "payment") {
    batch.set(targetRef, {
      ...base,
      name: draft.title || "案件收款",
      dueDate: draft.date,
      paidDate: draft.date,
      expectedAmount: amount,
      receivedAmount: amount,
      accountId,
      status: "paid"
    } satisfies Omit<FinancePayment, "id" | "createdAt" | "updatedAt"> & {
      createdAt: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    });
  } else if (draft.draftType === "cost") {
    batch.set(targetRef, {
      ...base,
      category: draft.title || "工程成本",
      item: "",
      vendor: "",
      date: draft.date,
      amount: draft.amount,
      accountId,
      status: "paid"
    });
  } else {
    batch.set(targetRef, {
      ...base,
      date: draft.date,
      type: draft.draftType === "adjustment_deduct" ? "deduct" : "add",
      name: draft.title,
      amount: draft.amount
    });
  }

  batch.update(draftRef, {
    status: "approved",
    accountId,
    reviewedBy,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  addAudit(batch, database, actor, "create", "finance_draft_approval", targetRef.id, draft.title || "LINE 財務草稿");
  await batch.commit();

  return targetRef.id;
}

function financeDraftTargetRef(database: Firestore, draft: FinanceDraft): DocumentReference<DocumentData> {
  if (draft.draftType === "payment") {
    return doc(collection(database, FINANCE_PAYMENTS_COLLECTION));
  }
  if (draft.draftType === "cost") {
    return doc(collection(database, FINANCE_COSTS_COLLECTION));
  }

  return doc(collection(database, FINANCE_ADJUSTMENTS_COLLECTION));
}

export async function clearFinanceData(actor?: AuditActor | null) {
  const database = requireDb();
  const collectionNames = [
    FINANCE_PROJECTS_COLLECTION,
    FINANCE_ACCOUNTS_COLLECTION,
    FINANCE_PAYMENTS_COLLECTION,
    FINANCE_ADJUSTMENTS_COLLECTION,
    FINANCE_COSTS_COLLECTION,
    FINANCE_LEDGER_COLLECTION,
    FINANCE_DRAFTS_COLLECTION
  ];
  const snapshots = await Promise.all(collectionNames.map((name) => getDocs(collection(database, name))));
  const batch = writeBatch(database);

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((item) => batch.delete(item.ref));
  });
  addAudit(batch, database, actor, "delete", "finance_data", "all", "全部財務資料");
  await batch.commit();
}

export async function importFinanceBackup(data: FinanceData, actor?: AuditActor | null) {
  const database = requireDb();
  const batch = writeBatch(database);

  data.projectSettings.forEach((item) => {
    batch.set(doc(database, FINANCE_PROJECTS_COLLECTION, item.projectId), {
      ...stripDates(item),
      projectId: item.projectId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
  data.accounts.forEach((item) => {
    batch.set(doc(database, FINANCE_ACCOUNTS_COLLECTION, item.id), {
      ...stripDates(item),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
  data.payments.forEach((item) => setImportedRecord(batch, database, FINANCE_PAYMENTS_COLLECTION, item));
  data.adjustments.forEach((item) => setImportedRecord(batch, database, FINANCE_ADJUSTMENTS_COLLECTION, item));
  data.costs.forEach((item) => setImportedRecord(batch, database, FINANCE_COSTS_COLLECTION, item));
  data.ledger.forEach((item) => setImportedRecord(batch, database, FINANCE_LEDGER_COLLECTION, item));
  data.drafts.forEach((item) => setImportedRecord(batch, database, FINANCE_DRAFTS_COLLECTION, item));
  addAudit(batch, database, actor, "create", "finance_import", "backup", "匯入財務備份");
  await batch.commit();
}

function setImportedRecord(
  batch: ReturnType<typeof writeBatch>,
  database: Firestore,
  collectionName: string,
  item: { id: string; createdAt?: Date | null; updatedAt?: Date | null }
) {
  batch.set(doc(database, collectionName, item.id), {
    ...stripDates(item),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function stripDates<T extends { id: string; createdAt?: Date | null; updatedAt?: Date | null }>(item: T) {
  const rest = { ...item } as Record<string, unknown>;
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

export async function deleteFinanceProjectData(projectId: string) {
  const database = requireDb();
  const snapshots = await Promise.all([
    getDocs(collection(database, FINANCE_PAYMENTS_COLLECTION)),
    getDocs(collection(database, FINANCE_ADJUSTMENTS_COLLECTION)),
    getDocs(collection(database, FINANCE_COSTS_COLLECTION)),
    getDocs(collection(database, FINANCE_DRAFTS_COLLECTION))
  ]);
  const batch = writeBatch(database);

  batch.delete(doc(database, FINANCE_PROJECTS_COLLECTION, projectId));
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((item) => {
      if (item.data().projectId === projectId) batch.delete(item.ref);
    });
  });

  await batch.commit();
}

export function deleteSingleFinanceDocument(collectionName: string, id: string) {
  return deleteDoc(doc(requireDb(), collectionName, id));
}
