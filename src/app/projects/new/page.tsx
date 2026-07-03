"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ProjectForm } from "@/components/ProjectForm";
import { SecondaryLink } from "@/components/Ui";
import { useAuth } from "@/components/AuthProvider";
import { toAuditActor } from "@/lib/audit";
import { createProject } from "@/lib/firestore";
import type { ProjectInput } from "@/lib/types";

export default function NewProjectPage() {
  const router = useRouter();
  const { user } = useAuth();

  async function handleSubmit(value: ProjectInput) {
    const id = await createProject(value, toAuditActor(user));
    router.push(`/projects/${id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="新增案件"
        description="建立案件後，可以在新增待辦頁面把待辦綁定到此案件。"
        action={
          <SecondaryLink href="/projects">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回案件列表
          </SecondaryLink>
        }
      />
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <ProjectForm currentUserId={user?.uid} submitLabel="建立案件" onSubmit={handleSubmit} />
      </section>
    </div>
  );
}
