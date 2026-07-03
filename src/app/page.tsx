"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { LoadingState } from "@/components/Ui";
import { getDefaultPathForRole } from "@/lib/permissions";

export default function HomePage() {
  const router = useRouter();
  const { loading, profile } = useAuth();

  useEffect(() => {
    if (!loading && profile) {
      router.replace(getDefaultPathForRole(profile.role));
    }
  }, [loading, profile, router]);

  return <LoadingState label="正在前往你的工作頁面" />;
}
