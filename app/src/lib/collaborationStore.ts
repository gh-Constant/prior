import type { CollaborationInvite, CollaborationMember, CollaborationProject } from "./api";
import { api } from "./api";
import { readScopedStorage, writeScopedStorage } from "./accountScope";
import type { Project } from "../types";

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
  return { ...project, areaId: project.areaId ?? null, description: project.description ?? "", icon: project.icon || "folder", status: project.status ?? "active", deletedAt: project.deletedAt ?? null };
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
  merge(incoming: CachedCollaborationProject[]): void {
    write(normalizeProjects(incoming));
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
