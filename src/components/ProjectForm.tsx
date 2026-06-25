"use client";

import { Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { projectStageOptions, projectStatusOptions } from "@/lib/constants";
import type { ProjectInput } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

const emptyProject: ProjectInput = {
  name: "",
  clientName: "",
  currentStage: "初談",
  designer: "",
  assistant: "",
  status: "洽談中",
  expectedFinishDate: ""
};

export function ProjectForm({
  initialValue,
  submitLabel,
  onSubmit
}: {
  initialValue?: ProjectInput;
  submitLabel: string;
  onSubmit: (value: ProjectInput) => Promise<void>;
}) {
  const [value, setValue] = useState<ProjectInput>(initialValue ?? emptyProject);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField<K extends keyof ProjectInput>(key: K, nextValue: ProjectInput[K]) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await onSubmit({
        ...value,
        name: value.name.trim(),
        clientName: value.clientName.trim(),
        designer: value.designer.trim(),
        assistant: value.assistant.trim()
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "儲存案件失敗，請稍後再試。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="案件名稱">
          <input
            className={inputClassName}
            value={value.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
          />
        </Field>
        <Field label="客戶名稱">
          <input
            className={inputClassName}
            value={value.clientName}
            onChange={(event) => updateField("clientName", event.target.value)}
            required
          />
        </Field>
        <Field label="目前階段">
          <select
            className={inputClassName}
            value={value.currentStage}
            onChange={(event) => updateField("currentStage", event.target.value)}
          >
            {projectStageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </Field>
        <Field label="狀態">
          <select
            className={inputClassName}
            value={value.status}
            onChange={(event) => updateField("status", event.target.value)}
          >
            {projectStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="負責設計師">
          <input
            className={inputClassName}
            value={value.designer}
            onChange={(event) => updateField("designer", event.target.value)}
          />
        </Field>
        <Field label="設計助理">
          <input
            className={inputClassName}
            value={value.assistant}
            onChange={(event) => updateField("assistant", event.target.value)}
          />
        </Field>
        <Field label="預計完工日">
          <input
            className={inputClassName}
            type="date"
            value={value.expectedFinishDate}
            onChange={(event) => updateField("expectedFinishDate", event.target.value)}
          />
        </Field>
      </div>

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
