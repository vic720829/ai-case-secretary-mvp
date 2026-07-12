import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebaseAdmin";
import { createReminderKey } from "../lib/reminders";
import type { LineSenderRole } from "../lib/types";
import { listAdminNotificationGroups } from "./lineAdminGroups";
import { pushLineMessages, type LinePushMessage } from "./line";
import { claimNotificationCooldown } from "./notificationCooldown";

type ProjectSummary = {
  name: string;
  clientName: string;
};

type MessageRow = {
  id: string;
  projectId: string;
  groupId: string;
  senderName: string;
  senderRole: LineSenderRole;
  messageType: string;
  text: string;
  timestamp: Date | null;
};

type UnansweredCandidate = MessageRow & {
  eligibleAt: Date;
  unansweredCount: number;
  latestText: string;
};

export async function sendCustomerUnansweredReminders() {
  const now = new Date();
  if (!shouldCheckNow(now)) {
    return { ok: true, checked: 0, notified: 0, sent: 0, failed: 0, reason: "Outside reminder window" };
  }

  const db = getAdminDb();
  const [projects, messages] = await Promise.all([loadProjects(db), loadRecentMessages(db, now)]);
  const candidates = findUnansweredCandidates(messages, now);
  const adminGroups = candidates.length ? await listAdminNotificationGroups(db, "daily") : [];

  if (!candidates.length) {
    return { ok: true, checked: messages.length, notified: 0, sent: 0, failed: 0 };
  }

  if (!adminGroups.length) {
    return { ok: true, checked: messages.length, notified: 0, sent: 0, failed: 0, reason: "No admin LINE groups configured" };
  }

  const today = taipeiDateString(now);
  const notifyItems: UnansweredCandidate[] = [];

  for (const candidate of candidates) {
    const key = createReminderKey("message", candidate.id, "customer_message_unanswered");
    const reminderRef = db.collection("reminder_logs").doc(key);
    const snapshot = await reminderRef.get();
    const existing = snapshot.exists ? snapshot.data() ?? {} : {};

    if (existing.status === "confirmed") continue;
    if (String(existing.lastUnansweredNotifiedOn ?? "") === today) continue;

    await reminderRef.set(
      {
        key,
        sourceType: "message",
        sourceId: candidate.id,
        reminderType: "customer_message_unanswered",
        projectId: candidate.projectId,
        groupId: candidate.groupId,
        sourceLabel: "客戶訊息未回覆",
        title: getMessageTitle(candidate),
        dueDate: taipeiDateString(candidate.eligibleAt),
        status: "pending",
        priority: "normal",
        firstTriggeredOn: existing.firstTriggeredOn ?? today,
        lastRemindedOn: today,
        lastUnansweredNotifiedOn: today,
        sourceSenderName: candidate.senderName,
        sourceSenderRole: candidate.senderRole,
        unansweredCount: candidate.unansweredCount,
        latestText: candidate.latestText,
        eligibleAt: Timestamp.fromDate(candidate.eligibleAt),
        lastAction: "customer_unanswered_notified",
        createdAt: existing.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const canSend = await claimNotificationCooldown(db, {
      projectId: candidate.projectId,
      notificationType: `customer_unanswered_${candidate.groupId}`,
      cooldownMinutes: 60,
      title: getMessageTitle(candidate)
    });

    if (!canSend) continue;
    notifyItems.push(candidate);
  }

  if (!notifyItems.length) {
    return { ok: true, checked: messages.length, notified: 0, sent: 0, failed: 0, reason: "No new reminders after cooldown" };
  }

  const lineMessages = buildUnansweredReminderMessages(notifyItems, projects);
  const results = await Promise.allSettled(adminGroups.map((group) => pushLineMessages(group.groupId, lineMessages)));

  return {
    ok: true,
    checked: messages.length,
    notified: notifyItems.length,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    groups: adminGroups.length
  };
}

async function loadProjects(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection("projects").get();
  const projects = new Map<string, ProjectSummary>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    projects.set(doc.id, {
      name: String(data.name ?? "未命名案件"),
      clientName: String(data.clientName ?? "")
    });
  });

  return projects;
}

async function loadRecentMessages(db: FirebaseFirestore.Firestore, now: Date): Promise<MessageRow[]> {
  const sinceDate = datePlusDays(taipeiDateString(now), -2);
  const since = taipeiDateTime(sinceDate, 0, 0);
  const snapshot = await db.collection("messages").where("timestamp", ">=", Timestamp.fromDate(since)).get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        projectId: String(data.projectId ?? ""),
        groupId: String(data.groupId ?? ""),
        senderName: String(data.senderName ?? ""),
        senderRole: normalizeSenderRole(String(data.senderRole ?? "unknown")),
        messageType: String(data.messageType ?? "text"),
        text: String(data.text ?? ""),
        timestamp: timestampToDate(data.timestamp) ?? timestampToDate(data.createdAt)
      };
    })
    .filter((message) => message.projectId && message.groupId && Boolean(message.timestamp))
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));
}

