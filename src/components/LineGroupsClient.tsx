"use client";

import { Bot, Check, Edit3, Link2, MessageSquareText, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { LineAdminGroupForm } from "@/components/LineAdminGroupForm";
import { LineGroupForm } from "@/components/LineGroupForm";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "@/components/Ui";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import {
  createLineGroup,
  deleteLineGroup,
  listLineGroups,
  listMessages,
  listProjects,
  updateLineGroup
} from "@/lib/firestore";
import type { LineGroup, LineGroupInput, Message, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

type UnboundGroup = {
  groupId: string;
  messageCount: number;
  lastText: string;
};

export function LineGroupsClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [lineGroups, setLineGroups] = useState<LineGroup[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedProjectGroupId, setSelectedProjectGroupId] = useState("");
  const [selectedAdminGroupId, setSelectedAdminGroupId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editValue, setEditValue] = useState<LineGroupInput | null>(null);
  const [savingId, setSavingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  async function loadData() {
    setError("");

    try {
      const [nextProjects, nextLineGroups, nextMessages] = await Promise.all([
        listProjects(),
        listLineGroups(),
        listMessages()
      ]);
      setProjects(nextProjects);
      setLineGroups(nextLineGroups);
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

  const projectGroups = useMemo(
    () => lineGroups.filter((group) => group.groupType !== "admin"),
    [lineGroups]
  );

  const adminGroups = useMemo(
    () => lineGroups.filter((group) => group.groupType === "admin"),
    [lineGroups]
  );

  const unboundGroups = useMemo<UnboundGroup[]>(() => {
    const boundGroupIds = new Set(lineGroups.map((group) => group.groupId));
    const byGroupId = new Map<string, UnboundGroup>();

    messages.forEach((message) => {
      if (!message.groupId || boundGroupIds.has(message.groupId)) return;

      const current = byGroupId.get(message.groupId);
      byGroupId.set(message.groupId, {
        groupId: message.groupId,
        messageCount: (current?.messageCount ?? 0) + 1,
        lastText: current?.lastText || message.text || `[${message.messageType}]`
      });
    });

    return Array.from(byGroupId.values()).sort((a, b) => b.messageCount - a.messageCount);
  }, [lineGroups, messages]);

  async function handleCreateProjectGroup(value: LineGroupInput) {
    assertGroupIdIsNew(value.groupId);
    await createLineGroup({
      ...value,
      groupType: "project",
      allowAssistantReplies: false
    });
    setSelectedProjectGroupId("");
    await loadData();
  }

  async function handleCreateAdminGroup(value: LineGroupInput) {
    assertGroupIdIsNew(value.groupId);
    await createLineGroup({
      ...value,
      projectId: "",
      groupType: "admin",
      allowAssistantReplies: true
    });
    setSelectedAdminGroupId("");
    await loadData();
  }

  async function handleDeleteLineGroup(id: string) {
    setActionError("");
    await deleteLineGroup(id);
    await loadData();
  }

  function beginEdit(group: LineGroup) {
    setActionError("");
    setEditingId(group.id);
    setEditValue({
      groupId: group.groupId,
      projectId: group.groupType === "admin" ? "" : group.projectId,
      groupName: group.groupName,
      groupType: group.groupType ?? "project",
      allowAssistantReplies: group.groupType === "admin" ? group.allowAssistantReplies !== false : false
    });
  }

  function cancelEdit() {
    setEditingId("");
    setEditValue(null);
    setSavingId("");
  }

  async function handleSaveLineGroup(group: LineGroup) {
    if (!editValue) return;

    setActionError("");
    setSavingId(group.id);

    try {
      const groupType = group.groupType ?? "project";
      const nextValue: LineGroupInput = {
        groupId: group.groupId,
        groupName: editValue.groupName.trim(),
        projectId: groupType === "admin" ? "" : editValue.projectId,
        groupType,
        allowAssistantReplies: groupType === "admin" ? Boolean(editValue.allowAssistantReplies) : false
      };

      if (!nextValue.groupName) {
        throw new Error("請輸入群組名稱。");
      }
      if (groupType !== "admin" && !nextValue.projectId) {
        throw new Error("案件群組需要綁定案件。");
      }

      await updateLineGroup(group.id, nextValue);
      cancelEdit();
      await loadData();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "更新 LINE 群組失敗。");
    } finally {
      setSavingId("");
    }
  }

  function assertGroupIdIsNew(groupId: string) {
    const normalized = groupId.trim();
    if (lineGroups.some((group) => group.groupId === normalized)) {
      throw new Error("這個 LINE groupId 已經建立過，請直接在下方列表編輯。");
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取 LINE 群組" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="LINE 群組管理"
        description="建立案件群組綁定與公司後台群組。案件群只同步訊息；後台群才會回答問題與接收提醒。"
      />

      <ErrorMessage message={error} />
      <ErrorMessage message={actionError} />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="案件群組" value={projectGroups.length} tone="teal" />
        <SummaryCard label="後台群組" value={adminGroups.length} tone="indigo" />
        <SummaryCard label="待綁定 groupId" value={unboundGroups.length} tone="amber" />
      </div>

      <UnboundGroupsSection
        groups={unboundGroups}
        onUseProjectGroup={setSelectedProjectGroupId}
        onUseAdminGroup={setSelectedAdminGroupId}
      />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <LineGroupForm projects={projects} initialGroupId={selectedProjectGroupId} onSubmit={handleCreateProjectGroup} />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <LineAdminGroupForm initialGroupId={selectedAdminGroupId} onSubmit={handleCreateAdminGroup} />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Link2 className="h-4 w-4 text-teal-700" aria-hidden />
              已建立群組
            </div>
            <p className="mt-1 text-sm text-slate-600">可修改群組名稱、案件綁定，或移除不再使用的 LINE 綁定。</p>
          </div>
          <SecondaryLink href="/messages">
            <MessageSquareText className="h-4 w-4" aria-hidden />
            查看訊息中心
          </SecondaryLink>
        </div>

        {lineGroups.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">類型</th>
                  <th className="px-4 py-3">群組</th>
                  <th className="px-4 py-3">綁定案件</th>
                  <th className="px-4 py-3">助理回覆</th>
                  <th className="px-4 py-3">更新時間</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {lineGroups.map((group) => {
                  const isEditing = editingId === group.id && editValue;
                  const project = projectById.get(group.projectId);
                  const isAdminGroup = group.groupType === "admin";

                  return (
                    <tr key={group.id} className="align-top hover:bg-stone-50">
                      <td className="whitespace-nowrap px-4 py-4">
                        <span
                          className={cn(
                            "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
                            isAdminGroup
                              ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                              : "bg-teal-50 text-teal-700 ring-teal-200"
                          )}
                        >
                          {isAdminGroup ? "後台群" : "案件群"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <input
                            className={inputClassName}
                            value={editValue.groupName}
                            onChange={(event) =>
                              setEditValue((current) =>
                                current ? { ...current, groupName: event.target.value } : current
                              )
                            }
                          />
                        ) : (
                          <div className="font-medium text-slate-900">{group.groupName}</div>
                        )}
                        <div className="mt-1 max-w-64 break-all font-mono text-xs text-slate-500">{group.groupId}</div>
                      </td>
                      <td className="px-4 py-4">
                        {isAdminGroup ? (
                          <span className="text-slate-500">公司後台</span>
                        ) : isEditing ? (
                          <select
                            className={inputClassName}
                            value={editValue.projectId}
                            onChange={(event) =>
                              setEditValue((current) =>
                                current ? { ...current, projectId: event.target.value } : current
                              )
                            }
                          >
                            <option value="">選擇案件</option>
                            {projects.map((projectOption) => (
                              <option key={projectOption.id} value={projectOption.id}>
                                {projectOption.name} / {projectOption.clientName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-700">
                            {project ? `${project.name} / ${project.clientName}` : "未綁定"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isAdminGroup && isEditing ? (
                          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input
                              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                              type="checkbox"
                              checked={Boolean(editValue.allowAssistantReplies)}
                              onChange={(event) =>
                                setEditValue((current) =>
                                  current ? { ...current, allowAssistantReplies: event.target.checked } : current
                                )
                              }
                            />
                            允許
                          </label>
                        ) : (
                          <span className="text-slate-600">
                            {isAdminGroup && group.allowAssistantReplies !== false ? "允許" : "不允許"}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {formatDateTime(group.updatedAt ?? group.createdAt)}
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => void handleSaveLineGroup(group)}
                              disabled={savingId === group.id}
                            >
                              <Save className="h-4 w-4" aria-hidden />
                              {savingId === group.id ? "儲存中" : "儲存"}
                            </Button>
                            <Button type="button" variant="secondary" onClick={cancelEdit}>
                              <X className="h-4 w-4" aria-hidden />
                              取消
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => beginEdit(group)}>
                              <Edit3 className="h-4 w-4" aria-hidden />
                              編輯
                            </Button>
                            <ConfirmDeleteButton
                              label="移除"
                              confirmMessage={`確定移除「${group.groupName}」的 LINE 綁定？訊息紀錄會保留。`}
                              onConfirm={() => handleDeleteLineGroup(group.id)}
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
          <EmptyState
            title="尚未建立 LINE 群組"
            description="先把 LINE Bot 加入群組並傳一則測試訊息，再用上方表單建立案件群或後台群。"
          />
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "teal" | "indigo" | "amber" }) {
  const toneClassName = {
    teal: "bg-teal-50 text-teal-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700"
  }[tone];

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-3xl font-semibold text-slate-950">{value}</div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", toneClassName)}>
          {tone === "indigo" ? <Bot className="h-5 w-5" aria-hidden /> : <Link2 className="h-5 w-5" aria-hidden />}
        </div>
      </div>
    </div>
  );
}

function UnboundGroupsSection({
  groups,
  onUseProjectGroup,
  onUseAdminGroup
}: {
  groups: UnboundGroup[];
  onUseProjectGroup: (groupId: string) => void;
  onUseAdminGroup: (groupId: string) => void;
}) {
  if (!groups.length) {
    return (
      <section className="rounded-lg border border-dashed border-stone-300 bg-white p-5 text-sm text-slate-600">
        <div className="flex items-center gap-2 font-semibold text-slate-950">
          <Check className="h-4 w-4 text-teal-700" aria-hidden />
          目前沒有待綁定群組
        </div>
        <p className="mt-2">新的 LINE 群組傳訊息後，如果還沒綁案件或後台，會出現在這裡。</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-center gap-2 font-semibold text-amber-900">
        <Link2 className="h-4 w-4" aria-hidden />
        未綁定 LINE 群組
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.groupId} className="rounded-md border border-amber-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">groupId</div>
            <div className="mt-1 break-all font-mono text-sm text-slate-950">{group.groupId}</div>
            <div className="mt-3 text-xs text-slate-500">收到 {group.messageCount} 則訊息</div>
            <div className="mt-1 line-clamp-2 text-sm text-slate-700">{group.lastText}</div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => onUseAdminGroup(group.groupId)}>
                設為後台群組
              </Button>
              <Button type="button" variant="secondary" onClick={() => onUseProjectGroup(group.groupId)}>
                帶入案件綁定
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
