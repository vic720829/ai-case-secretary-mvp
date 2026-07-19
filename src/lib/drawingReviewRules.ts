export const DRAWING_REVIEW_RULE_SET_VERSION = "company-v1.0";

export type DrawingReviewRule = {
  code: string;
  title: string;
  check: string;
  severity: "fatal" | "warning" | "insufficient";
};

export const drawingReviewRules: DrawingReviewRule[] = [
  { code: "DESK-HEIGHT-001", title: "書桌完成面高度", check: "不得低於 760 mm", severity: "fatal" },
  { code: "DESK-DEPTH-001", title: "書桌深度", check: "不得小於 600 mm", severity: "fatal" },
  { code: "WARDROBE-HINGED-001", title: "對開門衣櫃深度", check: "不得小於 600 mm", severity: "fatal" },
  { code: "WARDROBE-SLIDING-001", title: "滑門衣櫃深度", check: "不得小於 650 mm", severity: "fatal" },
  { code: "SHOE-CABINET-001", title: "鞋櫃深度", check: "低於 350 mm 時確認斜板或特殊收納方式", severity: "warning" },
  { code: "WOOD-FLOOR-001", title: "木地板扣高", check: "有木地板及落地櫃時確認櫃高已扣除地板厚度", severity: "warning" },
  { code: "DIMENSION-CHAIN-001", title: "尺寸鏈加總", check: "分尺寸加總必須等於總尺寸", severity: "fatal" },
  { code: "PLAN-ELEVATION-001", title: "平立面尺寸一致", check: "同一櫃體的平面與立面尺寸必須一致", severity: "fatal" },
  { code: "PANEL-THICKNESS-001", title: "板厚與收邊", check: "板厚、終端板與收邊板不得漏入尺寸鏈", severity: "warning" },
  { code: "KEY-DIMENSION-001", title: "關鍵尺寸完整性", check: "關鍵尺寸缺漏或無法辨識時列為人工確認", severity: "insufficient" }
];
