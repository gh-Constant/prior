import type { Area, Project, ProjectStatus } from "../types";

const AREAS_KEY = "prior.areas.v1";
const PROJECTS_KEY = "prior.projects.v1";
const CHANGE_EVENT = "prior-workspace-change";

const AREA_COLORS = ["#c96551", "#6b8fb3", "#7c9b70", "#b38b54", "#8b73a8", "#8b8a84"];

function uid(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): string { return new Date().toISOString(); }

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function normalizeArea(area: Area): Area {
  return { ...area, color: area.color || AREA_COLORS[0], deletedAt: area.deletedAt ?? null };
}

function normalizeProject(project: Project): Project {
  const status: ProjectStatus = ["planned", "active", "paused", "completed"].includes(project.status) ? project.status : "active";
  return { ...project, areaId: project.areaId ?? null, description: project.description ?? "", status, deletedAt: project.deletedAt ?? null };
}

export const workspaceStore = {
  listAreas(): Area[] {
    return read<Area[]>(AREAS_KEY, []).filter((area) => !area.deletedAt).map(normalizeArea).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  listProjects(): Project[] {
    return read<Project[]>(PROJECTS_KEY, []).filter((project) => !project.deletedAt).map(normalizeProject).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  },
  createArea(name: string, color?: string): Area {
    const timestamp = now();
    const areas = this.listAreas();
    const area: Area = { id: uid(), name: name.trim() || "New area", color: color || AREA_COLORS[areas.length % AREA_COLORS.length], createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    write(AREAS_KEY, [...read<Area[]>(AREAS_KEY, []), area]);
    return area;
  },
  updateArea(area: Area): Area {
    const saved = { ...normalizeArea(area), name: area.name.trim() || "New area", updatedAt: now(), deletedAt: null };
    write(AREAS_KEY, read<Area[]>(AREAS_KEY, []).map((item) => item.id === area.id ? saved : item));
    return saved;
  },
  removeArea(area: Area): void {
    const timestamp = now();
    write(AREAS_KEY, read<Area[]>(AREAS_KEY, []).map((item) => item.id === area.id ? { ...item, deletedAt: timestamp, updatedAt: timestamp } : item));
    write(PROJECTS_KEY, read<Project[]>(PROJECTS_KEY, []).map((project) => project.areaId === area.id ? { ...project, areaId: null, updatedAt: timestamp } : project));
  },
  createProject(name: string, areaId: string | null = null, description = ""): Project {
    const timestamp = now();
    const project: Project = { id: uid(), areaId, name: name.trim() || "New project", description: description.trim(), status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    write(PROJECTS_KEY, [...read<Project[]>(PROJECTS_KEY, []), project]);
    return project;
  },
  updateProject(project: Project): Project {
    const saved = { ...normalizeProject(project), name: project.name.trim() || "New project", updatedAt: now(), deletedAt: null };
    write(PROJECTS_KEY, read<Project[]>(PROJECTS_KEY, []).map((item) => item.id === project.id ? saved : item));
    return saved;
  },
  removeProject(project: Project): void {
    const timestamp = now();
    write(PROJECTS_KEY, read<Project[]>(PROJECTS_KEY, []).map((item) => item.id === project.id ? { ...item, deletedAt: timestamp, updatedAt: timestamp } : item));
  },
  subscribe(callback: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, callback);
    window.addEventListener("storage", callback);
    return () => { window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener("storage", callback); };
  },
};

export { AREA_COLORS };
