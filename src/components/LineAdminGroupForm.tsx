"use client";

import { Bot, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { LineGroupInput } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

export function LineAdminGroupForm({
  initialGroupId,
  onSubmit
}: {
  initialGroupId?: string;
  onSubmit: (value: LineGroupInput) => Promise<void>;
}) {
  const [groupId, setGroupId] = useState(initialGroupId ?? "");
  const [groupName, setGroupName] = useState("公司後台群組");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialGroupId) return;
    setGroupId(initialGroupId);
  }, [initialGroupId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await onSubmit({
        groupId: groupId.trim(),
        projectId: "",
        groupName: groupName.trim(),
        groupType: "admin",
        allowAssistantReplies: true
      });
      setGroupId("");
      setGroupName("公司後台群組");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "建立公司後台群組失敗";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <Bot className="h-4 w-4 text-teal-700" aria-hidden />
        公司後台群組
      </div>
      <p className="text-sm leading-6 text-slate-600">
        只有登記在這裡的 LINE 群組，AI 助理才會回答問題。客戶群會保持安靜，只同步訊息。
      </p>
      <ErrorMessage message={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="LINE groupId">
          <input
            className={inputClassName}
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            required
          />
        </Field>
        <Field label="群組名稱">
          <input
            className={inputClassName}
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            required
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          <Save className="h-4 w-4" aria-hidden />
          {submitting ? "建立中" : "設為後台群組"}
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
