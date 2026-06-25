"use client";

import { Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { riskLevelOptions } from "@/lib/constants";
import { todayInputValue } from "@/lib/date";
import type { MilestoneInput, RiskLevel } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

export function MilestoneForm({
  projectId,
  initialValue,
  submitLabel,
  onSubmit,
  onCancel
}: {
  projectId: string;
  initialValue?: MilestoneInput;
  submitLabel: string;
  onSubmit: (value: MilestoneInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<MilestoneInput>(
    initialValue ?? {
      projectId,
      title: "",
      description: "",
      dueDate: todayInputValue(),
      completed: false,
      riskLevel: "low"
    }
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField<K extends keyof MilestoneInput>(key: K, nextValue: MilestoneInput[K]) {
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
        title: value.title.trim(),
        description: value.description.trim()
      });

      if (!initialValue) {
        setValue({
          projectId,
          title: "",
          description: "",
          dueDate: todayInputValue(),
          completed: false,
          riskLevel: "low"
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "儲存關鍵節點失敗。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
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
        <Field label="到期日">
          <input
            className={inputClassName}
            type="date"
            value={value.dueDate}
            onChange={(event) => updateField("dueDate", event.target.value)}
          />
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
        <label className="flex min-h-[66px] items-end">
          <span className="flex w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              type="checkbox"
              checked={value.completed}
              onChange={(event) => updateField("completed", event.target.checked)}
            />
            已完成
          </span>
        </label>
      </div>
      <Field label="內容">
        <textarea
          className={`${inputClassName} min-h-24 resize-y`}
          value={value.description}
          onChange={(event) => updateField("description", event.target.value)}
        />
      </Field>
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
