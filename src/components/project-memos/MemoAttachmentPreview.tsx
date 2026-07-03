"use client";

import { ImageIcon } from "lucide-react";
import Image from "next/image";
import type { MessageAttachment } from "@/lib/types";

export function MemoAttachmentPreview({ attachments }: { attachments: MessageAttachment[] }) {
  if (!attachments.length) return null;

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3 lg:w-56">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
        <ImageIcon className="h-3.5 w-3.5 text-teal-700" aria-hidden />
        附件縮圖 {attachments.length} 張
      </div>
      <div className="grid grid-cols-3 gap-2">
        {attachments.slice(0, 6).map((attachment) => (
          <a
            key={attachment.messageId}
            className="block overflow-hidden rounded-md border border-stone-200 bg-white"
            href={attachment.fileUrl}
            target="_blank"
            rel="noreferrer"
            title="開啟附件"
          >
            {attachment.fileType === "image" ? (
              <Image
                className="aspect-square w-full object-cover"
                src={attachment.fileUrl}
                alt="備忘錄附件"
                width={96}
                height={96}
                unoptimized
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-white px-1 text-center text-[10px] font-semibold text-slate-600">
                {attachmentTypeLabel(attachment)}
              </div>
            )}
          </a>
        ))}
      </div>
      {attachments.length > 6 ? <div className="mt-2 text-xs text-slate-500">還有 {attachments.length - 6} 張</div> : null}
    </div>
  );
}

function attachmentTypeLabel(attachment: MessageAttachment) {
  if (attachment.fileType === "audio") return "語音";
  if (attachment.fileType === "file") return "PDF";
  return "圖片";
}
