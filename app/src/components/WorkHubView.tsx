import { useMemo, useState, type ReactNode } from "react";
import type { Area, Project, ProjectStatus, Task, TaskDraft } from "../types";
import { notesStore } from "../lib/notes";
import { mergeAssignedProjectTasks } from "../lib/projectTasks";
import { workspaceStore } from "../lib/workspaceStore";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";
import { Modal } from "./Modal";
import { ProjectCollaboration } from "./collaboration/ProjectCollaboration";
import type { ProjectCollaborationProps } from "./collaboration/types";
import { AREA_ICON_OPTIONS, DEFAULT_AREA_ICON, DEFAULT_PROJECT_ICON, PROJECT_ICON_OPTIONS, WorkspaceIcon } from "./WorkspaceIcon";
import { IconPicker, IconUpload } from "./IconPicker";
import "./WorkHubView.css";

export type WorkHubViewKind = "today" | "inbox" | "projects" | "project" | "waiting";

type Props = {
  readonly view: WorkHubViewKind;
  readonly tasks: Task[];
  readonly areas: Area[];
  readonly projects: Project[];
  readonly selectedProjectId: string | null;
  readonly onOpenProject: (projectId: string) => void;
  readonly onOpenNotes: (projectId?: string) => void;
  readonly onOpenWaiting: () => void;
  readonly onNewTask: (context?: Pick<TaskDraft, "areaId" | "projectId" | "status">) => void;
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskDelete: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
  readonly onWorkspaceChange: () => void;
  /** Opt-in presentation data; absent projects keep the existing personal UI. */
  readonly collaborationByProject?: Readonly<Record<string, Omit<ProjectCollaborationProps, "project">>>;
  /** Current user id used to keep assigned project issues in All/Today. */
  readonly currentUserId?: string | null;
};

type WorkspaceModal =
  | { kind: "project"; areaId: string | null; project?: Project }
  | { kind: "area"; area?: Area }
  | { kind: "confirm-area-delete"; area: Area }
  | { kind: "confirm-project-delete"; project: Project }
  | null;

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskScore(task: Task, today: string): number {
  if (task.completed || task.status === "waiting") return -1;
  let score = 0;
  if (task.dueDate && task.dueDate <= today) score += task.dueDate < today ? 1000 : 850;
  if (task.scheduledDate === today) score += 700;
  if (task.status === "in_progress") score += 300;
  if (task.status === "next") score += 220;
  if (task.important) score += 100;
  if (task.urgent) score += 80;
  score += (5 - (task.priority ?? 4)) * 12;
  return score;
}

function sortTasks(tasks: Task[], today = dateKey()): Task[] {
  return [...tasks].sort((left, right) => taskScore(right, today) - taskScore(left, today) || right.updatedAt.localeCompare(left.updatedAt));
}

