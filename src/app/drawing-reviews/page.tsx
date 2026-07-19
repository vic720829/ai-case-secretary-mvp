import { Suspense } from "react";
import { DrawingReviewCenterClient } from "@/components/DrawingReviewCenterClient";
import { LoadingState } from "@/components/Ui";

export default function DrawingReviewsPage() {
  return (
    <Suspense fallback={<LoadingState label="正在開啟審圖中心" />}>
      <DrawingReviewCenterClient />
    </Suspense>
  );
}
