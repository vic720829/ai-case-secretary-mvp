import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot
} from "firebase/firestore";
import { deleteObject, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { DRAWING_REVIEW_RULE_SET_VERSION } from "@/lib/drawingReviewRules";
import type {
  DrawingFindingReviewStatus,
  DrawingReview,
  DrawingReviewFinding,
  DrawingReviewInput,
  Project,
  UserProfile
} from "@/lib/types";

const DRAWING_REVIEWS_COLLECTION = "drawing_reviews";
const DRAWING_FINDINGS_COLLECTION = "drawing_review_findings";
export const MAX_DRAWING_PDF_BYTES = 50 * 1024 * 1024;

type CreateDrawingReviewOptions = {
  project: Project;
  file: File;
  note: string;
  userId: string;
  userName: string;
  onUploadProgress?: (progress: number) => void;
};

export async function createDrawingReview(options: CreateDrawingReviewOptions) {
  const database = requireDb();
  const fileStorage = requireStorage();

  await validatePdfFile(options.file);

  const reviewRef = doc(collection(database, DRAWING_REVIEWS_COLLECTION));
  const safeFileName = sanitizeFileName(options.file.name);
  const sourceStoragePath = `drawing-reviews/${options.project.id}/${reviewRef.id}/source/${safeFileName}`;
  const sourceRef = ref(fileStorage, sourceStoragePath);
  const sourceSha256 = await sha256(options.file);

  await uploadPdf(sourceRef, options.file, {
    projectId: options.project.id,
    reviewId: reviewRef.id,
    originalFileName: options.file.name,
    uploadedBy: options.userId
  }, options.onUploadProgress);

  const input: DrawingReviewInput = {
    projectId: options.project.id,
    projectNameSnapshot: options.project.name,
    sourceFileName: options.file.name,
    sourceStoragePath,
    sourceContentType: "application/pdf",
    sourceSizeBytes: options.file.size,
    sourceSha256,
    status: "queued",
    progress: 0,
    statusMessage: "已上傳，等待背景審圖服務處理。",
    resultStatus: "pending",
    fatalCount: 0,
    warningCount: 0,
    insufficientCount: 0,
    passedCount: 0,
    summaryText: "",
    ruleSetVersion: DRAWING_REVIEW_RULE_SET_VERSION,
    projectSummaryStatus: "pending",
    projectSummarySourceUpdatedAt: "",
    projectRequirementChecks: [],
    modelVersion: "",
    uploadedBy: options.userId,
    uploadedByName: options.userName,
    note: options.note.trim(),
    reportFileName: "",
    reportStoragePath: "",
    errorMessage: ""
  };

  try {
    await setDoc(reviewRef, {
      ...input,
      createdAt: serverTimestamp(),
      startedAt: null,
      completedAt: null,
      updatedAt: serverTimestamp()
    });
  } catch (caught) {
    await deleteObject(sourceRef).catch(() => undefined);
    throw caught;
  }

  return reviewRef.id;
}

export async function listDrawingReviewsForProfile(
  profile: Pick<UserProfile, "id" | "role">,
  projects: Project[]
) {
  if (["owner", "admin", "manager"].includes(profile.role)) {
    const snapshot = await getDocs(
      query(collection(requireDb(), DRAWING_REVIEWS_COLLECTION), orderBy("createdAt", "desc"))
    );
    return snapshot.docs.map(drawingReviewFromDoc);
  }

  const reviews = await Promise.all(projects.map((project) => listDrawingReviewsByProject(project.id)));
  return reviews
    .flat()
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function listDrawingReviewsByProject(projectId: string) {
  const snapshot = await getDocs(
    query(collection(requireDb(), DRAWING_REVIEWS_COLLECTION), where("projectId", "==", projectId))
  );

  return snapshot.docs
    .map(drawingReviewFromDoc)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export async function getDrawingReview(reviewId: string) {
  const snapshot = await getDoc(doc(requireDb(), DRAWING_REVIEWS_COLLECTION, reviewId));
  return snapshot.exists() ? drawingReviewFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>) : null;
}

export async function listDrawingReviewFindings(reviewId: string, projectId: string) {
  const snapshot = await getDocs(
    query(
      collection(requireDb(), DRAWING_FINDINGS_COLLECTION),
      where("reviewId", "==", reviewId),
      where("projectId", "==", projectId)
    )
  );

  return snapshot.docs
    .map(drawingFindingFromDoc)
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity) || a.pageNumber - b.pageNumber);
}

export async function updateDrawingFindingReview(
  findingId: string,
  input: {
    reviewStatus: DrawingFindingReviewStatus;
    reviewedBy: string;
    reviewNote: string;
  }
) {
  await updateDoc(doc(requireDb(), DRAWING_FINDINGS_COLLECTION, findingId), {
    ...input,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function requireDb() {
  if (!db) throw new Error("Firebase 尚未設定，無法使用審圖中心。");
  return db;
}

function requireStorage() {
  if (!storage) throw new Error("Firebase Storage 尚未設定，無法上傳施工圖。");
  return storage;
}

async function validatePdfFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("只能上傳 PDF 施工圖。");
  }
  if (!file.size) throw new Error("PDF 是空檔案，請重新選擇。");
  if (file.size > MAX_DRAWING_PDF_BYTES) throw new Error("PDF 不得超過 50 MB。");

  const header = await file.slice(0, 5).text();
  if (header !== "%PDF-") throw new Error("檔案內容不是有效的 PDF。");
}

function uploadPdf(
  sourceRef: ReturnType<typeof ref>,
  file: File,
  customMetadata: Record<string, string>,
  onProgress?: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(sourceRef, file, {
      contentType: "application/pdf",
      customMetadata
    });

    task.on(
      "state_changed",
      (snapshot) => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      reject,
      () => resolve()
    );
  });
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeFileName(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  const limited = normalized.slice(0, 120);
  return limited.toLowerCase().endsWith(".pdf") ? limited : `${limited || "drawing"}.pdf`;
}

function drawingReviewFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): DrawingReview {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ""),
    projectNameSnapshot: String(data.projectNameSnapshot ?? ""),
    sourceFileName: String(data.sourceFileName ?? ""),
    sourceStoragePath: String(data.sourceStoragePath ?? ""),
    sourceContentType: "application/pdf",
    sourceSizeBytes: Number(data.sourceSizeBytes ?? 0),
    sourceSha256: String(data.sourceSha256 ?? ""),
    status: normalizeStatus(data.status),
    progress: Number(data.progress ?? 0),
    statusMessage: String(data.statusMessage ?? ""),
    resultStatus: normalizeResultStatus(data.resultStatus),
    fatalCount: Number(data.fatalCount ?? 0),
    warningCount: Number(data.warningCount ?? 0),
    insufficientCount: Number(data.insufficientCount ?? 0),
    passedCount: Number(data.passedCount ?? 0),
    summaryText: String(data.summaryText ?? ""),
    ruleSetVersion: String(data.ruleSetVersion ?? ""),
    projectSummaryStatus: normalizeProjectSummaryStatus(data.projectSummaryStatus),
    projectSummarySourceUpdatedAt: String(data.projectSummarySourceUpdatedAt ?? ""),
    projectRequirementChecks: normalizeProjectRequirementChecks(data.projectRequirementChecks),
    modelVersion: String(data.modelVersion ?? ""),
    uploadedBy: String(data.uploadedBy ?? ""),
    uploadedByName: String(data.uploadedByName ?? ""),
    note: String(data.note ?? ""),
    reportFileName: String(data.reportFileName ?? ""),
    reportStoragePath: String(data.reportStoragePath ?? ""),
    errorMessage: String(data.errorMessage ?? ""),
    createdAt: readTimestamp(data.createdAt),
    startedAt: readTimestamp(data.startedAt),
    completedAt: readTimestamp(data.completedAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function normalizeProjectSummaryStatus(value: unknown): DrawingReview["projectSummaryStatus"] {
  if (value === "pending" || value === "included" || value === "missing") return value;
  return "not_included";
}

function normalizeProjectRequirementChecks(value: unknown): DrawingReview["projectRequirementChecks"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const data = item as Record<string, unknown>;
    const requirement = String(data.requirement ?? "").trim();
    if (!requirement) return [];
    const status = data.status === "matched" || data.status === "conflict" || data.status === "suspected_missing" ||
      data.status === "out_of_scope" ? data.status : "unable_to_confirm";
    return [{
      requirement,
      sourceSection: String(data.sourceSection ?? ""),
      status,
      pageNumber: Math.max(0, Number(data.pageNumber ?? 0)),
      location: String(data.location ?? ""),
      evidence: String(data.evidence ?? ""),
      recommendation: String(data.recommendation ?? "")
    }];
  });
}

function drawingFindingFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): DrawingReviewFinding {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    reviewId: String(data.reviewId ?? ""),
    projectId: String(data.projectId ?? ""),
    ruleCode: String(data.ruleCode ?? ""),
    severity: data.severity === "fatal" || data.severity === "warning" || data.severity === "passed" ? data.severity : "insufficient",
    pageNumber: Number(data.pageNumber ?? 0),
    location: String(data.location ?? ""),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    observedValue: String(data.observedValue ?? ""),
    expectedValue: String(data.expectedValue ?? ""),
    difference: String(data.difference ?? ""),
    evidence: String(data.evidence ?? ""),
    confidence: Number(data.confidence ?? 0),
    recommendation: String(data.recommendation ?? ""),
    reviewStatus: data.reviewStatus === "confirmed" || data.reviewStatus === "false_positive" ? data.reviewStatus : "pending",
    reviewedBy: String(data.reviewedBy ?? ""),
    reviewNote: String(data.reviewNote ?? ""),
    createdAt: readTimestamp(data.createdAt),
    reviewedAt: readTimestamp(data.reviewedAt),
    updatedAt: readTimestamp(data.updatedAt)
  };
}

function readTimestamp(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "toDate" in value) return (value as { toDate: () => Date }).toDate();
  return null;
}

function normalizeStatus(value: unknown): DrawingReview["status"] {
  return value === "extracting" || value === "analyzing" || value === "validating" || value === "cross_checking" || value === "generating_report" || value === "completed" || value === "failed"
    ? value
    : "queued";
}

function normalizeResultStatus(value: unknown): DrawingReview["resultStatus"] {
  return value === "needs_revision" || value === "needs_confirmation" || value === "passed" || value === "unable_to_review"
    ? value
    : "pending";
}

function severityOrder(value: DrawingReviewFinding["severity"]) {
  if (value === "fatal") return 0;
  if (value === "warning") return 1;
  if (value === "insufficient") return 2;
  return 3;
}
