import type { DrawingProjectSummarySnapshot, ProjectSummarySection } from "@/lib/types";

const MAX_SUMMARY_TEXT_LENGTH = 6000;
const MAX_SECTIONS = 12;
const MAX_ITEMS_PER_SECTION = 30;
const MAX_SECTION_TITLE_LENGTH = 120;
const MAX_ITEM_LENGTH = 600;

export function buildDrawingProjectSummarySnapshot(value: unknown): DrawingProjectSummarySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const summaryText = cleanText(data.summaryText, MAX_SUMMARY_TEXT_LENGTH);
  const sections = normalizeSections(data.sections);
  if (!summaryText && !sections.some((section) => section.items.length)) return null;

  return {
    summaryText,
    sections,
    source: data.source === "ai" ? "ai" : "system",
    model: cleanText(data.model, 120),
    refreshedBy: cleanText(data.refreshedBy, 160),
    sourceUpdatedAt: timestampToIso(data.updatedAt)
  };
}

function normalizeSections(value: unknown): ProjectSummarySection[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_SECTIONS).flatMap((section) => {
    if (!section || typeof section !== "object") return [];
    const record = section as Record<string, unknown>;
    const title = cleanText(record.title, MAX_SECTION_TITLE_LENGTH);
    if (!title) return [];
    const items = Array.isArray(record.items)
      ? record.items
          .slice(0, MAX_ITEMS_PER_SECTION)
          .map((item) => cleanText(item, MAX_ITEM_LENGTH))
          .filter(Boolean)
      : [];
    return [{ title, items }];
  });
}

function timestampToIso(value: unknown) {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return "";
}

function cleanText(value: unknown, limit: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
