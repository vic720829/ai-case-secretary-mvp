"use client";

import { Edit3, KeyRound, Save, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button, EmptyState, ErrorMessage, LoadingState } from "@/components/Ui";
import { useAuth } from "@/components/AuthProvider";
import { userRoleOptions } from "@/lib/constants";
import { formatDateTime } from "@/lib/date";
import { getReadableError } from "@/lib/errors";
import { listUserProfiles } from "@/lib/firestore";
import { featureDefinitions, getRoleDefinition, roleDefinitions } from "@/lib/permissions";
import type { UserProfile, UserProfileInput, UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

type NewUserInput = UserProfileInput & {
  password: string;
};

const emptyUser: NewUserInput = {
  email: "",
  displayName: "",
  password: "",
  role: "staff",
  active: true
};

export function UsersClient() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [draft, setDraft] = useState<NewUserInput>(emptyUser);
  const [editingId, setEditingId] = useState("");
  const [editValue, setEditValue] = useState<UserProfileInput | null>(null);
  const [resettingId, setResettingId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers() {
    setError("");

    try {
      setUsers(await listUserProfiles());
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  const activeCount = useMemo(() => users.filter((item) => item.active).length, [users]);
  const adminCount = useMemo(
    () => users.filter((item) => item.role === "owner" || item.role === "admin" || item.role === "manager").length,
    [users]
  );

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      if (!user) throw new Error("請先登入。");
      const value = normalizeNewUser(draft);
      assertNewUser(value);
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(value)
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "新增員工失敗。");
      }

      setDraft(emptyUser);
      setSuccessMessage("員工帳號已建立。");
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateUser(profile: UserProfile) {
    if (!editValue) return;
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const value = normalizeUserProfile(editValue);
      assertUserProfile(value);

      if (profile.id === user?.uid && !value.active) {
        throw new Error("不能停用目前登入中的自己，避免被鎖在系統外。");
      }

      if (profile.id === user?.uid && value.role !== "owner" && value.role !== "admin") {
        throw new Error("不能把目前登入中的自己改成非管理角色，避免失去員工管理權限。");
      }

      if (!user) throw new Error("請先登入。");
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: profile.id,
          displayName: value.displayName,
          role: value.role,
          active: value.active
        })
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "更新員工失敗。");
      }

      setEditingId("");
      setEditValue(null);
      setSuccessMessage("員工資料已更新。");
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(profile: UserProfile) {
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      if (!user) throw new Error("請先登入。");
      if (resetPassword.length < 6) throw new Error("新臨時密碼至少需要 6 碼。");

      const token = await user.getIdToken();
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: profile.id,
          password: resetPassword
        })
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "重設密碼失敗。");
      }

      setResettingId("");
      setResetPassword("");
      setSuccessMessage(`已重設 ${profile.displayName || profile.email} 的密碼。`);
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function beginEdit(profile: UserProfile) {
    setEditingId(profile.id);
    setResettingId("");
    setResetPassword("");
    setEditValue({
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      active: profile.active
    });
  }

  if (loading) {
    return <LoadingState label="正在讀取員工資料" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="員工管理"
        description="建立員工登入帳號，設定後台角色與啟用狀態。"
      />

      <ErrorMessage message={error} />
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="員工總數" value={users.length} tone="slate" />
        <MetricCard label="啟用中" value={activeCount} tone="teal" />
        <MetricCard label="管理 / 主管角色" value={adminCount} tone="indigo" />
      </div>

      <RolePermissionGuide />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <form className="space-y-4" onSubmit={(event) => void handleCreateUser(event)}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <UserPlus className="h-4 w-4 text-teal-700" aria-hidden />
            新增員工帳號
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Email">
              <input
                className={inputClassName}
                type="email"
                value={draft.email}
                onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </Field>
            <Field label="員工名稱">
              <input
                className={inputClassName}
                value={draft.displayName}
                onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                required
              />
            </Field>
            <Field label="臨時密碼">
              <input
                className={inputClassName}
                type="password"
                minLength={6}
                autoComplete="new-password"
                value={draft.password}
                onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                required
              />
            </Field>
            <Field label="角色">
              <RoleSelect
                value={draft.role}
                onChange={(role) => setDraft((current) => ({ ...current, role }))}
              />
              <RoleHelp role={draft.role} />
            </Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              type="checkbox"
              checked={draft.active}
              onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
            />
            啟用此員工
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              <Save className="h-4 w-4" aria-hidden />
              {submitting ? "建立中" : "建立員工"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <UsersRound className="h-4 w-4 text-teal-700" aria-hidden />
          員工列表
        </div>

        {users.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3">員工</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">建立時間</th>
                  <th className="px-4 py-3">更新時間</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {users.map((profile) => {
                  const isEditing = editingId === profile.id && editValue;
                  const isResettingPassword = resettingId === profile.id;
                  const value = isEditing ? editValue : profile;

                  return (
                    <tr key={profile.id} className="align-top hover:bg-stone-50">
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              className={inputClassName}
                              value={value.displayName}
                              onChange={(event) =>
                                setEditValue((current) => current ? { ...current, displayName: event.target.value } : current)
                              }
                            />
                            <div className="break-all text-xs text-slate-500">{profile.email}</div>
                          </div>
                        ) : (
                          <>
                            <div className="font-semibold text-slate-950">{profile.displayName}</div>
                            <div className="mt-1 break-all text-xs text-slate-500">{profile.email}</div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <div className="min-w-72 space-y-2">
                            <RoleSelect
                              value={value.role}
                              onChange={(role) => setEditValue((current) => current ? { ...current, role } : current)}
                            />
                            <RoleHelp role={value.role} compact />
                          </div>
                        ) : (
                          <RoleBadge role={profile.role} />
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input
                              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                              type="checkbox"
                              checked={value.active}
                              onChange={(event) =>
                                setEditValue((current) => current ? { ...current, active: event.target.checked } : current)
                              }
                            />
                            啟用
                          </label>
                        ) : (
                          <ActiveBadge active={profile.active} />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {formatDateTime(profile.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {formatDateTime(profile.updatedAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <Button type="button" disabled={submitting} onClick={() => void handleUpdateUser(profile)}>
                              <Save className="h-4 w-4" aria-hidden />
                              儲存
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setEditingId("");
                                setEditValue(null);
                              }}
                            >
                              <X className="h-4 w-4" aria-hidden />
                              取消
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end">
                            {isResettingPassword ? (
                              <div className="w-72 max-w-full space-y-2 text-left">
                                <input
                                  className={inputClassName}
                                  type="password"
                                  minLength={6}
                                  autoComplete="new-password"
                                  placeholder="輸入新臨時密碼"
                                  value={resetPassword}
                                  onChange={(event) => setResetPassword(event.target.value)}
                                />
                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => void handleResetPassword(profile)}
                                  >
                                    <Save className="h-4 w-4" aria-hidden />
                                    儲存
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                      setResettingId("");
                                      setResetPassword("");
                                    }}
                                  >
                                    <X className="h-4 w-4" aria-hidden />
                                    取消
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => {
                                    setEditingId("");
                                    setEditValue(null);
                                    setResettingId(profile.id);
                                    setResetPassword("");
                                    setError("");
                                    setSuccessMessage("");
                                  }}
                                >
                                  <KeyRound className="h-4 w-4" aria-hidden />
                                  重設密碼
                                </Button>
                                <Button type="button" variant="secondary" onClick={() => beginEdit(profile)}>
                                  <Edit3 className="h-4 w-4" aria-hidden />
                                  編輯
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="尚未建立員工資料" description="先建立第一位員工，之後就不用到 Firebase 手動新增使用者資料。" />
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function RolePermissionGuide() {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden />
            角色權限說明
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            設定員工前先看這裡。角色越高，可看到的全公司資料與設定越多；一般員工與檢視者會隱藏敏感選單。
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-5">
        {roleDefinitions.map((definition) => (
          <article key={definition.role} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <RoleBadge role={definition.role} />
              <span className="text-xs text-slate-500">{definition.shortLabel}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{definition.description}</p>
            <p className="mt-3 text-xs font-semibold text-slate-500">適合</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">{definition.bestFor}</p>
            <p className="mt-3 text-xs font-semibold text-emerald-700">可以使用</p>
            <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-700">
              {definition.canDo.slice(0, 5).map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs font-semibold text-red-700">不能使用</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{definition.cannotDo.join("、")}</p>
          </article>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-stone-200">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-950">功能權限對照</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            系統依員工角色自動開放功能；目前不提供個別員工另外勾選。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead className="bg-white text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">功能</th>
                <th className="px-4 py-3">用途</th>
                <th className="px-4 py-3">可使用角色</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white">
              {featureDefinitions.map((feature) => (
                <tr key={feature.key} className={feature.key === "finance" ? "bg-emerald-50/60" : undefined}>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{feature.label}</td>
                  <td className="min-w-72 px-4 py-3 leading-6 text-slate-600">{feature.description}</td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-64 flex-wrap gap-2">
                      {feature.roles.map((role) => (
                        <RoleBadge key={role} role={role} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
        目前這是功能權限：會控制選單與頁面能不能進入。下一階段若要管「某員工只能看自己負責的案件檔案」，
        需要再加案件成員權限。
      </div>
    </section>
  );
}

function RoleSelect({
  value,
  onChange
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
}) {
  return (
    <select
      className={inputClassName}
      value={value}
      onChange={(event) => onChange(event.target.value as UserRole)}
    >
      {userRoleOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label} - {option.description}
        </option>
      ))}
    </select>
  );
}

function RoleHelp({ role, compact = false }: { role: UserRole; compact?: boolean }) {
  const definition = getRoleDefinition(role);

  if (compact) {
    return (
      <p className="text-xs leading-5 text-slate-500">
        {definition.shortLabel}：{definition.description}
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-6 text-slate-600">
      <div className="font-semibold text-slate-800">{definition.shortLabel}</div>
      <div>{definition.description}</div>
      <div className="mt-1 text-xs text-slate-500">適合：{definition.bestFor}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const option = userRoleOptions.find((item) => item.value === role);
  const className = {
    owner: "bg-purple-50 text-purple-700 ring-purple-200",
    admin: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    manager: "bg-amber-50 text-amber-700 ring-amber-200",
    staff: "bg-teal-50 text-teal-700 ring-teal-200",
    viewer: "bg-slate-50 text-slate-700 ring-slate-200"
  }[role];

  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", className)}>
      {option?.label ?? role}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"
      )}
    >
      {active ? "啟用" : "停用"}
    </span>
  );
}

function MetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "slate" | "teal" | "indigo";
}) {
  const toneClassName = {
    slate: "bg-slate-50 text-slate-700",
    teal: "bg-teal-50 text-teal-700",
    indigo: "bg-indigo-50 text-indigo-700"
  }[tone];

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-3xl font-semibold text-slate-950">{value}</div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", toneClassName)}>
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function normalizeNewUser(input: NewUserInput): NewUserInput {
  return {
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    password: input.password,
    role: input.role,
    active: input.active
  };
}

function normalizeUserProfile(input: UserProfileInput): UserProfileInput {
  return {
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    role: input.role,
    active: input.active
  };
}

function assertNewUser(input: NewUserInput) {
  assertUserProfile(input);

  if (input.password.length < 6) {
    throw new Error("臨時密碼至少需要 6 碼。");
  }
}

function assertUserProfile(input: UserProfileInput) {
  if (!input.email) throw new Error("請填 Email。");
  if (!input.displayName) throw new Error("請填員工名稱。");
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
