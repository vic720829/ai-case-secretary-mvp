import type { UserRole } from "./types";

export type FeatureKey =
  | "riskCenter"
  | "aiTasks"
  | "incidents"
  | "reminders"
  | "projects"
  | "calendar"
  | "schedule"
  | "tasks"
  | "lineGroups"
  | "lineMembers"
  | "messages"
  | "webhookLogs"
  | "users"
  | "learning"
  | "auditLogs"
  | "milestones"
  | "createProject"
  | "createTask";

type RoleDefinition = {
  role: UserRole;
  label: string;
  shortLabel: string;
  description: string;
  bestFor: string;
  canDo: string[];
  cannotDo: string[];
};

type FeatureDefinition = {
  key: FeatureKey;
  label: string;
  description: string;
  roles: UserRole[];
  paths: string[];
};

export const roleDefinitions: RoleDefinition[] = [
  {
    role: "owner",
    label: "Owner",
    shortLabel: "最高權限",
    description: "公司負責人或系統最高管理者。可以看全部資料、管理員工、系統設定與敏感紀錄。",
    bestFor: "老闆、系統最高負責人。",
    canDo: ["全部案件與待辦", "員工管理", "LINE 設定", "AI 學習", "Webhook / 操作紀錄", "所有摘要與案件記憶"],
    cannotDo: ["無"]
  },
  {
    role: "admin",
    label: "管理者",
    shortLabel: "日常後台管理",
    description: "管理日常營運資料，可設定 LINE 群組、員工帳號與大部分後台功能。",
    bestFor: "核心行政、資深設計師、可協助管理系統的人。",
    canDo: ["案件與待辦管理", "員工管理", "LINE 群組與成員設定", "待辦審核", "重新生成 AI 摘要"],
    cannotDo: ["Webhook 紀錄", "操作紀錄", "AI 學習規則"]
  },
  {
    role: "manager",
    label: "主管",
    shortLabel: "案件與風險管理",
    description: "可看案件風險、審核 AI 待辦、指派工作，但不能管理員工或系統敏感設定。",
    bestFor: "設計主管、工務主管、專案管理者。",
    canDo: ["今日風險", "待辦審核", "事件中心", "案件 / 工期 / 待辦管理", "LINE 對話查看", "重新生成 AI 摘要"],
    cannotDo: ["員工管理", "LINE 群組設定", "Webhook 紀錄", "操作紀錄", "AI 學習規則"]
  },
  {
    role: "staff",
    label: "員工",
    shortLabel: "一般執行人員",
    description: "只保留日常工作需要的功能，並且只看得到被加入的案件、待辦、工期、備忘錄與文件入口。",
    bestFor: "設計助理、一般設計師、工務執行人員。",
    canDo: ["被加入案件的案件列表", "被加入案件的待辦", "被加入案件的工期與月曆", "提醒中心", "案件文件入口"],
    cannotDo: ["今日風險總覽", "待辦審核", "事件中心", "LINE 設定與對話", "員工管理", "AI 學習", "系統紀錄"]
  },
  {
    role: "viewer",
    label: "檢視者",
    shortLabel: "只讀檢視",
    description: "只能查看被加入的案件與工期資料，不可新增、修改或刪除。",
    bestFor: "只需要查看進度的人、短期協作人員。",
    canDo: ["被加入案件的案件列表", "被加入案件的工期總表", "案件文件入口"],
    cannotDo: ["新增 / 修改 / 刪除資料", "LINE 對話", "AI 審核", "員工與系統設定"]
  }
];

