import type { User } from "firebase/auth";
import type { AuditActor } from "./types";

export function toAuditActor(user: User | null): AuditActor | null {
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? ""
  };
}
