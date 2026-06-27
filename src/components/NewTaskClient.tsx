"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { TaskForm } from "./TaskForm";
import { LoadingState, SecondaryLink } from "./Ui";
import { createTask, listProjects } from "@/lib/firestore";
import { notifyAdminGroupsAboutTask } from "@/lib/taskNotification";
import type { Project, TaskInput } from "@/lib/types";
import { useAuth } from "./AuthProvider";

export function NewTaskClient({ initialProjectId }: { initialProjectId?: string }) {
  const router = useRouter();
  const { user } = useAuth();
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
    await notifyAdminGroupsAboutTask({ user, taskId: id, action: "manual_created" }).catch((caught) => {
      console.warn(caught instanceof Error ? caught.message : "通知公司後台群失敗。");
    });
    router.push(`/tasks/${id}`);
  }

  if (loading) {
    return <LoadingState label="正在準備待辦表單" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="新增待辦"
        description="建立待辦、追蹤負責人與截止日，並標記風險等級。"
        action={
          <SecondaryLink href="/tasks">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回待辦列表
          </SecondaryLink>
        }
      />
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <TaskForm
          projects={projects}
          initialProjectId={initialProjectId}
          submitLabel="建立待辦"
          onSubmit={handleSubmit}
        />
      </section>
    </div>
  );
}
