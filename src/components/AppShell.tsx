"use client";

import {
  AlertTriangle,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Flag,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageSquareText,
  Plus,
  ScrollText,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

const navItems = [
  { href: "/risk-center", label: "今日風險", icon: AlertTriangle },
  { href: "/ai-tasks", label: "AI 審核", icon: Bot },
  { href: "/reminders", label: "提醒中心", icon: Bell },
  { href: "/projects", label: "案件列表", icon: BriefcaseBusiness },
  { href: "/schedule", label: "工期總表", icon: CalendarDays },
  { href: "/tasks", label: "任務列表", icon: ClipboardList },
  { href: "/line-groups", label: "LINE群組", icon: Link2 },
  { href: "/line-members", label: "LINE成員", icon: UsersRound },
  { href: "/messages", label: "LINE訊息", icon: MessageSquareText },
  { href: "/webhook-logs", label: "Webhook紀錄", icon: ScrollText },
  { href: "/milestones", label: "關鍵節點", icon: Flag }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOutUser } = useAuth();

  return (
    <div className="min-h-screen bg-stone-100 text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-stone-200 bg-white px-4 py-5 lg:block">
        <Link className="flex items-center gap-3 rounded-md px-2" href="/risk-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-700 text-white">
            <LayoutDashboard className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-950">AI 案件秘書</div>
            <div className="text-xs text-slate-500">Interior Ops MVP</div>
          </div>
        </Link>

        <nav className="mt-8 space-y-1">
          {navItems.map((item) => {
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
          <Link className="text-sm font-semibold text-slate-950" href="/risk-center">
            AI 案件秘書
          </Link>
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
        <nav className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {navItems.map((item) => {
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
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>

      <Link
        className="fixed bottom-5 right-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-teal-700 text-white shadow-panel transition hover:bg-teal-800 lg:hidden"
        href="/tasks/new"
        aria-label="新增任務"
        title="新增任務"
      >
        <Plus className="h-5 w-5" aria-hidden />
      </Link>
    </div>
  );
}
