import type {
  AiTaskType,
  LineMemberRole,
  LineMessageType,
  LineNotificationLevel,
  ProjectStageStatus,
  RiskLevel,
  TaskSource,
  TaskStatus,
  UserRole
} from "./types";

export const taskStatusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: "todo", label: "待辦" },
  { value: "doing", label: "進行中" },
  { value: "done", label: "完成" }
];

export const projectStageStatusOptions: Array<{ value: ProjectStageStatus; label: string }> = [
  { value: "todo", label: "未開始" },
  { value: "doing", label: "進行中" },
  { value: "done", label: "完成" }
];

export const taskSourceOptions: Array<{ value: TaskSource; label: string }> = [
  { value: "manual", label: "手動" },
  { value: "line", label: "LINE" },
  { value: "ai", label: "AI" },
  { value: "voice", label: "語音" }
];

export const riskLevelOptions: Array<{ value: RiskLevel; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "critical", label: "重大" }
];

export const lineMessageTypeOptions: Array<{ value: LineMessageType; label: string }> = [
  { value: "text", label: "文字" },
  { value: "image", label: "圖片" },
  { value: "audio", label: "語音" }
];

export const lineNotificationLevelOptions: Array<{
  value: LineNotificationLevel;
  label: string;
  description: string;
}> = [
  {
    value: "primary",
    label: "主要後台",
    description: "收 high / critical 即時通知、每日摘要、可查詢案件。適合老闆或核心管理群。"
  },
  {
    value: "secondary",
    label: "一般後台",
    description: "收每日摘要與 critical 即時通知、可查詢案件。適合設計師、助理、工務群。"
  },
  {
    value: "critical_only",
    label: "只收重大風險",
    description: "只收缺失、客訴、修補、漏水、重大品質問題等 critical 通知。適合現場處理群。"
  },
  {
    value: "test",
    label: "測試群",
    description: "不收正式推播，只用來測試查詢與按鈕功能。"
  },
  {
    value: "none",
    label: "停用通知",
    description: "不收推播，也不作為日常管理群。"
  }
];

export const lineMemberRoleOptions: Array<{ value: LineMemberRole; label: string }> = [
  { value: "internal", label: "內部人員" },
  { value: "client", label: "客戶" },
  { value: "vendor", label: "廠商" }
];

export const aiTaskTypeOptions: Array<{ value: AiTaskType; label: string }> = [
  { value: "promise", label: "承諾" },
  { value: "change", label: "變更" },
  { value: "followup", label: "追蹤" },
  { value: "payment", label: "收款" },
  { value: "invoice", label: "發票" },
  { value: "complaint", label: "客訴 / 缺失" },
  { value: "schedule", label: "工期" },
  { value: "file", label: "圖面 / 檔案" }
];

export const userRoleOptions: Array<{ value: UserRole; label: string; description: string }> = [
  { value: "owner", label: "Owner", description: "最高權限，可管理員工與系統設定。" },
  { value: "admin", label: "管理者", description: "可管理員工、LINE 設定與後台資料。" },
  { value: "staff", label: "員工", description: "可管理案件、待辦、工期與提醒。" },
  { value: "viewer", label: "檢視者", description: "只能查看資料，不能修改。" }
];

export const projectStageOptions = [
  "初談",
  "丈量",
  "提案",
  "設計深化",
  "報價",
  "簽約",
  "施工",
  "驗收",
  "保固"
];

export const projectStatusOptions = [
  "洽談中",
  "進行中",
  "等待客戶",
  "暫停",
  "完工",
  "封存"
];
