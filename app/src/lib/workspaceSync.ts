import { api } from "./api";
import { notesStore } from "./notes";
import { workspaceStore } from "./workspaceStore";

let applyingRemote = false;

export const workspaceSync = {
  isApplyingRemote(): boolean {
    return applyingRemote;
  },

  async sync(token: string, isCurrent: () => boolean = () => true): Promise<void> {
    const local = workspaceStore.exportAll();
    const notes = notesStore.exportAll();
    const merged = await api.syncWorkspace({ ...local, ...notes }, token);
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