function WorkspaceItemModal({ modal, areas, onClose, onSave }: { modal: Exclude<WorkspaceModal, null> & ({ kind: "project" } | { kind: "area" }); areas: Area[]; onClose: () => void; onSave: (name: string, areaId: string | null, icon: string) => void }) {
  const isProject = modal.kind === "project";
  const [name, setName] = useState(isProject ? modal.project?.name ?? "" : modal.area?.name ?? "");
  const [areaId, setAreaId] = useState(isProject ? modal.areaId ?? "" : "");
  const [icon, setIcon] = useState(isProject ? modal.project?.icon || DEFAULT_PROJECT_ICON : modal.area?.icon || DEFAULT_AREA_ICON);
  const [uploading, setUploading] = useState(false);
  const iconOptions = isProject ? PROJECT_ICON_OPTIONS : AREA_ICON_OPTIONS;
  const fallback = isProject ? DEFAULT_PROJECT_ICON : DEFAULT_AREA_ICON;
  const editing = isProject ? Boolean(modal.project) : Boolean(modal.area);

  return (
    <Modal title={`${editing ? "Edit" : "New"} ${isProject ? "project" : "area"}`} onClose={onClose}>
      <form className="prior-modal-form workspace-item-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim(), isProject ? areaId || null : null, icon); }}>
        <label className="prior-modal-field">
          <span>Name</span>
          <input className="prior-modal-input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={isProject ? "e.g. Launch website" : "e.g. Work"} maxLength={80} />
        </label>
        {isProject && (
        <label className="prior-modal-field">
          <span>Area</span>
          <select
            className="prior-modal-select"
            value={areaId}
            onChange={(event) => setAreaId(event.target.value)}
          >
            <option value="">No area</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        )}
        <div className="prior-modal-field">
          <span>Icon</span>
          <div className="workspace-icon-picker">
            <IconPicker value={icon} options={iconOptions} fallback={fallback} label={isProject ? "Project icon" : "Area icon"} disabled={uploading} onSelect={(next) => setIcon(next)} />
            <IconUpload currentIcon={icon} fallback={fallback} disabled={uploading} onBusyChange={setUploading} onUploaded={(next) => setIcon(next)} />
          </div>
          <small className="workspace-icon-help">Choose a simple icon or upload a square image. Older {isProject ? "projects" : "areas"} use the default icon automatically.</small>
        </div>
        <div className="prior-modal-actions">
          <button type="button" className="prior-modal-button-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="prior-modal-button-primary" disabled={!name.trim() || uploading}>{editing ? "Save changes" : `Create ${isProject ? "project" : "area"}`}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmAreaDeleteModal({ area, onClose, onConfirm }: { area: Area; onClose: () => void; onConfirm: () => void }) {
  const projectCount = workspaceStore.listProjects().filter((project) => project.areaId === area.id).length;
  return <Modal title={`Delete “${area.name}”?`} onClose={onClose}>
    <div className="prior-modal-body">
      <p className="workspace-delete-message">The area will be removed. Its {projectCount === 1 ? "project stays in your workspace" : "projects stay in your workspace"} and move to <strong>No area</strong>.</p>
      <div className="prior-modal-actions">
        <button type="button" className="prior-modal-button-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="workspace-delete-button" onClick={onConfirm}>Delete area</button>
      </div>
    </div>
  </Modal>;
}

function ConfirmProjectDeleteModal({ project, onClose, onConfirm }: { project: Project; onClose: () => void; onConfirm: () => void }) {
  return <Modal title={`Delete “${project.name}”?`} onClose={onClose}>
    <div className="prior-modal-body">
      <p className="workspace-delete-message">The project will be removed. Its tasks stay in your workspace and remain available from <strong>All tasks</strong>.</p>
      <div className="prior-modal-actions">
        <button type="button" className="prior-modal-button-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="workspace-delete-button" onClick={onConfirm}>Delete project</button>
      </div>
    </div>
  </Modal>;
}

function ProjectList({ areas, projects, query, onQueryChange, onOpenProject, onNewProject, onNewArea, onEditArea, onDeleteArea, onEditProject, onDeleteProject }: { areas: Area[]; projects: Project[]; query: string; onQueryChange: (value: string) => void; onOpenProject: (id: string) => void; onNewProject: (areaId?: string | null) => void; onNewArea: () => void; onEditArea: (area: Area) => void; onDeleteArea: (area: Area) => void; onEditProject: (project: Project) => void; onDeleteProject: (project: Project) => void }) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const filtered = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()) || project.description.toLowerCase().includes(query.toLowerCase()));
  const byArea = (areaId: string | null) => filtered.filter((project) => project.areaId === areaId);
  return <section className="workhub-projects-view" aria-label="Projects">
    <div className="workhub-intro"><div><p className="eyebrow">ORGANIZE YOUR WORK</p><h2>Projects</h2><p>Keep each outcome focused, then let the tasks flow into Today.</p></div><div className="workhub-intro-actions"><button type="button" className="secondary-button workhub-new-area" onClick={onNewArea}><Icon name="folder-plus" /><span>New area</span></button><button type="button" className="primary-button" onClick={() => onNewProject()}><Icon name="plus" />New project</button></div></div>
    <label className="workhub-search"><Icon name="search" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Find a project" aria-label="Find a project" /></label>
    <div className="workhub-project-groups">
      {[...areas.map((area) => ({ id: area.id, label: area.name, color: area.color, icon: area.icon, area })), { id: "__none__", label: "No area", color: "#9a9d91", icon: DEFAULT_PROJECT_ICON, area: undefined }].map((group) => {
        const groupProjects = byArea(group.id === "__none__" ? null : group.id);
        if (!groupProjects.length && query) return null;
        return <section className="workhub-project-group" key={group.id}>
          <div
            className="workhub-group-heading"
            onContextMenu={group.area ? (event) => openMenu(event, [
              { icon: "plus", label: `New project in ${group.area!.name}`, run: () => onNewProject(group.area!.id) },
              { icon: "pencil", label: `Edit area ${group.area!.name}`, run: () => onEditArea(group.area!) },
              { icon: "trash", label: `Delete area ${group.area!.name}`, danger: true, run: () => onDeleteArea(group.area!) },
            ]) : undefined}
            {...(group.area ? longPress(() => [
              { icon: "plus", label: `New project in ${group.area!.name}`, run: () => onNewProject(group.area!.id) },
              { icon: "pencil", label: `Edit area ${group.area!.name}`, run: () => onEditArea(group.area!) },
              { icon: "trash", label: `Delete area ${group.area!.name}`, danger: true, run: () => onDeleteArea(group.area!) },
            ]) : {})}
          ><span className="workhub-group-icon" style={{ color: group.color }}><WorkspaceIcon icon={group.icon} fallback={group.id === "__none__" ? DEFAULT_PROJECT_ICON : DEFAULT_AREA_ICON} /></span><h3>{group.label}</h3><span className="workhub-count">{groupProjects.length}</span><div className="workhub-group-actions"><button type="button" className="text-button" onClick={() => onNewProject(group.id === "__none__" ? null : group.id)}><Icon name="plus" />Project</button>{group.area && <><button type="button" className="workhub-icon-action" aria-label={`Edit area ${group.area.name}`} title="Edit area" onClick={() => onEditArea(group.area!)}><Icon name="pencil" /></button><button type="button" className="workhub-icon-action danger" aria-label={`Delete area ${group.area.name}`} title="Delete area" onClick={() => onDeleteArea(group.area!)}><Icon name="trash" /></button></>}</div></div>
          {groupProjects.length ? <div className="workhub-project-list">{groupProjects.map((project) => <div
            className="workhub-project-card"
            key={project.id}
            onContextMenu={(event) => openMenu(event, [
              { icon: "arrow", label: `Open ${project.name}`, run: () => onOpenProject(project.id) },
              { icon: "pencil", label: `Edit ${project.name}`, run: () => onEditProject(project) },
              { icon: "trash", label: `Delete ${project.name}`, danger: true, run: () => onDeleteProject(project) },
            ])}
            {...longPress(() => [
              { icon: "arrow", label: `Open ${project.name}`, run: () => onOpenProject(project.id) },
              { icon: "pencil", label: `Edit ${project.name}`, run: () => onEditProject(project) },
              { icon: "trash", label: `Delete ${project.name}`, danger: true, run: () => onDeleteProject(project) },
            ])}
          ><button type="button" className="workhub-project-card-main" onClick={() => onOpenProject(project.id)}><span className="workhub-project-icon"><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /></span><span className="workhub-project-card-copy"><strong>{project.name}</strong>{project.description && <small>{project.description}</small>}</span><span className={`project-status status-${project.status}`}>{PROJECT_STATUS_LABELS[project.status]}</span><Icon name="chevron-right" /></button><button type="button" className="workhub-icon-action project-edit-action" aria-label={`Edit project ${project.name}`} title="Edit project" onClick={() => onEditProject(project)}><Icon name="pencil" /></button></div>)}</div> : <button type="button" className="workhub-empty-inline" onClick={() => onNewProject(group.id === "__none__" ? null : group.id)}>Create your first project in {group.label}</button>}
        </section>;
      })}
      {!filtered.length && <div className="workhub-empty-state"><div className="workhub-empty-mark"><Icon name="folder" /></div><h3>{query ? "No matching projects" : "Your projects will live here"}</h3><p>{query ? "Try a different search." : "Start with one outcome you want to move forward."}</p>{!query && <button type="button" className="primary-button" onClick={() => onNewProject()}><Icon name="plus" />New project</button>}</div>}
    </div>
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}