function findUnansweredCandidates(messages: MessageRow[], now: Date): UnansweredCandidate[] {
  const eligibleMessages = messages
    .filter((message) => isCustomerLikeRole(message.senderRole))
    .map((message) => ({ message, eligibleAt: getEligibleReminderAt(message.timestamp!) }))
    .filter((item) => item.eligibleAt.getTime() <= now.getTime())
    .filter((item) => !hasInternalReplyAfter(messages, item.message));

  const grouped = new Map<string, Array<{ message: MessageRow; eligibleAt: Date }>>();

  eligibleMessages.forEach((item) => {
    const key = `${item.message.projectId}:${item.message.groupId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });

  return [...grouped.values()]
    .map((items) => {
      const sorted = items.sort((a, b) => a.eligibleAt.getTime() - b.eligibleAt.getTime());
      const first = sorted[0];
      const latest = sorted[sorted.length - 1]?.message;

      return {
        ...first.message,
        eligibleAt: first.eligibleAt,
        unansweredCount: sorted.length,
        latestText: latest ? messagePreview(latest) : ""
      };
    })
    .sort((a, b) => a.eligibleAt.getTime() - b.eligibleAt.getTime())
    .slice(0, 12);
}

function buildUnansweredReminderMessages(
  items: UnansweredCandidate[],
  projects: Map<string, ProjectSummary>
): LinePushMessage[] {
  const siteUrl = getSiteUrl();
  const lines = items.slice(0, 8).map((item) => {
    const project = projectName(projects.get(item.projectId));
    const count = item.unansweredCount > 1 ? `（同案尚有 ${item.unansweredCount} 則未回）` : "";
    return `- [${project}] ${getMessageTitle(item)}${count}`;
  });
  const hiddenCount = items.length - lines.length;
  const text = [
    "AI案件秘書｜客戶訊息待回覆",
    "",
    "以下客戶群訊息已到提醒時間，且尚未看到內部人員回覆：",
    ...lines,
    hiddenCount > 0 ? `- 另有 ${hiddenCount} 組` : "",
    "",
    "若已處理，請在後台群按「已回覆」。"
  ]
    .filter(Boolean)
    .join("\n");

  const actionMessages = items.slice(0, 4).flatMap((item) => buildUnansweredActionMessage(item, projects, siteUrl));

  return [{ type: "text" as const, text: truncate(text, 4800) }, ...actionMessages].slice(0, 5);
}

function buildUnansweredActionMessage(
  item: UnansweredCandidate,
  projects: Map<string, ProjectSummary>,
  siteUrl: string
): LinePushMessage[] {
  const key = encodeURIComponent(createReminderKey("message", item.id, "customer_message_unanswered"));
  const actions: Extract<LinePushMessage, { type: "template" }>["template"]["actions"] = [
    {
      type: "postback",
      label: "已回覆",
      data: `action=confirm_reminder&key=${key}`,
      displayText: truncate(`已回覆：${getMessageTitle(item)}`, 300)
    },
    {
      type: "postback",
      label: "明天追蹤",
      data: `action=snooze_reminder&key=${key}&days=1`,
      displayText: truncate(`明天追蹤：${getMessageTitle(item)}`, 300)
    }
  ];

  if (siteUrl) {
    actions.push({
      type: "uri",
      label: "打開對話",
      uri: `${siteUrl}/projects/${encodeURIComponent(item.projectId)}/messages`
    });
  }

  return [
    {
      type: "template",
      altText: truncate(`客戶訊息待回覆：${getMessageTitle(item)}`, 400),
      template: {
        type: "buttons",
        title: "客戶訊息待回覆",
        text: truncate(`[${projectName(projects.get(item.projectId))}] ${getMessageTitle(item)}`, 160),
        actions
      }
    }
  ];
}

function hasInternalReplyAfter(messages: MessageRow[], message: MessageRow) {
  const messageTime = message.timestamp?.getTime() ?? 0;
  if (!messageTime) return false;

  return messages.some((candidate) => {
    if (candidate.groupId !== message.groupId) return false;
    if (candidate.projectId !== message.projectId) return false;
    if (candidate.senderRole !== "internal") return false;
    const candidateTime = candidate.timestamp?.getTime() ?? 0;
    return candidateTime > messageTime;
  });
}

function getEligibleReminderAt(messageDate: Date) {
  const messageParts = taipeiParts(messageDate);
  const messageDateString = taipeiDateString(messageDate);

  if (messageParts.hour < 9) return taipeiDateTime(messageDateString, 10, 0);
  if (messageParts.hour >= 21) return taipeiDateTime(datePlusDays(messageDateString, 1), 10, 0);

  const eligibleAt = new Date(messageDate.getTime() + 3 * 60 * 60 * 1000);
  const eligibleParts = taipeiParts(eligibleAt);
  const isAfterReminderWindow =
    eligibleParts.date !== messageDateString ||
    eligibleParts.hour > 21 ||
    (eligibleParts.hour === 21 && eligibleParts.minute > 0);

  return isAfterReminderWindow ? taipeiDateTime(datePlusDays(messageDateString, 1), 10, 0) : eligibleAt;
}

function shouldCheckNow(now: Date) {
  const parts = taipeiParts(now);
  if (parts.hour < 10) return false;
  if (parts.hour > 21) return false;
  if (parts.hour === 21 && parts.minute > 0) return false;
  return true;
}

function getMessageTitle(message: MessageRow) {
  return truncate(messagePreview(message), 48);
}

function messagePreview(message: MessageRow) {
  const text = message.text.trim();
  if (text) return text;
  if (message.messageType === "image") return "圖片訊息";
  if (message.messageType === "audio") return "語音訊息";
  return "LINE 訊息";
}

function projectName(project?: ProjectSummary) {
  if (!project) return "未綁定案件";
  return project.clientName ? `${project.name} / ${project.clientName}` : project.name;
}

function normalizeSenderRole(role: string): LineSenderRole {
  if (role === "internal" || role === "client" || role === "vendor") return role;
  return "unknown";
}

function isCustomerLikeRole(role: LineSenderRole) {
  return role === "client" || role === "unknown";
}

function timestampToDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function taipeiParts(date: Date) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute
  };
}

function taipeiDateString(date = new Date()) {
  return taipeiParts(date).date;
}

function taipeiDateTime(dateString: string, hour: number, minute: number) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateString}T${hh}:${mm}:00+08:00`);
}

function datePlusDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function getSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || "";
  return value.replace(/\/$/, "");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
