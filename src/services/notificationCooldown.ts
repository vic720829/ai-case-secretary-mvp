import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export async function claimNotificationCooldown(
  db: FirebaseFirestore.Firestore,
  input: {
    projectId: string;
    notificationType: string;
    cooldownMinutes: number;
    title?: string;
  }
) {
  const key = createCooldownKey(input.projectId, input.notificationType);
  const ref = db.collection("notification_cooldowns").doc(key);
  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() ?? {} : {};
  const lastSentAt = timestampToMillis(data.lastSentAt);
  const now = Date.now();

  if (lastSentAt && now - lastSentAt < input.cooldownMinutes * 60 * 1000) {
    return false;
  }

  await ref.set(
    {
      projectId: input.projectId,
      notificationType: input.notificationType,
      title: input.title ?? "",
      cooldownMinutes: input.cooldownMinutes,
      lastSentAt: FieldValue.serverTimestamp(),
      sentCount: FieldValue.increment(1),
      createdAt: data.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return true;
}

function createCooldownKey(projectId: string, notificationType: string) {
  const raw = `${projectId || "no-project"}|${notificationType || "unknown"}`;
  return createHash("sha1").update(raw).digest("hex");
}

function timestampToMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  return 0;
}
