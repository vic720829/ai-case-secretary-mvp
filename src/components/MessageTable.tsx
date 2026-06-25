import Link from "next/link";
import { formatDateTime } from "@/lib/date";
import type { LineGroup, LineSenderRole, Message, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MessageTable({
  messages,
  projects,
  lineGroups
}: {
  messages: Message[];
  projects: Project[];
  lineGroups: LineGroup[];
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const groupById = new Map(lineGroups.map((group) => [group.groupId, group]));

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-4 py-3">時間</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">群組</th>
              <th className="px-4 py-3">傳送者</th>
              <th className="px-4 py-3">對話內容</th>
              <th className="px-4 py-3">狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {messages.map((message) => {
              const project = projectById.get(message.projectId);
              const group = groupById.get(message.groupId);

              return (
                <tr key={message.id} className="hover:bg-stone-50">
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                    {formatDateTime(message.timestamp)}
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {project ? (
                      <Link className="font-medium hover:text-teal-700" href={`/projects/${project.id}/messages`}>
                        {project.name}
                      </Link>
                    ) : (
                      "未綁定"
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-700">{group?.groupName || "未知群組"}</div>
                    <div className="mt-1 max-w-48 truncate text-xs text-slate-500">{message.groupId}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    <div>{message.senderName || message.senderId || "未知"}</div>
                    <div className="mt-1 text-xs text-slate-500">{getSenderRoleLabel(message.senderRole)}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-md text-slate-800">
                      <MessageContent message={message} />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={cn(
                        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
                        message.isProcessed
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-amber-50 text-amber-700 ring-amber-200"
                      )}
                    >
                      {message.isProcessed ? "已處理" : "未處理"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getSenderRoleLabel(role: LineSenderRole) {
  return {
    internal: "內部人員",
    client: "客戶",
    vendor: "廠商",
    unknown: "身份未登記"
  }[role];
}

function MessageContent({ message }: { message: Message }) {
  if (message.text) return message.text;

  if (message.fileUrl) {
    return (
      <a
        className="font-medium text-teal-700 hover:text-teal-800"
        href={message.fileUrl}
        target="_blank"
        rel="noreferrer"
      >
        {message.messageType === "image" ? "查看圖片" : "播放語音"}
      </a>
    );
  }

  return `[${message.messageType}]`;
}
