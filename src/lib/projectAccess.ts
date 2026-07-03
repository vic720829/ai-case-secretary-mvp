import type { Project, UserProfile, UserRole } from "./types";

export function hasFullProjectAccess(role: UserRole | "" | undefined) {
  return role === "owner" || role === "admin" || role === "manager";
}

export function canManageProjectMembers(role: UserRole | "" | undefined) {
  return hasFullProjectAccess(role);
}

export function canAccessProject(profile: Pick<UserProfile, "id" | "role"> | null | undefined, project: Project | null | undefined) {
  if (!profile || !project) return false;
  if (hasFullProjectAccess(profile.role)) return true;

  return project.memberUserIds.includes(profile.id);
}

export function filterAccessibleProjects(projects: Project[], profile: Pick<UserProfile, "id" | "role"> | null | undefined) {
  if (!profile) return [];
  if (hasFullProjectAccess(profile.role)) return projects;

  return projects.filter((project) => project.memberUserIds.includes(profile.id));
}

export function getAccessibleProjectIds(projects: Project[], profile: Pick<UserProfile, "id" | "role"> | null | undefined) {
  return filterAccessibleProjects(projects, profile).map((project) => project.id);
}