function ProjectDetail({ project, area, tasks, onBack, onOpenNotes, onNewTask, onTaskChange, onTaskDelete, onTaskEdit, onWorkspaceChange, onEditProject, onDeleteProject }: { project: Project; area?: Area; tasks: Task[]; onBack: () => void; onOpenNotes: (id: string) => void; onNewTask: (context: Pick<TaskDraft, "areaId" | "projectId" | "status">) => void; onTaskChange: (task: Task) => Promise<void>; onTaskDelete: (task: Task) => Promise<void>; onTaskEdit: (task: Task) => void; onWorkspaceChange: () => void; onEditProject: (project: Project) => void; onDeleteProject: (project: Project) => void }) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const [tab, setTab] = useState<"tasks" | "notes">("tasks");
  const [notes, setNotes] = useState(() => notesStore.list().filter((note) => note.projectId === project.id));
  const completed = tasks.filter((task) => task.completed).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const createNote = () => {
    const note = notesStore.create("Untitled project note", null, project.id);
    setNotes(notesStore.list().filter((item) => item.projectId === project.id));
    onOpenNotes(project.id);
    void note;
  };
  function changeStatus(status: ProjectStatus): void {
    workspaceStore.updateProject({ ...project, status });
    onWorkspaceChange();
  }
  return <section className="workhub-project-detail" aria-label={project.name}>
    <button type="button" className="back-link" onClick={onBack}><Icon name="chevron-left" />All projects</button>
    <div
      className="project-detail-header"
      onContextMenu={(event) => openMenu(event, [
        { icon: "pencil", label: `Edit ${project.name}`, run: () => onEditProject(project) },
        { icon: "plus", label: "New task in this project", run: () => onNewTask({ areaId: project.areaId, projectId: project.id, status: "next" }) },
        { icon: "trash", label: `Delete ${project.name}`, danger: true, run: () => onDeleteProject(project) },
      ])}
      {...longPress(() => [
        { icon: "pencil", label: `Edit ${project.name}`, run: () => onEditProject(project) },
        { icon: "plus", label: "New task in this project", run: () => onNewTask({ areaId: project.areaId, projectId: project.id, status: "next" }) },
        { icon: "trash", label: `Delete ${project.name}`, danger: true, run: () => onDeleteProject(project) },
      ])}
    ><div className="project-detail-heading"><div className="project-detail-title-row"><span className="project-detail-icon"><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /></span><div><div className="project-detail-kicker">{area?.name ?? "No area"}</div><h2>{project.name}</h2></div></div>{project.description && <p>{project.description}</p>}</div><div className="project-detail-actions"><button type="button" className="secondary-button project-edit-button" onClick={() => onEditProject(project)}><Icon name="pencil" />Edit project</button><select aria-label="Project status" value={project.status} onChange={(event) => changeStatus(event.target.value as ProjectStatus)}>{Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="primary-button" onClick={() => onNewTask({ areaId: project.areaId, projectId: project.id, status: "next" })}><Icon name="plus" />New task</button></div></div>
    <div className="project-progress"><div><span>{completed} of {tasks.length} tasks complete</span><strong>{progress}%</strong></div><div className="project-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
    <div className="workhub-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>Tasks <span>{tasks.filter((task) => !task.completed).length}</span></button><button type="button" role="tab" aria-selected={tab === "notes"} className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>Notes <span>{notes.length}</span></button></div>
    {tab === "tasks" ? <div className="project-task-list">{tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} project={project} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />) : <div className="workhub-empty-state compact"><Icon name="check-circle" /><h3>No tasks in this project</h3><p>Make the next step concrete and add it here.</p><button type="button" className="primary-button" onClick={() => onNewTask({ areaId: project.areaId, projectId: project.id, status: "next" })}><Icon name="plus" />Add next task</button></div>}</div> : <div className="project-notes-panel"><div className="project-notes-heading"><div><p className="eyebrow">PROJECT NOTES</p><h3>Keep the context close to the work</h3></div><button type="button" className="primary-button" onClick={createNote}><Icon name="file-plus" />New note</button></div>{notes.length ? <div className="project-note-list">{notes.map((note) => <button type="button" className="project-note-card" key={note.id} onClick={() => onOpenNotes(project.id)}><Icon name="file-text" /><span><strong>{note.title}</strong><small>{note.body.replace(/\s+/g, " ").trim().slice(0, 120) || "Empty note"}</small></span><Icon name="chevron-right" /></button>)}</div> : <div className="workhub-empty-state compact"><Icon name="file-text" /><h3>No project notes yet</h3><p>Capture decisions, research, or the project brief without leaving the project.</p><button type="button" className="primary-button" onClick={createNote}><Icon name="file-plus" />Create note</button></div>}<button type="button" className="secondary-button project-open-notes" onClick={() => onOpenNotes(project.id)}>Open project notes</button></div>}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}

