"use client";

import { useId } from "react";
import { commonStageNames } from "@/lib/stageNames";

export function StageNameInput({
  value,
  onChange,
  className,
  placeholder = "選擇常用工種或自行輸入",
  required = false
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  required?: boolean;
}) {
  const listId = useId();

  return (
    <>
      <input
        className={className}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
      <datalist id={listId}>
        {commonStageNames.map((stageName) => (
          <option key={stageName} value={stageName} />
        ))}
      </datalist>
    </>
  );
}
