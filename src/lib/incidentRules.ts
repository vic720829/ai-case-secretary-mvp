import type { AiTaskType, IncidentType, RiskLevel } from "./types";

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const TOPIC_RULES = [
  {
    key: "complaint-repair",
    keywords: ["缺失", "修補", "漏水", "品質不好", "很爛", "不滿意", "客訴", "瑕疵", "裂", "壞掉"]
  },
  {
    key: "schedule-table",
    keywords: ["工期表", "工程表", "排程", "時程", "進度表", "施工表"]
  },
  {
    key: "construction-schedule",
    keywords: ["進場", "退場", "施工", "延期", "改期", "趕工", "木工", "水電", "泥作", "油漆"]
  },
  {
    key: "drawing-file",
    keywords: ["圖面", "施工圖", "設計圖", "cad", "平面圖", "立面圖"]
  },
  {
    key: "invoice",
    keywords: ["發票", "統編", "報帳", "收據"]
  },
  {
    key: "payment",
    keywords: ["請款", "付款", "尾款", "第二期", "第三期", "款項", "匯款"]
  },
  {
    key: "change-request",
    keywords: ["修改", "變更", "改尺寸", "改顏色", "新增", "不要做", "取消"]
  }
];

const INCIDENT_TYPE_PRIORITY: IncidentType[] = [
  "complaint",
  "payment",
  "invoice",
  "change",
  "schedule",
  "file",
  "promise",
  "followup",
  "unknown"
];

export function maxRiskLevel(levels: RiskLevel[], fallback: RiskLevel = "low"): RiskLevel {
  return levels.reduce((current, level) => (RISK_ORDER[level] > RISK_ORDER[current] ? level : current), fallback);
}

export function getPrimaryIncidentType(taskTypes: AiTaskType[]): IncidentType {
  if (!taskTypes.length) return "unknown";

  return (
    INCIDENT_TYPE_PRIORITY.find((candidate) =>
      candidate !== "unknown" ? taskTypes.includes(candidate as AiTaskType) : false
    ) ?? taskTypes[0]
  );
}

export function buildIncidentKey(input: {
  projectId: string;
  groupId: string;
  incidentType: IncidentType;
  title?: string;
  text?: string;
}) {
  const topicKey = getIncidentTopicKey(`${input.title ?? ""}\n${input.text ?? ""}`, input.incidentType);

  return [input.projectId || "no-project", input.groupId || "no-group", input.incidentType, topicKey].join("|");
}

function getIncidentTopicKey(text: string, incidentType: IncidentType) {
  const normalized = text.trim().toLowerCase();
  const matchedRule = TOPIC_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));

  if (matchedRule) return matchedRule.key;

  const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, "");
  if (compact) return compact.slice(0, 36);

  return `${incidentType}-unlabeled`;
}
