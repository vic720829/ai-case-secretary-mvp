"use client";

import { Link2, Save } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LineGroupInput, Project } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

export function LineGroupForm({
  projects,
  initialGroupId,
  initialGroupName,
  onSubmit
}: {
  projects: Project[];
  initialGroupId?: string;
  initialGroupName?: string;
  onSubmit: (value: LineGroupInput) => Promise<void>;
}) {
  const [value, setValue] = useState<LineGroupInput>({
    groupId: initialGroupId ?? "",
    projectId: "",
    groupName: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialGroupId) return;
    setValue((current) => ({ ...current, groupId: initialGroupId, groupName: initialGroupName || current.groupName }));
  }, [initialGroupId, initialGroupName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (!value.projectId) {
        throw new Error("請先選擇要綁定的案件。");
      }

      await onSubmit({
        groupId: value.groupId.trim(),
        projectId: value.projectId,
        groupName: value.groupName.trim()
      });
      setValue({ groupId: "", projectId: "", groupName: "" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "儲存 LINE 群組綁定失敗。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <Link2 className="h-4 w-4 text-teal-700" aria-hidden />
        新增 LINE 群組綁定
      </div>
      <ErrorMessage message={error} />
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="LINE groupId">
          <input
            className={inputClassName}
            value={value.groupId}
            onChange={(event) => setValue((current) => ({ ...current, groupId: event.target.value }))}
            required
          />
        </Field>
        <Field label="群組名稱">
          <input
            className={inputClassName}
            value={value.groupName}
            onChange={(event) => setValue((current) => ({ ...current, groupName: event.target.value }))}
            required
          />
        </Field>
        <Field label="綁定案件">
          <ProjectPicker
            projects={projects}
            selectedProjectId={value.projectId}
            onChange={(projectId) => setValue((current) => ({ ...current, projectId }))}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          <Save className="h-4 w-4" aria-hidden />
          {submitting ? "儲存中" : "建立綁定"}
        </Button>
      </div>
    </form>
  );
}

function ProjectPicker({
  projects,
  selectedProjectId,
  onChange
}: {
  projects: Project[];
  selectedProjectId: string;
  onChange: (projectId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-TW");
    const candidates = keyword
      ? projects.filter((project) =>
          [project.name, project.clientName, project.designer, project.assistant, project.status]
            .join(" ")
            .toLocaleLowerCase("zh-TW")
            .includes(keyword)
        )
      : projects;

    return candidates.slice(0, 8);
  }, [projects, query]);

  return (
    <div className="relative">
      <input
        className={inputClassName}
        value={query}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={selectedProject ? `${selectedProject.name} / ${selectedProject.clientName}` : "搜尋案件、客戶、設計師"}
      />

      {selectedProject ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-teal-50 px-3 py-2 text-xs text-teal-800">
          <span className="truncate">
            已選：{selectedProject.name} / {selectedProject.clientName}
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-teal-700 hover:text-teal-900"
            onClick={() => onChange("")}
          >
            清除
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-stone-200 bg-white shadow-lg">
          {filteredProjects.length ? (
            filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="block w-full border-b border-stone-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-teal-50"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(project.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="block font-medium text-slate-950">{project.name}</span>
                <span className="block text-xs text-slate-500">
                  {project.clientName || "未填客戶"} / {project.designer || "未填設計師"} / {project.status || "未填狀態"}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-slate-500">找不到符合的案件</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
