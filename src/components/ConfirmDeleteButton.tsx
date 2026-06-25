"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "./Ui";

export function ConfirmDeleteButton({
  label = "刪除",
  confirmMessage,
  onConfirm
}: {
  label?: string;
  confirmMessage: string;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    if (!window.confirm(confirmMessage)) return;
    setSubmitting(true);

    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button type="button" variant="danger" onClick={handleClick} disabled={submitting}>
      <Trash2 className="h-4 w-4" aria-hidden />
      {submitting ? "刪除中" : label}
    </Button>
  );
}
