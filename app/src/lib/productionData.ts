import { removeScopedStorage } from "./accountScope";
import { loadCalendarState, saveCalendarState } from "./calendar";
import { localStore } from "./localStore";
import { LEGACY_SEED_WELCOME_NOTE_ID, notesStore, SEED_WELCOME_NOTE_ID } from "./notes";
import { workspaceStore } from "./workspaceStore";

const DEMO_MAIL_KEY = "prior.mail.demo.v1";
const DEMO_ID_PREFIX = "dev-seed-";

/**
 * Removes fixtures that may have been created by an earlier local/dev build
 * before a user enters the production workspace. This is intentionally
 * idempotent and only targets known fixture ids; real user data is untouched.
 */
export async function purgeProductionDemoData(): Promise<void> {
  const tasks = await localStore.listAllTasks().catch(() => localStore.listTasks());
  for (const task of tasks.filter((item) => item.id.startsWith(DEMO_ID_PREFIX) && !item.deletedAt)) {
    await localStore.removeTask(task);
  }
  for (const project of workspaceStore.listProjects().filter((item) => item.id.startsWith(DEMO_ID_PREFIX))) {
    workspaceStore.removeProject(project);
  }
  for (const area of workspaceStore.listAreas().filter((item) => item.id.startsWith(DEMO_ID_PREFIX))) {
    workspaceStore.removeArea(area);
  }

  for (const note of notesStore.list()) {
    if (note.id === SEED_WELCOME_NOTE_ID || note.id === LEGACY_SEED_WELCOME_NOTE_ID) notesStore.trash(note.id);
  }
  for (const folder of notesStore.listFolders()) {
    if (folder.workspaceId?.startsWith(DEMO_ID_PREFIX)) notesStore.deleteFolder(folder.id);
  }

  // loadCalendarState sanitizes persisted demo sources in production, and
  // saveCalendarState writes the cleaned account-scoped value back.
  saveCalendarState(loadCalendarState());
  removeScopedStorage(DEMO_MAIL_KEY);
}
