import type { LineNotificationLevel } from "../lib/types";

export type AdminNotificationAudience = "primary" | "daily" | "critical";

export type AdminNotificationGroup = {
  groupId: string;
  groupName: string;
  notificationLevel: LineNotificationLevel;
};

export async function listAdminNotificationGroups(
  db: FirebaseFirestore.Firestore,
  audience: AdminNotificationAudience
): Promise<AdminNotificationGroup[]> {
  const snapshot = await db.collection("line_groups").where("groupType", "==", "admin").get();

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((group) => group.allowAssistantReplies !== false)
    .map((group) => ({
      groupId: String(group.groupId ?? ""),
      groupName: String(group.groupName ?? ""),
      notificationLevel: normalizeAdminNotificationLevel(group.notificationLevel)
    }))
    .filter((group) => group.groupId && canReceiveAdminNotification(group.notificationLevel, audience));
}

export function canReceiveAdminNotification(
  level: LineNotificationLevel,
  audience: AdminNotificationAudience
) {
  if (level === "none" || level === "test") return false;
  if (audience === "critical") return level === "primary" || level === "secondary" || level === "critical_only";
  if (audience === "daily") return level === "primary" || level === "secondary";

  return level === "primary";
}

export function normalizeAdminNotificationLevel(value: unknown): LineNotificationLevel {
  return value === "primary" ||
    value === "secondary" ||
    value === "critical_only" ||
    value === "test" ||
    value === "none"
    ? value
    : "primary";
}
