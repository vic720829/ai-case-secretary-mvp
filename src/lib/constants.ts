import type {
  AiTaskType,
  LineMemberRole,
  LineMessageType,
  ProjectStageStatus,
  RiskLevel,
  TaskSource,
  TaskStatus
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
  { value: "high", label: "高" }
];

export const lineMessageTypeOptions: Array<{ value: LineMessageType; label: string }> = [
  { value: "text", label: "文字" },
  { value: "image", label: "圖片" },
  { value: "audio", label: "語音" }
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
  { value: "invoice", label: "發票" }
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
