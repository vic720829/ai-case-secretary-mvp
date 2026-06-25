"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { TaskForm } from "./TaskForm";
import { LoadingState, SecondaryLink } from "./Ui";
import { createTask, listProjects } from "@/lib/firestore";
import type { Project, TaskInput } from "@/lib/types";

export function NewTaskClient({ initialProjectId }: { initialProjectId?: string }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProjects() {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setLoading(false);
    }

    void loadProjects();
  }, []);

  async function handleSubmit(value: TaskInput) {
    const id = await createTask(value);
    router.push(`/tasks/${id}`);
  }

  if (loading) {
    return <LoadingState label="正在準備任務表單" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="新增任務"
        description="建立待辦、追蹤負責人與截止日，並標記風險等級。"
        action={
          <SecondaryLink href="/tasks">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回任務列表
          </SecondaryLink>
        }
      />
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <TaskForm
          projects={projects}
          initialProjectId={initialProjectId}
          submitLabel="建立任務"
          onSubmit={handleSubmit}
        />
      </section>
    </div>
  );
}
