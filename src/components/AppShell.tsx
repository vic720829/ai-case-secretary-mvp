"use client";

import {
  AlertTriangle,
  Bell,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Flag,
  GitBranch,
  History,
  LayoutDashboard,
  KeyRound,
  Link2,
  LogOut,
  MessageSquareText,
  Newspaper,
  Plus,
  ScrollText,
  ScanSearch,
  UserCog,
  UsersRound,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  canAccessFeature,
  canAccessPath,
  getDefaultPathForRole,
  getFeatureByPath,
  type FeatureKey
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

const navItems = [
  { href: "/daily-summary", label: "每日摘要", icon: Newspaper, feature: "dailySummary" },
  { href: "/risk-center", label: "今日風險", icon: AlertTriangle, feature: "riskCenter" },
  { href: "/ai-tasks", label: "待辦審核", icon: Bot, feature: "aiTasks" },
  { href: "/incidents", label: "事件中心", icon: GitBranch, feature: "incidents" },
  { href: "/reminders", label: "提醒中心", icon: Bell, feature: "reminders" },
  { href: "/drawing-reviews", label: "審圖中心", icon: ScanSearch, feature: "drawingReviews" },
  { href: "/projects", label: "案件列表", icon: BriefcaseBusiness, feature: "projects" },
  { href: "/calendar", label: "共享月曆", icon: CalendarDays, feature: "calendar" },
  { href: "/schedule", label: "工期總表", icon: CalendarDays, feature: "schedule" },
  { href: "/tasks", label: "待辦列表", icon: ClipboardList, feature: "tasks" },
  { href: "/line-groups", label: "LINE群組", icon: Link2, feature: "lineGroups" },
  { href: "/line-members", label: "LINE成員", icon: UsersRound, feature: "lineMembers" },
  { href: "/messages", label: "LINE對話", icon: MessageSquareText, feature: "messages" },
  { href: "/webhook-logs", label: "Webhook紀錄", icon: ScrollText, feature: "webhookLogs" },
  { href: "/users", label: "員工管理", icon: UserCog, feature: "users" },
  { href: "/learning", label: "AI學習", icon: BrainCircuit, feature: "learning" },
  { href: "/audit-logs", label: "操作紀錄", icon: History, feature: "auditLogs" },
  { href: "/milestones", label: "關鍵節點", icon: Flag, feature: "milestones" }
] satisfies Array<{
  href: string;
  label: string;
  icon: typeof AlertTriangle;
  feature: FeatureKey;
}>;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { changePassword, profile, user, signOutUser } = useAuth();
  const role = profile?.role ?? "";
  const visibleNavItems = navItems.filter((item) => canAccessFeature(role, item.feature));
  const canCreateProject = canAccessFeature(role, "createProject");
  const canCreateTask = canAccessFeature(role, "createTask");
  const canAccessCurrentPath = canAccessPath(role, pathname);
  const blockedFeature = getFeatureByPath(pathname);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");

    if (newPassword !== confirmPassword) {
      setPasswordError("兩次輸入的新密碼不一致。");
      return;
    }

    setPasswordSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密碼已更新，下次請使用新密碼登入。");
    } catch (caught) {
      setPasswordError(getPasswordErrorMessage(caught));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-100 text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-stone-200 bg-white px-4 py-5 lg:block">
        <Link className="flex items-center gap-3 rounded-md px-2" href={getDefaultPathForRole(role)}>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-700 text-white">
            <LayoutDashboard className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-950">AI 案件秘書</div>
            <div className="text-xs text-slate-500">Interior Ops MVP</div>
          </div>
        </Link>

        {canCreateProject || canCreateTask ? (
          <div className="mt-5 grid gap-2">
            {canCreateProject ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white shadow-panel transition hover:bg-teal-800"
                href="/projects/new"
              >
                <BriefcaseBusiness className="h-4 w-4" aria-hidden />
                建立案件
              </Link>
            ) : null}
            {canCreateTask ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50"
                href="/tasks/new"
              >
                <Plus className="h-4 w-4" aria-hidden />
                建立待辦
              </Link>
            ) : null}
          </div>
        ) : null}

        <nav className="mt-6 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-teal-50 text-teal-800"
                    : "text-slate-600 hover:bg-stone-100 hover:text-slate-950"
                )}
                href={item.href}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-5 left-4 right-4 rounded-md border border-stone-200 bg-stone-50 p-3">
          <div className="truncate text-xs text-slate-500">{user?.email}</div>
          <button
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
            type="button"
            onClick={() => {
              setPasswordModalOpen(true);
              setPasswordError("");
              setPasswordMessage("");
            }}
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            修改密碼
          </button>
          <button
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={() => void signOutUser()}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            登出
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link className="text-sm font-semibold text-slate-950" href={getDefaultPathForRole(role)}>
            AI 案件秘書
          </Link>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-teal-200 text-teal-700"
              type="button"
              onClick={() => {
                setPasswordModalOpen(true);
                setPasswordError("");
                setPasswordMessage("");
              }}
              aria-label="修改密碼"
              title="修改密碼"
            >
              <KeyRound className="h-4 w-4" aria-hidden />
            </button>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700"
              type="button"
              onClick={() => void signOutUser()}
              aria-label="登出"
              title="登出"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        {canCreateProject || canCreateTask ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {canCreateProject ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
                href="/projects/new"
              >
                <BriefcaseBusiness className="h-4 w-4" aria-hidden />
                建立案件
              </Link>
            ) : null}
            {canCreateTask ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-teal-700"
                href="/tasks/new"
              >
                <Plus className="h-4 w-4" aria-hidden />
                建立待辦
              </Link>
            ) : null}
          </div>
        ) : null}
        <nav className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium",
                  active ? "bg-teal-700 text-white" : "bg-stone-100 text-slate-600"
                )}
                href={item.href}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {canAccessCurrentPath ? (
            children
          ) : (
            <AccessDenied
              featureLabel={blockedFeature?.label ?? "此功能"}
              featureDescription={blockedFeature?.description ?? "目前角色沒有使用此功能的權限。"}
              fallbackHref={getDefaultPathForRole(role)}
            />
          )}
        </div>
      </main>

      {canCreateProject || canCreateTask ? (
        <div className="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-2 lg:hidden">
          {canCreateProject ? (
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-teal-200 bg-white px-4 text-sm font-semibold text-teal-700 shadow-panel transition hover:bg-teal-50"
              href="/projects/new"
              aria-label="建立案件"
              title="建立案件"
            >
              <BriefcaseBusiness className="h-4 w-4" aria-hidden />
              建立案件
            </Link>
          ) : null}
          {canCreateTask ? (
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-teal-700 px-4 text-sm font-semibold text-white shadow-panel transition hover:bg-teal-800"
              href="/tasks/new"
              aria-label="建立待辦"
              title="建立待辦"
            >
              <Plus className="h-4 w-4" aria-hidden />
              建立待辦
            </Link>
          ) : null}
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">修改密碼</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">請輸入目前密碼後設定新密碼。</p>
              </div>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                aria-label="關閉"
                title="關閉"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <form className="mt-5 space-y-4" onSubmit={(event) => void handleChangePassword(event)}>
              <PasswordField
                label="目前密碼"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <PasswordField
                label="新密碼"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <PasswordField
                label="再次輸入新密碼"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />

              {passwordError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {passwordError}
                </div>
              ) : null}
              {passwordMessage ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {passwordMessage}
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                >
                  取消
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={passwordSubmitting}
                >
                  {passwordSubmitting ? "更新中" : "更新密碼"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        minLength={6}
        autoComplete={autoComplete}
        required
      />
    </label>
  );
}

function AccessDenied({
  featureLabel,
  featureDescription,
  fallbackHref
}: {
  featureLabel: string;
  featureDescription: string;
  fallbackHref: string;
}) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-white p-6 shadow-panel">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-amber-100 p-2 text-amber-700">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-slate-950">沒有權限使用「{featureLabel}」</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{featureDescription}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            如果這是你需要處理的工作，請 Owner 或管理者調整你的角色或案件權限。
          </p>
          <Link
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
            href={fallbackHref}
          >
            回到可使用頁面
          </Link>
        </div>
      </div>
    </section>
  );
}

function getPasswordErrorMessage(caught: unknown) {
  if (!(caught instanceof Error)) return "密碼更新失敗，請稍後再試。";

  if (caught.message.includes("auth/invalid-credential") || caught.message.includes("auth/wrong-password")) {
    return "目前密碼不正確。";
  }

  if (caught.message.includes("auth/weak-password")) {
    return "新密碼太弱，請至少輸入 6 碼。";
  }

  if (caught.message.includes("auth/requires-recent-login")) {
    return "登入狀態已過期，請登出後重新登入再修改密碼。";
  }

  return caught.message;
}
