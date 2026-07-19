"use client";

import { ArrowLeft, ExternalLink, FileText, FolderOpen, Pencil, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  createProjectDocument,
  deleteProjectDocument,
  getProject,
  listProjectDocumentsByProject,
  updateProjectDocument
} from "@/lib/firestore";
import type { Project, ProjectDocument, ProjectDocumentInput, ProjectDocumentType } from "@/lib/types";

const documentTypeOptions: Array<{ value: ProjectDocumentType; label: string }> = [
  { value: "folder", label: "資料夾" },
  { value: "drawing", label: "圖面" },
  { value: "drawing_review_report", label: "施工圖審查報告" },
  { value: "contract", label: "合約" },
  { value: "quote", label: "報價" },
  { value: "photo", label: "照片" },
  { value: "file", label: "檔案" },
  { value: "other", label: "其他" }
];

const emptyDocument: Omit<ProjectDocumentInput, "projectId"> = {
  title: "",
  url: "",
  documentType: "folder",
  description: ""
};

export function ProjectDocumentsClient({ projectId }: { projectId: string }) {
  const { profile, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [draft, setDraft] = useState(emptyDocument);
  const [editingDocumentId, setEditingDocumentId] = useState("");
  const [editingDraft, setEditingDraft] = useState(emptyDocument);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canEditDocuments = profile?.role !== "viewer";

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextDocuments] = await Promise.all([
        getProject(projectId),
        listProjectDocumentsByProject(projectId)
      ]);
      setProject(nextProject);
      setDocuments(nextDocuments);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      await createProjectDocument({
        projectId,
        ...normalizeDocumentInput(draft),
        updatedBy: profile?.displayName || user?.email || ""
      });
      setDraft(emptyDocument);
      setMessage("文件入口已新增。");
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(documentId: string) {
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      await updateProjectDocument(documentId, {
        projectId,
        ...normalizeDocumentInput(editingDraft),
        updatedBy: profile?.displayName || user?.email || ""
      });
      setEditingDocumentId("");
      setMessage("文件入口已更新。");
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(document: ProjectDocument) {
    const confirmed = window.confirm(`確定刪除文件入口「${document.title}」？`);
    if (!confirmed) return;

    setError("");
    setMessage("");

    try {
      await deleteProjectDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setMessage("文件入口已刪除。");
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取文件入口" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="這個案件可能已被刪除，請回到案件列表確認。"
        action={
          <SecondaryLink href="/projects">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件列表
          </SecondaryLink>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} 文件入口`}
        description="集中放置 OneDrive 資料夾、圖面、合約、報價與照片入口。"
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <ErrorMessage message={error} />
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
        網站會依案件成員控制誰看得到這個入口。若 OneDrive 連結本身被複製外流，仍可能被直接開啟；
        要完全隱藏 OneDrive 位置，需要下一階段串接 Microsoft 權限與代理下載。
      </section>

      {canEditDocuments ? (
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950">
            <FolderOpen className="h-4 w-4 text-teal-700" aria-hidden />
            新增文件入口
          </div>
          <DocumentForm
            value={draft}
            submitLabel={submitting ? "新增中" : "新增入口"}
            disabled={submitting}
            onChange={setDraft}
            onSubmit={handleCreate}
          />
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950">
          <FileText className="h-4 w-4 text-teal-700" aria-hidden />
          文件入口
        </div>

        {documents.length ? (
          <div className="space-y-3">
            {documents.map((document) => {
              const isEditing = editingDocumentId === document.id;

              return (
                <article key={document.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  {isEditing ? (
                    <div className="space-y-3">
                      <DocumentFields value={editingDraft} onChange={setEditingDraft} />
                      <div className="flex justify-end gap-2">
                        <Button type="button" disabled={submitting} onClick={() => void handleUpdate(document.id)}>
                          <Save className="h-4 w-4" aria-hidden />
                          儲存
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setEditingDocumentId("")}>
                          <X className="h-4 w-4" aria-hidden />
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200">
                            {documentTypeLabel(document.documentType)}
                          </span>
                          <a
                            className="font-semibold text-slate-950 hover:text-teal-700"
                            href={document.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {document.title}
                          </a>
                        </div>
                        {document.description ? (
                          <p className="mt-2 text-sm leading-6 text-slate-600">{document.description}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-slate-500">
                          更新：{formatDateTime(document.updatedAt)} {document.updatedBy ? ` / ${document.updatedBy}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <a
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"
                          href={document.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden />
                          開啟
                        </a>
                        {canEditDocuments ? (
                          <>
                            <button
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                              type="button"
                              onClick={() => {
                                setEditingDocumentId(document.id);
                                setEditingDraft({
                                  title: document.title,
                                  url: document.url,
                                  documentType: document.documentType,
                                  description: document.description
                                });
                              }}
                              aria-label="編輯文件入口"
                              title="編輯"
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                            <button
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                              type="button"
                              onClick={() => void handleDelete(document)}
                              aria-label="刪除文件入口"
                              title="刪除"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="尚未建立文件入口" description="可以先放案件 OneDrive 資料夾，之後再補圖面、合約或報價連結。" />
        )}
      </section>
    </div>
  );
}

function DocumentForm({
  value,
  submitLabel,
  disabled,
  onChange,
  onSubmit
}: {
  value: Omit<ProjectDocumentInput, "projectId">;
  submitLabel: string;
  disabled: boolean;
  onChange: (value: Omit<ProjectDocumentInput, "projectId">) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <DocumentFields value={value} onChange={onChange} />
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled}>
          <Save className="h-4 w-4" aria-hidden />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function DocumentFields({
  value,
  onChange
}: {
  value: Omit<ProjectDocumentInput, "projectId">;
  onChange: (value: Omit<ProjectDocumentInput, "projectId">) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="文件名稱">
        <input
          className={inputClassName}
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          required
        />
      </Field>
      <Field label="類型">
        <select
          className={inputClassName}
          value={value.documentType}
          onChange={(event) => onChange({ ...value, documentType: event.target.value as ProjectDocumentType })}
        >
          {documentTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="連結">
        <input
          className={inputClassName}
          type="url"
          value={value.url}
          onChange={(event) => onChange({ ...value, url: event.target.value })}
          placeholder="貼上 OneDrive 資料夾或檔案連結"
          required
        />
      </Field>
      <Field label="備註">
        <input
          className={inputClassName}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="例如：最新版平面圖、客變報價、施工照片"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function normalizeDocumentInput(input: Omit<ProjectDocumentInput, "projectId">) {
  return {
    title: input.title.trim(),
    url: input.url.trim(),
    documentType: input.documentType,
    description: input.description.trim()
  };
}

function documentTypeLabel(type: ProjectDocumentType) {
  return documentTypeOptions.find((option) => option.value === type)?.label ?? "其他";
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
