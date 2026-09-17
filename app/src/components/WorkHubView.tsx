import { useMemo, useState } from "react";
import type { Area, Project, ProjectStatus, Task, TaskDraft } from "../types";
import { notesStore } from "../lib/notes";
import { workspaceStore } from "../lib/workspaceStore";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";
import { SimpleFormModal } from "./Modal";
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
};

type ProjectModal = { kind: "project"; areaId: string | null } | { kind: "area" } | null;

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

function ProjectModalView({ modal, areas, onClose, onSave }: { modal: Exclude<ProjectModal, null>; areas: Area[]; onClose: () => void; onSave: (name: string, areaId: string | null) => void }) {
  const [name, setName] = useState("");
  const [areaId, setAreaId] = useState(modal.kind === "project" ? modal.areaId ?? "" : "");
  const isProject = modal.kind === "project";

  return (
    <SimpleFormModal
      title={isProject ? "New project" : "New area"}
      submitLabel={isProject ? "Create project" : "Create area"}
      name={name}
      onNameChange={setName}
      namePlaceholder={isProject ? "e.g. Launch website" : "e.g. Work"}
      nameLabel="Name"
      onClose={onClose}
      onSubmit={() => onSave(name.trim(), isProject ? areaId || null : null)}
    >
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
    </SimpleFormModal>
  );
}

function ProjectList({ areas, projects, query, onQueryChange, onOpenProject, onNewProject, onNewArea }: { areas: Area[]; projects: Project[]; query: string; onQueryChange: (value: string) => void; onOpenProject: (id: string) => void; onNewProject: (areaId?: string | null) => void; onNewArea: () => void }) {
  const filtered = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()) || project.description.toLowerCase().includes(query.toLowerCase()));
  const byArea = (areaId: string | null) => filtered.filter((project) => project.areaId === areaId);
  return <section className="workhub-projects-view" aria-label="Projects">
    <div className="workhub-intro"><div><p className="eyebrow">ORGANIZE YOUR WORK</p><h2>Projects</h2><p>Keep each outcome focused, then let the tasks flow into Today.</p></div><div className="workhub-intro-actions"><button type="button" className="secondary-button" onClick={onNewArea}><Icon name="folder-plus" />New area</button><button type="button" className="primary-button" onClick={() => onNewProject()}><Icon name="plus" />New project</button></div></div>
    <label className="workhub-search"><Icon name="search" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Find a project" aria-label="Find a project" /></label>
    <div className="workhub-project-groups">
      {[...areas.map((area) => ({ id: area.id, label: area.name, color: area.color })), { id: "__none__", label: "No area", color: "#9a9d91" }].map((group) => {
        const groupProjects = byArea(group.id === "__none__" ? null : group.id);
        if (!groupProjects.length && query) return null;
        return <section className="workhub-project-group" key={group.id}>
          <div className="workhub-group-heading"><span className="workhub-area-dot" style={{ background: group.color }} /><h3>{group.label}</h3><span className="workhub-count">{groupProjects.length}</span><button type="button" className="text-button" onClick={() => onNewProject(group.id === "__none__" ? null : group.id)}><Icon name="plus" />Project</button></div>
          {groupProjects.length ? <div className="workhub-project-list">{groupProjects.map((project) => <button type="button" className="workhub-project-card" key={project.id} onClick={() => onOpenProject(project.id)}><span className="workhub-project-card-main"><strong>{project.name}</strong>{project.description && <small>{project.description}</small>}</span><span className={`project-status status-${project.status}`}>{PROJECT_STATUS_LABELS[project.status]}</span><Icon name="chevron-right" /></button>)}</div> : <button type="button" className="workhub-empty-inline" onClick={() => onNewProject(group.id === "__none__" ? null : group.id)}>Create your first project in {group.label}</button>}
        </section>;
      })}
      {!filtered.length && <div className="workhub-empty-state"><div className="workhub-empty-mark"><Icon name="folder" /></div><h3>{query ? "No matching projects" : "Your projects will live here"}</h3><p>{query ? "Try a different search." : "Start with one outcome you want to move forward."}</p>{!query && <button type="button" className="primary-button" onClick={() => onNewProject()}><Icon name="plus" />New project</button>}</div>}
    </div>
  </section>;
}

