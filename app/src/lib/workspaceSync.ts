import { api } from "./api";
import { notesStore } from "./notes";
import { workspaceStore } from "./workspaceStore";
import { isValidUuid } from "./uuid";

let applyingRemote = false;

export const workspaceSync = {
  isApplyingRemote(): boolean {
    return applyingRemote;
  },

  async sync(token: string, isCurrent: () => boolean = () => true): Promise<void> {
    const local = workspaceStore.exportAll();
    const notes = notesStore.exportAll();

    // Ensure only valid UUIDs are sent to server so snapshot validation never fails
    const payload = {
      areas: local.areas.filter((area) => isValidUuid(area.id)),
      projects: local.projects
        .filter((project) => isValidUuid(project.id))
        .map((p) => ({
          ...p,
          areaId: isValidUuid(p.areaId) ? p.areaId : null,
        })),
      folders: notes.folders.filter((folder) => isValidUuid(folder.id)),
      notes: notes.notes
        .filter((note) => isValidUuid(note.id))
        .map((n) => ({
          ...n,
          folderId: isValidUuid(n.folderId) ? n.folderId : null,
          projectId: isValidUuid(n.projectId) ? n.projectId : null,
        })),
    };

    const merged = await api.syncWorkspace(payload, token);
    if (!isCurrent()) return;
    applyingRemote = true;
    try {
      notesStore.mergeRemote({ notes: merged.notes, folders: merged.folders });
      // Apply folders before areas/projects. Workspace rendering ensures the
      // corresponding category folders exist; applying them first prevents a
      // second local folder from being created for an already-synced area.
      workspaceStore.mergeRemote({ areas: merged.areas, projects: merged.projects });
    } finally {
      applyingRemote = false;
    }
  },
};
