"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ProjectTable } from "@/components/ProjectTable";
import { EmptyState, ErrorMessage, LoadingState, PrimaryLink } from "@/components/Ui";
import { useAuth } from "@/components/AuthProvider";
import { toAuditActor } from "@/lib/audit";
import { getReadableError } from "@/lib/errors";
import { deleteProject, listProjects } from "@/lib/firestore";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadProjects() {
    setError("");

    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function handleDelete(project: Project) {
    const confirmed = window.confirm(`確定刪除「${project.name}」？相關待辦也會一起刪除。`);
    if (!confirmed) return;

    try {
      await deleteProject(project.id, toAuditActor(user));
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (caught) {
      setError(getReadableError(caught));
    }
  }

  if (loading) {
    return <LoadingState label="正在讀取案件" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="案件列表"
        description="管理室內設計案件、客戶、目前階段與負責成員。"
        action={
          <PrimaryLink href="/projects/new">
            <Plus className="h-4 w-4" aria-hidden />
            新增案件
          </PrimaryLink>
        }
      />
      <ErrorMessage message={error} />
      {error ? (
        <EmptyState
          title="案件讀取失敗"
          description="請先確認 Firebase Authentication 已登入，並在 Firestore Rules 發布登入後可讀寫的規則。"
        />
      ) : null}
      {!error && projects.length ? (
        <ProjectTable projects={projects} onDelete={handleDelete} />
      ) : null}
      {!error && !projects.length ? (
        <EmptyState
          title="尚未建立案件"
          description="先建立第一個案件，後續新增待辦時就能綁定到案件。"
          action={
            <PrimaryLink href="/projects/new">
              <Plus className="h-4 w-4" aria-hidden />
              新增案件
            </PrimaryLink>
          }
        />
      ) : null}
    </div>
  );
}