function ProjectDetail({ project, area, tasks, onBack, onOpenNotes, onNewTask, onTaskChange, onTaskDelete, onTaskEdit, onWorkspaceChange }: { project: Project; area?: Area; tasks: Task[]; onBack: () => void; onOpenNotes: (id: string) => void; onNewTask: (context: Pick<TaskDraft, "areaId" | "projectId" | "status">) => void; onTaskChange: (task: Task) => Promise<void>; onTaskDelete: (task: Task) => Promise<void>; onTaskEdit: (task: Task) => void; onWorkspaceChange: () => void }) {
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
    <div className="project-detail-header"><div className="project-detail-heading"><div className="project-detail-kicker">{area?.name ?? "No area"}</div><h2>{project.name}</h2>{project.description && <p>{project.description}</p>}</div><div className="project-detail-actions"><select aria-label="Project status" value={project.status} onChange={(event) => changeStatus(event.target.value as ProjectStatus)}>{Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="primary-button" onClick={() => onNewTask({ areaId: project.areaId, projectId: project.id, status: "next" })}><Icon name="plus" />New task</button></div></div>
    <div className="project-progress"><div><span>{completed} of {tasks.length} tasks complete</span><strong>{progress}%</strong></div><div className="project-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
    <div className="workhub-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>Tasks <span>{tasks.filter((task) => !task.completed).length}</span></button><button type="button" role="tab" aria-selected={tab === "notes"} className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>Notes <span>{notes.length}</span></button></div>
    {tab === "tasks" ? <div className="project-task-list">{tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />) : <div className="workhub-empty-state compact"><Icon name="check-circle" /><h3>No tasks in this project</h3><p>Make the next step concrete and add it here.</p><button type="button" className="primary-button" onClick={() => onNewTask({ areaId: project.areaId, projectId: project.id, status: "next" })}><Icon name="plus" />Add next task</button></div>}</div> : <div className="project-notes-panel"><div className="project-notes-heading"><div><p className="eyebrow">PROJECT NOTES</p><h3>Keep the context close to the work</h3></div><button type="button" className="primary-button" onClick={createNote}><Icon name="file-plus" />New note</button></div>{notes.length ? <div className="project-note-list">{notes.map((note) => <button type="button" className="project-note-card" key={note.id} onClick={() => onOpenNotes(project.id)}><Icon name="file-text" /><span><strong>{note.title}</strong><small>{note.body.replace(/\s+/g, " ").trim().slice(0, 120) || "Empty note"}</small></span><Icon name="chevron-right" /></button>)}</div> : <div className="workhub-empty-state compact"><Icon name="file-text" /><h3>No project notes yet</h3><p>Capture decisions, research, or the project brief without leaving the project.</p><button type="button" className="primary-button" onClick={createNote}><Icon name="file-plus" />Create note</button></div>}<button type="button" className="secondary-button project-open-notes" onClick={() => onOpenNotes(project.id)}>Open project notes</button></div>}
  </section>;
}