export const featureDefinitions: FeatureDefinition[] = [
  {
    key: "riskCenter",
    label: "今日風險",
    description: "查看全公司風險、待審、逾期與高風險案件。",
    roles: ["owner", "admin", "manager"],
    paths: ["/risk-center"]
  },
  {
    key: "aiTasks",
    label: "待辦審核",
    description: "審核 AI 從 LINE 對話建立的待辦草稿。",
    roles: ["owner", "admin", "manager"],
    paths: ["/ai-tasks"]
  },
  {
    key: "incidents",
    label: "事件中心",
    description: "查看同一事件的合併、去重與處理狀態。",
    roles: ["owner", "admin", "manager"],
    paths: ["/incidents"]
  },
  {
    key: "reminders",
    label: "提醒中心",
    description: "處理到期、逾期、未回覆與工期提醒。",
    roles: ["owner", "admin", "manager", "staff"],
    paths: ["/reminders"]
  },
  {
    key: "projects",
    label: "案件列表",
    description: "查看案件與案件內功能。下一階段會改成只顯示被加入的案件。",
    roles: ["owner", "admin", "manager", "staff", "viewer"],
    paths: ["/projects"]
  },
  {
    key: "calendar",
    label: "共享月曆",
    description: "查看與建立工作行程、會議、現場安排。",
    roles: ["owner", "admin", "manager", "staff"],
    paths: ["/calendar"]
  },
  {
    key: "schedule",
    label: "工期總表",
    description: "查看施工工期、今日案場與工程排程。",
    roles: ["owner", "admin", "manager", "staff", "viewer"],
    paths: ["/schedule"]
  },
  {
    key: "tasks",
    label: "待辦列表",
    description: "查看與處理待辦。viewer 不可進入待辦總表。",
    roles: ["owner", "admin", "manager", "staff"],
    paths: ["/tasks"]
  },
  {
    key: "lineGroups",
    label: "LINE 群組",
    description: "設定客戶群、公司後台群與通知層級。",
    roles: ["owner", "admin"],
    paths: ["/line-groups"]
  },
  {
    key: "lineMembers",
    label: "LINE 成員",
    description: "標記客戶、內部人員與廠商身分。",
    roles: ["owner", "admin"],
    paths: ["/line-members"]
  },
  {
    key: "messages",
    label: "LINE 對話",
    description: "查看案件 LINE 對話紀錄。",
    roles: ["owner", "admin", "manager"],
    paths: ["/messages"]
  },
  {
    key: "webhookLogs",
    label: "Webhook 紀錄",
    description: "系統收 LINE webhook 的底層紀錄，只給 Owner 排查問題。",
    roles: ["owner"],
    paths: ["/webhook-logs"]
  },
  {
    key: "users",
    label: "員工管理",
    description: "建立員工帳號、重設密碼、設定角色與啟用狀態。",
    roles: ["owner", "admin"],
    paths: ["/users"]
  },
  {
    key: "learning",
    label: "AI 學習",
    description: "管理 owner 確認過的 AI 規則與偏好。",
    roles: ["owner"],
    paths: ["/learning"]
  },
  {
    key: "auditLogs",
    label: "操作紀錄",
    description: "查看誰改了哪些重要資料，只給 Owner 查帳。",
    roles: ["owner"],
    paths: ["/audit-logs"]
  },
  {
    key: "milestones",
    label: "關鍵節點",
    description: "查看與管理關鍵節點、提醒日與風險等級。",
    roles: ["owner", "admin", "manager", "staff"],
    paths: ["/milestones"]
  },
  {
    key: "createProject",
    label: "建立案件",
    description: "新增案件基本資料。",
    roles: ["owner", "admin", "manager"],
    paths: ["/projects/new"]
  },
  {
    key: "createTask",
    label: "建立待辦",
    description: "新增一般待辦。",
    roles: ["owner", "admin", "manager", "staff"],
    paths: ["/tasks/new"]
  }
];

export function getRoleDefinition(role: UserRole | "" | undefined) {
  return roleDefinitions.find((definition) => definition.role === role) ?? roleDefinitions.find((definition) => definition.role === "staff")!;
}

export function canAccessFeature(role: UserRole | "" | undefined, key: FeatureKey) {
  const feature = featureDefinitions.find((item) => item.key === key);
  if (!feature || !role) return false;

  return feature.roles.includes(role);
}

export function canAccessPath(role: UserRole | "" | undefined, pathname: string) {
  const feature = getFeatureByPath(pathname);
  if (!feature) return true;

  return Boolean(role && feature.roles.includes(role));
}

export function getDefaultPathForRole(role: UserRole | "" | undefined) {
  if (canAccessFeature(role, "riskCenter")) return "/risk-center";
  if (canAccessFeature(role, "projects")) return "/projects";
  if (canAccessFeature(role, "schedule")) return "/schedule";

  return "/projects";
}

export function getFeatureByPath(pathname: string) {
  const sortedFeatures = [...featureDefinitions].sort(
    (a, b) => Math.max(...b.paths.map((path) => path.length)) - Math.max(...a.paths.map((path) => path.length))
  );

  return sortedFeatures.find((feature) =>
    feature.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}
