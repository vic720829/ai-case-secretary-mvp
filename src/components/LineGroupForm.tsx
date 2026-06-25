"use client";

import { Link2, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { LineGroupInput, Project } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

export function LineGroupForm({
  projects,
  onSubmit
}: {
  projects: Project[];
  onSubmit: (value: LineGroupInput) => Promise<void>;
}) {
  const [value, setValue] = useState<LineGroupInput>({
    groupId: "",
    projectId: "",
    groupName: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
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
          <select
            className={inputClassName}
            value={value.projectId}
            onChange={(event) => setValue((current) => ({ ...current, projectId: event.target.value }))}
            required
          >
            <option value="">選擇案件</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} / {project.clientName}
              </option>
            ))}
          </select>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
