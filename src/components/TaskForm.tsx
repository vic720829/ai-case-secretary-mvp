"use client";

import { Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { riskLevelOptions, taskSourceOptions, taskStatusOptions } from "@/lib/constants";
import { todayInputValue } from "@/lib/date";
import type { Project, RiskLevel, TaskInput, TaskSource, TaskStatus } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

const emptyTask: TaskInput = {
  title: "",
  description: "",
  projectId: "",
  assignee: "",
  dueDate: todayInputValue(),
  status: "todo",
  source: "manual",
  riskLevel: "low"
};

export function TaskForm({
  projects,
  initialValue,
  initialProjectId,
  submitLabel,
  onSubmit
}: {
  projects: Project[];
  initialValue?: TaskInput;
  initialProjectId?: string;
  submitLabel: string;
  onSubmit: (value: TaskInput) => Promise<void>;
}) {
  const [value, setValue] = useState<TaskInput>({
    ...(initialValue ?? emptyTask),
    projectId: initialValue?.projectId ?? initialProjectId ?? ""
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialValue && initialProjectId) {
      setValue((current) => ({ ...current, projectId: initialProjectId }));
    }
  }, [initialProjectId, initialValue]);

  function updateField<K extends keyof TaskInput>(key: K, nextValue: TaskInput[K]) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await onSubmit({
        ...value,
        title: value.title.trim(),
        description: value.description.trim(),
        assignee: value.assignee.trim()
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "儲存任務失敗，請稍後再試。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="標題">
          <input
            className={inputClassName}
            value={value.title}
            onChange={(event) => updateField("title", event.target.value)}
            required
          />
        </Field>
        <Field label="綁定案件">
          <select
            className={inputClassName}
            value={value.projectId}
            onChange={(event) => updateField("projectId", event.target.value)}
          >
            <option value="">未綁定案件</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} / {project.clientName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="負責人">
          <input
            className={inputClassName}
            value={value.assignee}
            onChange={(event) => updateField("assignee", event.target.value)}
          />
        </Field>
        <Field label="截止日">
          <input
            className={inputClassName}
            type="date"
            value={value.dueDate}
            onChange={(event) => updateField("dueDate", event.target.value)}
          />
        </Field>
        <Field label="狀態">
          <select
            className={inputClassName}
            value={value.status}
            onChange={(event) => updateField("status", event.target.value as TaskStatus)}
          >
            {taskStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="來源">
          <select
            className={inputClassName}
            value={value.source}
            onChange={(event) => updateField("source", event.target.value as TaskSource)}
          >
            {taskSourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="風險等級">
          <select
            className={inputClassName}
            value={value.riskLevel}
            onChange={(event) => updateField("riskLevel", event.target.value as RiskLevel)}
          >
            {riskLevelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="內容">
        <textarea
          className={`${inputClassName} min-h-32 resize-y`}
          value={value.description}
          onChange={(event) => updateField("description", event.target.value)}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          <Save className="h-4 w-4" aria-hidden />
          {submitting ? "儲存中" : submitLabel}
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
