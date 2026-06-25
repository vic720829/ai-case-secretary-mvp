"use client";

import { Check, Edit3, Save, UserRoundCheck, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { lineMemberRoleOptions } from "@/lib/constants";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  createLineMember,
  deleteLineMember,
  listLineMembers,
  listMessages,
  listProjects,
  updateLineMember
} from "@/lib/firestore";
import type { LineMember, LineMemberInput, LineMemberRole, Message, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

type UnknownSender = {
  senderId: string;
  senderName: string;
  groupId: string;
  projectId: string;
  messageCount: number;
};

const emptyMember: LineMemberInput = {
  lineUserId: "",
  displayName: "",
  role: "client",
  projectId: "",
  note: ""
};

export function LineMembersClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<LineMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState<LineMemberInput>(emptyMember);
  const [editingId, setEditingId] = useState("");
  const [editValue, setEditValue] = useState<LineMemberInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    setError("");

    try {
      const [nextProjects, nextMembers, nextMessages] = await Promise.all([
        listProjects(),
        listLineMembers(),
        listMessages()
      ]);
      setProjects(nextProjects);
      setMembers(nextMembers);
      setMessages(nextMessages);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const registeredIds = useMemo(() => new Set(members.map((member) => member.lineUserId)), [members]);
  const unknownSenders = useMemo(
    () => getUnknownSenders(messages, registeredIds).slice(0, 8),
    [messages, registeredIds]
  );

  async function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const value = normalizeMemberInput(draft);
      assertMemberInput(value);
      await createLineMember(value);
      setDraft(emptyMember);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateMember(member: LineMember) {
    if (!editValue) return;
    setSubmitting(true);
    setError("");

    try {
      const value = normalizeMemberInput(editValue);
      assertMemberInput(value);
      await updateLineMember(member.id, value);
      setEditingId("");
      setEditValue(null);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteMember(member: LineMember) {
    setError("");

    try {
      await deleteLineMember(member.id);
      await loadData();
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  function beginEdit(member: LineMember) {
    setEditingId(member.id);
    setEditValue({
      lineUserId: member.lineUserId,
      displayName: member.displayName,
      role: member.role,
      projectId: member.projectId,
      note: member.note
    });
  }

  function useUnknownSender(sender: UnknownSender) {
    setDraft({
      lineUserId: sender.senderId,
      displayName: sender.senderName,
      role: "client",
      projectId: sender.projectId,
      note: ""
    });
  }

  if (loading) {
    return <LoadingState label="讀取 LINE 成員" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="LINE 成員身份"
        description="標記每個 LINE 發話者是內部人員、客戶或廠商，讓 AI 分辨公司承諾與客戶待回覆。"
      />

      <ErrorMessage message={error} />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="已登記成員" value={members.length} tone="teal" />
        <MetricCard label="內部人員" value={members.filter((member) => member.role === "internal").length} tone="indigo" />
        <MetricCard label="客戶" value={members.filter((member) => member.role === "client").length} tone="amber" />
        <MetricCard label="廠商" value={members.filter((member) => member.role === "vendor").length} tone="slate" />
      </div>

      <UnknownSendersSection senders={unknownSenders} projectById={projectById} onUse={useUnknownSender} />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <LineMemberForm
          title="新增 LINE 成員"
          value={draft}
          projects={projects}
          submitting={submitting}
          submitLabel="新增成員"
          onChange={setDraft}
          onSubmit={handleCreateMember}
        />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <UsersRound className="h-4 w-4 text-teal-700" aria-hidden />
          已登記成員
        </div>

        {members.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">成員</th>
                  <th className="px-4 py-3">身份</th>
                  <th className="px-4 py-3">案件</th>
                  <th className="px-4 py-3">備註</th>
                  <th className="px-4 py-3">更新時間</th>
                  <th className="px-4 py-3 text-right">處理</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {members.map((member) => {
                  const isEditing = editingId === member.id && editValue;
                  const value = isEditing ? editValue : member;

                  return (
                    <tr key={member.id} className="align-top hover:bg-stone-50">
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              className={inputClassName}
                              value={value.displayName}
                              onChange={(event) => setEditValue((current) => current ? { ...current, displayName: event.target.value } : current)}
                            />
                            <input
                              className={inputClassName}
                              value={value.lineUserId}
                              onChange={(event) => setEditValue((current) => current ? { ...current, lineUserId: event.target.value } : current)}
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-semibold text-slate-950">{member.displayName}</div>
                            <div className="mt-1 max-w-64 break-all font-mono text-xs text-slate-500">{member.lineUserId}</div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <RoleSelect
                            value={value.role}
                            onChange={(role) => setEditValue((current) => current ? { ...current, role } : current)}
                          />
                        ) : (
                          <RoleBadge role={member.role} />
                        )}
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {isEditing ? (
                          <ProjectSelect
                            projects={projects}
                            value={value.projectId}
                            onChange={(projectId) => setEditValue((current) => current ? { ...current, projectId } : current)}
                          />
                        ) : (
                          getProjectLabel(member.projectId, projectById)
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <input
                            className={inputClassName}
                            value={value.note}
                            onChange={(event) => setEditValue((current) => current ? { ...current, note: event.target.value } : current)}
                          />
                        ) : (
                          <span className="text-slate-600">{member.note || "-"}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {formatDateTime(member.updatedAt ?? member.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <Button type="button" disabled={submitting} onClick={() => void handleUpdateMember(member)}>
                              <Save className="h-4 w-4" aria-hidden />
                              儲存
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setEditingId("");
                                setEditValue(null);
                              }}
                            >
                              <X className="h-4 w-4" aria-hidden />
                              取消
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => beginEdit(member)}>
                              <Edit3 className="h-4 w-4" aria-hidden />
                              編輯
                            </Button>
                            <ConfirmDeleteButton
                              label="刪除"
                              confirmMessage={`確定刪除 LINE 成員「${member.displayName}」？`}
                              onConfirm={() => handleDeleteMember(member)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="尚未登記 LINE 成員" description="先從未登記發話者帶入，或手動輸入 LINE userId。" />
        )}
      </section>
    </div>
  );
}

function LineMemberForm({
  title,
  value,
  projects,
  submitting,
  submitLabel,
  onChange,
  onSubmit
}: {
  title: string;
  value: LineMemberInput;
  projects: Project[];
  submitting: boolean;
  submitLabel: string;
  onChange: (value: LineMemberInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <UserRoundCheck className="h-4 w-4 text-teal-700" aria-hidden />
        {title}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="LINE userId">
          <input
            className={inputClassName}
            value={value.lineUserId}
            onChange={(event) => onChange({ ...value, lineUserId: event.target.value })}
            required
          />
        </Field>
        <Field label="顯示名稱">
          <input
            className={inputClassName}
            value={value.displayName}
            onChange={(event) => onChange({ ...value, displayName: event.target.value })}
            required
          />
        </Field>
        <Field label="身份">
          <RoleSelect value={value.role} onChange={(role) => onChange({ ...value, role })} />
        </Field>
        <Field label="綁定案件">
          <ProjectSelect projects={projects} value={value.projectId} onChange={(projectId) => onChange({ ...value, projectId })} />
        </Field>
      </div>
      <Field label="備註">
        <input
          className={inputClassName}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
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

function UnknownSendersSection({
  senders,
  projectById,
  onUse
}: {
  senders: UnknownSender[];
  projectById: Map<string, Project>;
  onUse: (sender: UnknownSender) => void;
}) {
  if (!senders.length) {
    return (
      <section className="rounded-lg border border-dashed border-stone-300 bg-white p-5 text-sm text-slate-600">
        <div className="flex items-center gap-2 font-semibold text-slate-950">
          <Check className="h-4 w-4 text-teal-700" aria-hidden />
          目前沒有未登記發話者
        </div>
        <p className="mt-2">新的 LINE 發話者出現後，會在這裡快速帶入建立身份。</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="font-semibold text-amber-950">未登記發話者</div>
      <div className="grid gap-3 md:grid-cols-2">
        {senders.map((sender) => (
          <div key={`${sender.senderId}-${sender.projectId}`} className="rounded-md border border-amber-200 bg-white p-4">
            <div className="font-semibold text-slate-950">{sender.senderName || "未命名 LINE 成員"}</div>
            <div className="mt-1 break-all font-mono text-xs text-slate-500">{sender.senderId}</div>
            <div className="mt-3 text-sm text-slate-600">
              {getProjectLabel(sender.projectId, projectById)} · 出現 {sender.messageCount} 次
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="secondary" onClick={() => onUse(sender)}>
                帶入新增
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "teal" | "indigo" | "amber" | "slate";
}) {
  const toneClassName = {
    teal: "bg-teal-50 text-teal-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-50 text-slate-700"
  }[tone];

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-3xl font-semibold text-slate-950">{value}</div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", toneClassName)}>
          <UsersRound className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function RoleSelect({
  value,
  onChange
}: {
  value: LineMemberRole;
  onChange: (role: LineMemberRole) => void;
}) {
  return (
    <select
      className={inputClassName}
      value={value}
      onChange={(event) => onChange(event.target.value as LineMemberRole)}
    >
      {lineMemberRoleOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ProjectSelect({
  projects,
  value,
  onChange
}: {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
}) {
  return (
    <select className={inputClassName} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">全部案件 / 不限定</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name} / {project.clientName}
        </option>
      ))}
    </select>
  );
}

function RoleBadge({ role }: { role: LineMemberRole }) {
  const option = lineMemberRoleOptions.find((item) => item.value === role);
  const className = {
    internal: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    client: "bg-amber-50 text-amber-700 ring-amber-200",
    vendor: "bg-slate-50 text-slate-700 ring-slate-200"
  }[role];

  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", className)}>
      {option?.label ?? role}
    </span>
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

function getUnknownSenders(messages: Message[], registeredIds: Set<string>) {
  const senders = new Map<string, UnknownSender>();

  messages.forEach((message) => {
    if (!message.senderId || registeredIds.has(message.senderId)) return;

    const key = `${message.senderId}-${message.projectId || "all"}`;
    const current = senders.get(key);
    senders.set(key, {
      senderId: message.senderId,
      senderName: message.senderName,
      groupId: message.groupId,
      projectId: message.projectId,
      messageCount: (current?.messageCount ?? 0) + 1
    });
  });

  return Array.from(senders.values()).sort((a, b) => b.messageCount - a.messageCount);
}

function normalizeMemberInput(input: LineMemberInput): LineMemberInput {
  return {
    lineUserId: input.lineUserId.trim(),
    displayName: input.displayName.trim(),
    role: input.role,
    projectId: input.projectId,
    note: input.note.trim()
  };
}

function assertMemberInput(input: LineMemberInput) {
  if (!input.lineUserId) throw new Error("請填 LINE userId");
  if (!input.displayName) throw new Error("請填顯示名稱");
}

function getProjectLabel(projectId: string, projectById: Map<string, Project>) {
  if (!projectId) return "全部案件 / 不限定";
  const project = projectById.get(projectId);
  return project ? `${project.name} / ${project.clientName}` : "未找到案件";
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
