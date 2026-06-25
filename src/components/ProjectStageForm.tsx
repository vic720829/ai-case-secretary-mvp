"use client";

import { Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { projectStageStatusOptions } from "@/lib/constants";
import type { ProjectStageInput, ProjectStageStatus } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

export function ProjectStageForm({
  projectId,
  initialValue,
  submitLabel,
  onSubmit,
  onCancel
}: {
  projectId: string;
  initialValue?: ProjectStageInput;
  submitLabel: string;
  onSubmit: (value: ProjectStageInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<ProjectStageInput>(
    initialValue ?? {
      projectId,
      stageName: "",
      startDate: "",
      endDate: "",
      status: "todo",
      sortOrder: 1,
      reminderDaysBefore: 3
    }
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField<K extends keyof ProjectStageInput>(key: K, nextValue: ProjectStageInput[K]) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await onSubmit({
        ...value,
        projectId,
        stageName: value.stageName.trim(),
        sortOrder: Number(value.sortOrder || 0),
        reminderDaysBefore: Number(value.reminderDaysBefore || 0)
      });

      if (!initialValue) {
        setValue({
          projectId,
          stageName: "",
          startDate: "",
          endDate: "",
          status: "todo",
          sortOrder: value.sortOrder + 1,
          reminderDaysBefore: value.reminderDaysBefore
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "儲存工期節點失敗。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <ErrorMessage message={error} />
      <div className="grid gap-4 md:grid-cols-6">
        <Field label="節點名稱">
          <input
            className={inputClassName}
            value={value.stageName}
            onChange={(event) => updateField("stageName", event.target.value)}
            required
          />
        </Field>
        <Field label="開始日">
          <input
            className={inputClassName}
            type="date"
            value={value.startDate}
            onChange={(event) => updateField("startDate", event.target.value)}
          />
        </Field>
        <Field label="結束日">
          <input
            className={inputClassName}
            type="date"
            value={value.endDate}
            onChange={(event) => updateField("endDate", event.target.value)}
          />
        </Field>
        <Field label="狀態">
          <select
            className={inputClassName}
            value={value.status}
            onChange={(event) => updateField("status", event.target.value as ProjectStageStatus)}
          >
            {projectStageStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="排序">
          <input
            className={inputClassName}
            min={0}
            type="number"
            value={value.sortOrder}
            onChange={(event) => updateField("sortOrder", Number(event.target.value))}
          />
        </Field>
        <Field label="進場前提醒">
          <div className="flex items-center gap-2">
            <input
              className={inputClassName}
              min={0}
              type="number"
              value={value.reminderDaysBefore}
              onChange={(event) => updateField("reminderDaysBefore", Number(event.target.value))}
            />
            <span className="shrink-0 text-sm text-slate-600">天</span>
          </div>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        ) : null}
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
