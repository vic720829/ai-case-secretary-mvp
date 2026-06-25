"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { SignInForm } from "./SignInForm";
import { useAuth } from "./AuthProvider";

export function AuthGate({ children }: { children: ReactNode }) {
  const { configured, loading, user } = useAuth();

  if (!configured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-100 p-6">
        <section className="w-full max-w-xl rounded-lg border border-amber-200 bg-white p-6 shadow-panel">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-amber-100 p-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-950">Firebase 尚未設定</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                請先複製 <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.example</code> 為{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.local</code>，填入 Firebase Web App
                config，並啟用 Authentication 的 Email/Password 登入。
              </p>
              <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                <div>NEXT_PUBLIC_FIREBASE_API_KEY</div>
                <div>NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN</div>
                <div>NEXT_PUBLIC_FIREBASE_PROJECT_ID</div>
                <div>NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET</div>
                <div>NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID</div>
                <div>NEXT_PUBLIC_FIREBASE_APP_ID</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-100">
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-panel">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          正在確認登入狀態
        </div>
      </main>
    );
  }

  if (!user) {
    return <SignInForm />;
  }

  return <AppShell>{children}</AppShell>;
}
