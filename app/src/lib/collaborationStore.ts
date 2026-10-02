import type { CollaborationInvite, CollaborationMember, CollaborationProject } from "./api";
import { api } from "./api";
import { readScopedStorage, writeScopedStorage } from "./accountScope";
import type { Project } from "../types";
import { normalizeProjectPlanning, withNormalizedMethodology } from "./projectPlanning";

const KEY = "prior.collaboration.projects.v1";
const CHANGE_EVENT = "prior-collaboration-change";

export type CachedCollaborationProject = CollaborationProject;

function read(): CachedCollaborationProject[] {
  try {
    const value = readScopedStorage(KEY);
    return value ? JSON.parse(value) as CachedCollaborationProject[] : [];
  } catch {
    return [];
  }
}

function write(projects: CachedCollaborationProject[]): void {
  writeScopedStorage(KEY, JSON.stringify(projects));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function normalizeProject(project: Project): Project {
  const planning = normalizeProjectPlanning(project);
  // Same rule as the personal workspace: the server sends null for projects
  // saved before the type was synced, which are standard projects.
  const projectType = project.projectType === "software" || (project.cycles?.length ?? 0) > 0 ? "software" as const : "standard" as const;
  return { ...withNormalizedMethodology(project), ...planning, projectType, areaId: project.areaId ?? null, description: project.description ?? "", icon: project.icon || "folder", status: project.status ?? "active", deletedAt: project.deletedAt ?? null };
}

function normalizeProjects(incoming: CachedCollaborationProject[]): CachedCollaborationProject[] {
  return incoming.map((item) => ({ ...item, project: normalizeProject(item.project) })).filter((item) => !item.project.deletedAt);
}

export const collaborationStore = {
  list(): CachedCollaborationProject[] {
    return read().filter((item) => !item.project.deletedAt);
  },
  listProjects(): Project[] {
    return this.list().map((item) => normalizeProject(item.project));
  },
  get(projectId: string): CachedCollaborationProject | undefined {
    return this.list().find((item) => item.project.id === projectId);
  },
  members(projectId: string): CollaborationMember[] {
    return this.get(projectId)?.members ?? [];
  },
  invites(projectId: string): CollaborationInvite[] {
    return this.get(projectId)?.pendingInvites ?? [];
  },
  role(projectId: string): CachedCollaborationProject["role"] | undefined {
    return this.get(projectId)?.role;
  },
  /** Whether other people can access the project, so it lives on the server. */
  isShared(projectId: string): boolean {
    const entry = this.get(projectId);
    if (!entry) return false;
    return entry.role !== "owner" || entry.members.some((member) => member.role !== "owner") || (entry.pendingInvites?.length ?? 0) > 0;
  },
  merge(incoming: CachedCollaborationProject[]): void {
    write(normalizeProjects(incoming));
  },
  /**
   * Applies a local change to one project entry right away (optimistic UI).
   * The next sync replaces it with the server's copy either way.
   */
  update(projectId: string, change: (entry: CachedCollaborationProject) => CachedCollaborationProject): void {
    const current = read();
    if (!current.some((item) => item.project.id === projectId)) return;
    write(current.map((item) => item.project.id === projectId ? change(item) : item));
  },
  remove(projectId: string): void {
    write(read().filter((item) => item.project.id !== projectId));
  },
  async sync(token: string): Promise<{ changed: boolean; projects: CachedCollaborationProject[] }> {
    const response = await api.listCollaborativeProjects(token);
    const projects = normalizeProjects(response.projects);
    const previous = read();
    const changed = JSON.stringify(previous) !== JSON.stringify(projects);
    if (changed) write(projects);
    return { changed, projects };
  },
  subscribe(listener: () => void): () => void {
    const handler = () => listener();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  },
};
