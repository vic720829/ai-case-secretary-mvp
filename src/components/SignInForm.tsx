"use client";

import { LogIn, UserPlus } from "lucide-react";
import { useState } from "react";
import { useAuth } from "./AuthProvider";

export function SignInForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "登入失敗，請稍後再試。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 p-6">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
        <div>
          <p className="text-sm font-medium text-teal-700">AI 案件秘書 MVP</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">登入後台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            第一階段先管理案件、任務與今日風險，不接 AI 與 LINE。
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-medium">
          <button
            className={`rounded px-3 py-2 ${mode === "signin" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
            type="button"
            onClick={() => setMode("signin")}
          >
            登入
          </button>
          <button
            className={`rounded px-3 py-2 ${mode === "signup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
            type="button"
            onClick={() => setMode("signup")}
          >
            註冊
          </button>
        </div>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">密碼</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={submitting}
          >
            {mode === "signin" ? <LogIn className="h-4 w-4" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
            {submitting ? "處理中" : mode === "signin" ? "登入" : "建立帳號"}
          </button>
        </form>
      </section>
    </main>
  );
}
