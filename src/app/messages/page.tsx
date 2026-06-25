"use client";

import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LineGroupForm } from "@/components/LineGroupForm";
import { MessageTable } from "@/components/MessageTable";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { getReadableError } from "@/lib/errors";
import { createLineGroup, listLineGroups, listMessages, listProjects } from "@/lib/firestore";
import type { LineGroup, LineGroupInput, Message, Project } from "@/lib/types";

export default function MessagesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [lineGroups, setLineGroups] = useState<LineGroup[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
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

  async function handleCreateLineGroup(value: LineGroupInput) {
    await createLineGroup(value);
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
        <LineGroupForm projects={projects} onSubmit={handleCreateLineGroup} />
      </section>

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

const inputClassName =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
