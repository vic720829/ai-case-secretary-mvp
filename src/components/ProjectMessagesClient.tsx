"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MessageTable } from "./MessageTable";
import { PageHeader } from "./PageHeader";
import { EmptyState, ErrorMessage, LoadingState, SecondaryLink } from "./Ui";
import { getReadableError } from "@/lib/errors";
import { getProject, listLineGroupsByProject, listMessagesByProject } from "@/lib/firestore";
import type { LineGroup, Message, Project } from "@/lib/types";

export function ProjectMessagesClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [lineGroups, setLineGroups] = useState<LineGroup[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");

    try {
      const [nextProject, nextLineGroups, nextMessages] = await Promise.all([
        getProject(projectId),
        listLineGroupsByProject(projectId),
        listMessagesByProject(projectId)
      ]);
      setProject(nextProject);
      setLineGroups(nextLineGroups);
      setMessages(nextMessages);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return <LoadingState label="正在讀取案件訊息" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="找不到案件"
        description="這個案件可能已被刪除，請回到案件列表確認。"
        action={
          <SecondaryLink href="/projects">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件列表
          </SecondaryLink>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} 訊息`}
        description={`${project.clientName} / LINE 群組訊息紀錄`}
        action={
          <SecondaryLink href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件詳情
          </SecondaryLink>
        }
      />

      <ErrorMessage message={error} />

      {messages.length ? (
        <MessageTable messages={messages} projects={[project]} lineGroups={lineGroups} />
      ) : (
        <EmptyState title="此案件尚無訊息" description="建立 LINE 群組綁定並接上 webhook 後，訊息會出現在這裡。" />
      )}
    </div>
  );
}
