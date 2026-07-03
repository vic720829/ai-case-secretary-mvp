"use client";

import { Save, UsersRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { projectStageOptions, projectStatusOptions } from "@/lib/constants";
import { getReadableError } from "@/lib/errors";
import { listUserProfiles } from "@/lib/firestore";
import type { ProjectInput, UserProfile } from "@/lib/types";
import { Button, ErrorMessage } from "./Ui";

const emptyProject: ProjectInput = {
  name: "",
  clientName: "",
  currentStage: "初談",
  designer: "",
  assistant: "",
  status: "洽談中",
  expectedFinishDate: "",
  memberUserIds: []
};

export function ProjectForm({
  initialValue,
  currentUserId,
  submitLabel,
  onSubmit
}: {
  initialValue?: ProjectInput;
  currentUserId?: string;
  submitLabel: string;
  onSubmit: (value: ProjectInput) => Promise<void>;
}) {
  const [value, setValue] = useState<ProjectInput>(
    initialValue ?? {
      ...emptyProject,
      memberUserIds: currentUserId ? [currentUserId] : []
    }
  );
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userListError, setUserListError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadUsers() {
      try {
        setUsers((await listUserProfiles()).filter((userProfile) => userProfile.active));
      } catch (caught) {
        setUserListError(getReadableError(caught));
      }
    }

    void loadUsers();
  }, []);

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
        assistant: value.assistant.trim(),
        memberUserIds: Array.from(new Set(value.memberUserIds.filter(Boolean)))
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

      <section className="rounded-lg border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-start gap-2">
          <UsersRound className="mt-0.5 h-4 w-4 text-teal-700" aria-hidden />
          <div>
            <div className="text-sm font-semibold text-slate-950">案件可見成員</div>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Owner、管理者、主管可以看到全部案件；員工與檢視者只會看到被勾選加入的案件與文件入口。
            </p>
          </div>
        </div>

        {userListError ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            員工清單讀取失敗：{userListError}
          </div>
        ) : null}

        {users.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {users.map((userProfile) => {
              const checked = value.memberUserIds.includes(userProfile.id);

              return (
                <label
                  key={userProfile.id}
                  className="flex items-start gap-3 rounded-md border border-stone-200 bg-white p-3 text-sm text-slate-700"
                >
                  <input
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      updateField(
                        "memberUserIds",
                        event.target.checked
                          ? [...value.memberUserIds, userProfile.id]
                          : value.memberUserIds.filter((id) => id !== userProfile.id)
                      );
                    }}
                  />
                  <span>
                    <span className="block font-medium text-slate-950">{userProfile.displayName || userProfile.email}</span>
                    <span className="mt-1 block text-xs text-slate-500">{userProfile.email}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">目前沒有可選員工。你可以先到員工管理建立帳號。</p>
        )}
      </section>

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
