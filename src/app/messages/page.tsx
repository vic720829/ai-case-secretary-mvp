"use client";

import { Link2, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LineGroupForm } from "@/components/LineGroupForm";
import { MessageTable } from "@/components/MessageTable";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { getReadableError } from "@/lib/errors";
import { createLineGroup, listLineGroups, listMessages, listProjects } from "@/lib/firestore";
import type { LineGroup, LineGroupInput, Message, Project } from "@/lib/types";

type UnboundGroup = {
  groupId: string;
  messageCount: number;
  lastText: string;
};

export default function MessagesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [lineGroups, setLineGroups] = useState<LineGroup[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const filteredMessages = useMemo(
    () =>
      messages.filter((message) => {
        const matchProject = !projectFilter || message.projectId === projectFilter;
        const matchGroup = !groupFilter || message.groupId === groupFilter;
        return matchProject && matchGroup;
      }),
    [groupFilter, messages, projectFilter]
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

    return Array.from(byGroupId.values());
  }, [lineGroups, messages]);

  async function handleCreateLineGroup(value: LineGroupInput) {
    await createLineGroup(value);
    setSelectedGroupId("");
    await loadData();
  }

  if (loading) {
    return <LoadingState label="正在讀取 LINE 訊息" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="LINE 訊息中心"
        description="同步案件群組訊息，並依案件或 LINE 群組查看對話紀錄。"
      />

      <ErrorMessage message={error} />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <LineGroupForm projects={projects} initialGroupId={selectedGroupId} onSubmit={handleCreateLineGroup} />
      </section>

      <UnboundGroupsSection groups={unboundGroups} onUseGroup={setSelectedGroupId} />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <MessageSquare className="h-4 w-4 text-teal-700" aria-hidden />
          訊息篩選
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">案件</span>
            <select
              className={inputClassName}
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="">全部案件</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} / {project.clientName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">LINE 群組</span>
            <select
              className={inputClassName}
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value="">全部群組</option>
              {lineGroups.map((group) => (
                <option key={group.id} value={group.groupId}>
                  {group.groupName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <EmptyState
          title="訊息中心讀取失敗"
          description="請確認 Firestore Rules 已允許登入者讀取 line_groups 與 messages collection。"
        />
      ) : null}

      {!error && filteredMessages.length ? (
        <MessageTable messages={filteredMessages} projects={projects} lineGroups={lineGroups} />
      ) : null}

      {!error && !filteredMessages.length ? (
        <EmptyState
          title="目前沒有訊息"
          description="LINE Webhook 收到訊息後會出現在這裡；也可以先建立 LINE 群組綁定。"
        />
      ) : null}
    </div>
  );
}

function UnboundGroupsSection({
  groups,
  onUseGroup
}: {
  groups: UnboundGroup[];
  onUseGroup: (groupId: string) => void;
}) {
  if (!groups.length) {
    return (
      <section className="rounded-lg border border-dashed border-stone-300 bg-white p-5 text-sm text-slate-600">
        <div className="flex items-center gap-2 font-semibold text-slate-950">
          <Link2 className="h-4 w-4 text-teal-700" aria-hidden />
          未綁定 LINE 群組
        </div>
        <p className="mt-2">
          把 LINE Bot 加入群組後，在群組傳一句「測試」，這裡就會列出可綁定的 groupId。
        </p>
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
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="secondary" onClick={() => onUseGroup(group.groupId)}>
                帶入綁定表單
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const inputClassName =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