export function WorkHubView({ view, tasks, areas, projects, selectedProjectId, onOpenProject, onOpenNotes, onOpenWaiting, onNewTask, onTaskChange, onTaskDelete, onTaskEdit, onWorkspaceChange, collaborationByProject, currentUserId = null }: Props) {
  const [projectQuery, setProjectQuery] = useState("");
  const [modal, setModal] = useState<WorkspaceModal>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  // All/Today pool: keep every task plus any assigned project issue that only
  // exists in the collaboration workspace (deduped by id). Inbox/Waiting keep
  // their existing filters below, so their logic is unchanged.
  const mergedTasks = useMemo(() => mergeAssignedProjectTasks(tasks, collaborationByProject, currentUserId), [tasks, collaborationByProject, currentUserId]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const projectFor = (task: Task) => task.projectId ? projectById.get(task.projectId) ?? null : null;
  const projectTasks = selectedProject ? mergedTasks.filter((task) => task.projectId === selectedProject.id) : [];
  const today = dateKey();
  const waitingTasks = mergedTasks.filter((task) => !task.completed && (task.status === "waiting" || Boolean(task.assigneeName)));
  const inboxTasks = mergedTasks.filter((task) => !task.completed && task.status === "inbox");
  const rankedTasks = useMemo(() => sortTasks(mergedTasks.filter((task) => !task.completed)), [mergedTasks]);
  const nowTasks = rankedTasks.filter((task) => taskScore(task, today) >= 700).slice(0, 3);
  const nextTasks = rankedTasks.filter((task) => !nowTasks.some((item) => item.id === task.id) && taskScore(task, today) >= 0).slice(0, 8);
  const areaForProject = (project: Project) => areas.find((area) => area.id === project.areaId);
  const collaboration = selectedProject ? collaborationByProject?.[selectedProject.id] : undefined;

  if (view === "project" && selectedProject && collaboration) return <div className="workhub-project-detail">
    <button type="button" className="back-link" onClick={() => onOpenProject("")}><Icon name="chevron-left" />All projects</button>
    <ProjectCollaboration key={selectedProject.id} {...collaboration} project={selectedProject} />
  </div>;

  function saveModal(name: string, areaId: string | null, icon: string): void {
    if (modal?.kind === "area") {
      if (modal.area) workspaceStore.updateArea({ ...modal.area, name, icon });
      else workspaceStore.createArea(name, undefined, icon);
    } else if (modal?.kind === "project") {
      if (modal.project) workspaceStore.updateProject({ ...modal.project, name, areaId, icon });
      else workspaceStore.createProject(name, areaId, "", icon);
    }
    setModal(null);
    onWorkspaceChange();
  }

  function deleteProject(project: Project): void {
    workspaceStore.removeProject(project);
    setModal(null);
    if (project.id === selectedProjectId) onOpenProject("");
    onWorkspaceChange();
  }

  function deleteModal(modalState: Exclude<WorkspaceModal, null>): ReactNode {
    if (modalState.kind === "confirm-area-delete") return <ConfirmAreaDeleteModal area={modalState.area} onClose={() => setModal(null)} onConfirm={() => { workspaceStore.removeArea(modalState.area); setModal(null); onWorkspaceChange(); }} />;
    if (modalState.kind === "confirm-project-delete") return <ConfirmProjectDeleteModal project={modalState.project} onClose={() => setModal(null)} onConfirm={() => deleteProject(modalState.project)} />;
    return <WorkspaceItemModal modal={modalState} areas={areas} onClose={() => setModal(null)} onSave={saveModal} />;
  }

  if (view === "projects") return <><ProjectList areas={areas} projects={projects} query={projectQuery} onQueryChange={setProjectQuery} onOpenProject={onOpenProject} onNewProject={(areaId) => setModal({ kind: "project", areaId: areaId ?? null })} onNewArea={() => setModal({ kind: "area" })} onEditArea={(area) => setModal({ kind: "area", area })} onDeleteArea={(area) => setModal({ kind: "confirm-area-delete", area })} onEditProject={(project) => setModal({ kind: "project", areaId: project.areaId, project })} onDeleteProject={(project) => setModal({ kind: "confirm-project-delete", project })} />{modal && deleteModal(modal)}</>;
  if (view === "project") return selectedProject ? <><ProjectDetail project={selectedProject} area={areaForProject(selectedProject)} tasks={projectTasks} onBack={() => onOpenProject("")} onOpenNotes={onOpenNotes} onNewTask={onNewTask} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} onWorkspaceChange={onWorkspaceChange} onEditProject={(project) => setModal({ kind: "project", areaId: project.areaId, project })} onDeleteProject={(project) => setModal({ kind: "confirm-project-delete", project })} />{modal && deleteModal(modal)}</> : <div className="workhub-empty-state"><Icon name="folder" /><h3>Project not found</h3><button type="button" className="secondary-button" onClick={() => onOpenProject("")}>Back to projects</button></div>;
  if (view === "waiting") return <TaskCollection title="Waiting and delegated" eyebrow="CLEAR THE LOOP" description="Keep work that depends on someone else out of your active list." tasks={waitingTasks} projects={projects} empty="Nothing is waiting on anyone." actionLabel="Capture waiting work" onAction={() => onNewTask({ status: "waiting" })} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} />;
  if (view === "inbox") return <TaskCollection title="Inbox" eyebrow="CAPTURE FIRST, ORGANIZE LATER" description="A quiet holding place for tasks you have not clarified yet." tasks={inboxTasks} projects={projects} empty="Your inbox is clear." actionLabel="Capture task" onAction={() => onNewTask({ status: "inbox" })} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} />;
  return <section className="today-view" aria-label="Today"><div className="workhub-intro today-intro"><div><p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</p><h2>What deserves your attention?</h2><p>A short list for moving the important work forward.</p></div><button type="button" className="primary-button" onClick={() => onNewTask()}><Icon name="plus" />Capture task</button></div><div className="today-grid"><section className="today-section now-section"><div className="today-section-heading"><div><span className="section-kicker">NOW</span><h3>Start here</h3></div><span className="today-count">{nowTasks.length}</span></div>{nowTasks.length ? nowTasks.map((task) => <TaskRow key={task.id} task={task} project={projectFor(task)} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />) : <div className="today-empty"><Icon name="check-circle" /><strong>Nothing urgent is pulling you forward.</strong><span>Choose a next action below or capture something new.</span></div>}</section><section className="today-section next-section"><div className="today-section-heading"><div><span className="section-kicker">NEXT</span><h3>Keep moving</h3></div><span className="today-count">{nextTasks.length}</span></div>{nextTasks.length ? nextTasks.map((task) => <TaskRow key={task.id} task={task} project={projectFor(task)} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />) : <div className="today-empty"><Icon name="arrow" /><strong>Your next list is open.</strong><span>Use Inbox to capture the next thing that comes to mind.</span></div>}</section></div>{waitingTasks.length > 0 && <button type="button" className="today-waiting-banner" onClick={onOpenWaiting}><span><Icon name="later" /><strong>{waitingTasks.length} item{waitingTasks.length > 1 ? "s" : ""} waiting on someone else</strong></span><Icon name="chevron-right" /></button>}</section>;
}

function TaskCollection({ title, eyebrow, description, tasks, projects, empty, actionLabel, onAction, onTaskChange, onTaskDelete, onTaskEdit }: { title: string; eyebrow: string; description: string; tasks: Task[]; projects: Project[]; empty: string; actionLabel: string; onAction: () => void; onTaskChange: (task: Task) => Promise<void>; onTaskDelete: (task: Task) => Promise<void>; onTaskEdit: (task: Task) => void }) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return <section className="task-collection"><div className="workhub-intro"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div><button type="button" className="primary-button" onClick={onAction}><Icon name="plus" />{actionLabel}</button></div>{tasks.length ? <div className="task-collection-list">{tasks.map((task) => <TaskRow key={task.id} task={task} project={task.projectId ? projectById.get(task.projectId) ?? null : null} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}</div> : <div className="workhub-empty-state"><Icon name="check-circle" /><h3>{empty}</h3><button type="button" className="primary-button" onClick={onAction}><Icon name="plus" />{actionLabel}</button></div>}</section>;
}