export function WorkHubView({ view, tasks, areas, projects, selectedProjectId, onOpenProject, onOpenNotes, onOpenWaiting, onNewTask, onTaskChange, onTaskDelete, onTaskEdit, onWorkspaceChange }: Props) {
  const [projectQuery, setProjectQuery] = useState("");
  const [modal, setModal] = useState<ProjectModal>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const projectTasks = selectedProject ? tasks.filter((task) => task.projectId === selectedProject.id) : [];
  const today = dateKey();
  const waitingTasks = tasks.filter((task) => !task.completed && (task.status === "waiting" || Boolean(task.assigneeName)));
  const inboxTasks = tasks.filter((task) => !task.completed && task.status === "inbox");
  const rankedTasks = useMemo(() => sortTasks(tasks.filter((task) => !task.completed)), [tasks]);
  const nowTasks = rankedTasks.filter((task) => taskScore(task, today) >= 700).slice(0, 3);
  const nextTasks = rankedTasks.filter((task) => !nowTasks.some((item) => item.id === task.id) && taskScore(task, today) >= 0).slice(0, 8);
  const areaForProject = (project: Project) => areas.find((area) => area.id === project.areaId);

  function saveModal(name: string, areaId: string | null): void {
    if (modal?.kind === "area") workspaceStore.createArea(name);
    else workspaceStore.createProject(name, areaId);
    setModal(null);
    onWorkspaceChange();
  }

  if (view === "projects") return <><ProjectList areas={areas} projects={projects} query={projectQuery} onQueryChange={setProjectQuery} onOpenProject={onOpenProject} onNewProject={(areaId) => setModal({ kind: "project", areaId: areaId ?? null })} onNewArea={() => setModal({ kind: "area" })} />{modal && <ProjectModalView modal={modal} areas={areas} onClose={() => setModal(null)} onSave={saveModal} />}</>;
  if (view === "project") return selectedProject ? <ProjectDetail project={selectedProject} area={areaForProject(selectedProject)} tasks={projectTasks} onBack={() => onOpenProject("")} onOpenNotes={onOpenNotes} onNewTask={onNewTask} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} onWorkspaceChange={onWorkspaceChange} /> : <div className="workhub-empty-state"><Icon name="folder" /><h3>Project not found</h3><button type="button" className="secondary-button" onClick={() => onOpenProject("")}>Back to projects</button></div>;
  if (view === "waiting") return <TaskCollection title="Waiting and delegated" eyebrow="CLEAR THE LOOP" description="Keep work that depends on someone else out of your active list." tasks={waitingTasks} empty="Nothing is waiting on anyone." actionLabel="Capture waiting work" onAction={() => onNewTask({ status: "waiting" })} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} />;
  if (view === "inbox") return <TaskCollection title="Inbox" eyebrow="CAPTURE FIRST, ORGANIZE LATER" description="A quiet holding place for tasks you have not clarified yet." tasks={inboxTasks} empty="Your inbox is clear." actionLabel="Capture task" onAction={() => onNewTask({ status: "inbox" })} onTaskChange={onTaskChange} onTaskDelete={onTaskDelete} onTaskEdit={onTaskEdit} />;
  return <section className="today-view" aria-label="Today"><div className="workhub-intro today-intro"><div><p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</p><h2>What deserves your attention?</h2><p>A short list for moving the important work forward.</p></div><button type="button" className="primary-button" onClick={() => onNewTask()}><Icon name="plus" />Capture task</button></div><div className="today-grid"><section className="today-section now-section"><div className="today-section-heading"><div><span className="section-kicker">NOW</span><h3>Start here</h3></div><span className="today-count">{nowTasks.length}</span></div>{nowTasks.length ? nowTasks.map((task) => <TaskRow key={task.id} task={task} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />) : <div className="today-empty"><Icon name="check-circle" /><strong>Nothing urgent is pulling you forward.</strong><span>Choose a next action below or capture something new.</span></div>}</section><section className="today-section next-section"><div className="today-section-heading"><div><span className="section-kicker">NEXT</span><h3>Keep moving</h3></div><span className="today-count">{nextTasks.length}</span></div>{nextTasks.length ? nextTasks.map((task) => <TaskRow key={task.id} task={task} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />) : <div className="today-empty"><Icon name="arrow" /><strong>Your next list is open.</strong><span>Use Inbox to capture the next thing that comes to mind.</span></div>}</section></div>{waitingTasks.length > 0 && <button type="button" className="today-waiting-banner" onClick={onOpenWaiting}><span><Icon name="later" /><strong>{waitingTasks.length} item{waitingTasks.length > 1 ? "s" : ""} waiting on someone else</strong></span><Icon name="chevron-right" /></button>}</section>;
}

function TaskCollection({ title, eyebrow, description, tasks, empty, actionLabel, onAction, onTaskChange, onTaskDelete, onTaskEdit }: { title: string; eyebrow: string; description: string; tasks: Task[]; empty: string; actionLabel: string; onAction: () => void; onTaskChange: (task: Task) => Promise<void>; onTaskDelete: (task: Task) => Promise<void>; onTaskEdit: (task: Task) => void }) {
  return <section className="task-collection"><div className="workhub-intro"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div><button type="button" className="primary-button" onClick={onAction}><Icon name="plus" />{actionLabel}</button></div>{tasks.length ? <div className="task-collection-list">{tasks.map((task) => <TaskRow key={task.id} task={task} onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}</div> : <div className="workhub-empty-state"><Icon name="check-circle" /><h3>{empty}</h3><button type="button" className="primary-button" onClick={onAction}><Icon name="plus" />{actionLabel}</button></div>}</section>;
}
