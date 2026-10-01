import { useMemo, useState } from "react";
import type { AgentMessage } from "../../types";
import { AGENT_MOODS, AgentIdentity, type AgentMood } from "../../components/AgentIdentity";
import { AgentThinking } from "../../components/agent/AgentThinking";
import type { AssistantMessageHandlers } from "../../components/agent/handlers";
import type { ProposalContext } from "../../components/agent/reviewModel";
import {
  AssistantMessage,
  markAreasAdded,
  markFoldersAdded,
  markHabitsAdded,
  markNotesAdded,
  markProjectsAdded,
  markTasksAdded,
  markTaskUpdatesApplied,
  markEntityUpdatesApplied,
  updateAreaProposal,
  updateFolderProposal,
  updateHabitProposal,
  updateNoteProposal,
  updateProjectProposal,
  updateTaskProposal,
  updateTaskUpdateProposal,
  updateEntityUpdateProposal,
} from "../../components/AgentMessageView";
import "../../components/AgentSidebar.css";
import { LabButton, LabDemo, type LabSectionProps } from "../LabKit";
import "./AgentSection.css";

const SAMPLE: AgentMessage = {
  id: "lab-1",
  role: "assistant",
  content: "Here is a plan for the launch week. I **grouped** the work into one project and queued two edits to existing items.\n\n- Ship the beta on Friday\n- Move the invoice follow-up earlier",
  createdAt: new Date().toISOString(),
  proposedProjects: [{ id: "lp1", name: "Beta launch", areaName: "Work", description: "Everything needed to ship the beta to the first 50 testers.", status: "active", projectType: "software", targetDate: "2026-10-16", reasoning: "You mentioned a Friday deadline twice.", selected: true }],
  proposedTasks: [
    { id: "lt1", title: "Write the release notes", description: "Highlights, known issues and a thank-you to early testers.", dueDate: "2026-10-08", priority: 2, important: true, urgent: false, projectName: "Beta launch", status: "next", checklist: ["Draft highlights", "List known issues", "Proofread", "Get sign-off", "Publish"], reminderAt: "2026-10-08T09:00:00", reasoning: "Quick win that unblocks the announcement.", selected: true },
    { id: "lt2", title: "Email the 50 testers", description: "", dueDate: "2026-10-09", priority: 1, important: true, urgent: true, projectName: "Beta launch", assigneeLabel: "Camille", reasoning: "Must go out before the Friday build.", selected: true },
    { id: "lt3", title: "Archive old mockups", description: "", dueDate: null, priority: 4, important: false, urgent: false, areaName: "Work", reasoning: "Low effort cleanup when you have a gap.", selected: false },
  ],
  proposedTaskUpdates: [
    { id: "lu1", taskId: "ext-1", taskTitle: "Send invoice to Acme", changes: { dueDate: "2026-10-05", priority: 1, status: "in_progress", checklist: [{ id: "c1", title: "Check amounts", done: false, position: 0 }, { id: "c2", title: "Attach PDF", done: false, position: 1 }] }, reasoning: "Their payment terms start at the invoice date.", selected: true },
  ],
  proposedUpdates: [
    { id: "le1", kind: "habit", targetId: "ext-h", targetTitle: "Morning run", changes: { interval: 2, unit: "day", important: true }, reasoning: "Every other day fits your calendar better.", selected: true },
  ],
  proposedHabits: [{ id: "lh1", title: "Weekly review", important: true, urgent: false, interval: 1, unit: "week", daysOfWeek: [5], reasoning: "Keeps the plan honest.", selected: true }],
};

const CONTEXT: ProposalContext = {
  tasks: [{ id: "ext-1", title: "Send invoice to Acme", description: "", dueDate: "2026-10-12", priority: 3, important: false, urgent: false, status: "next", completed: false, checklist: [{ id: "c1", title: "Check amounts", done: false, position: 0 }] }],
  projects: [], areas: [], notes: [],
  habits: [{ id: "ext-h", title: "Morning run", important: false, urgent: false, interval: 1, unit: "day" }],
};

const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

function ReviewDemo({ onApplied }: { readonly onApplied: () => void }) {
  const [messages, setMessages] = useState<AgentMessage[]>([SAMPLE]);
  const [adding, setAdding] = useState<Record<string, boolean>>({});

  const handlers = useMemo<AssistantMessageHandlers>(() => {
    const run = async (ids: string[], mark: (set: ReadonlySet<string>) => void) => {
      setAdding((prev) => ({ ...prev, ...Object.fromEntries(ids.map((key) => [key, true])) }));
      await wait(650);
      mark(new Set(ids));
      setAdding((prev) => ({ ...prev, ...Object.fromEntries(ids.map((key) => [key, false])) }));
    };
    const ids = <T extends { id: string; selected: boolean; added?: boolean }>(items: T[]) => items.filter((item) => item.selected && !item.added).map((item) => item.id);
    return {
      addingIds: adding,
      context: CONTEXT,
      onApplied,
      onEditTask: (messageId, taskId, patch) => setMessages((prev) => updateTaskProposal(prev, messageId, taskId, (task) => ({ ...task, ...patch }))),
      onUpdateArea: (m, a, u) => setMessages((prev) => updateAreaProposal(prev, m, a, u)),
      onAddSingleArea: (m, area) => run([area.id], (set) => setMessages((prev) => markAreasAdded(prev, m, set))),
      onAddAllAreas: (m, areas) => run(ids(areas), (set) => setMessages((prev) => markAreasAdded(prev, m, set))),
      onUpdateProject: (m, p, u) => setMessages((prev) => updateProjectProposal(prev, m, p, u)),
      onAddSingleProject: (m, project) => run([project.id], (set) => setMessages((prev) => markProjectsAdded(prev, m, set))),
      onAddAllProjects: (m, projects) => run(ids(projects), (set) => setMessages((prev) => markProjectsAdded(prev, m, set))),
      onToggleTaskSelect: (m, t) => setMessages((prev) => updateTaskProposal(prev, m, t, (task) => ({ ...task, selected: !task.selected }))),
      onToggleTaskImportant: (m, t) => setMessages((prev) => updateTaskProposal(prev, m, t, (task) => ({ ...task, important: !task.important }))),
      onToggleTaskUrgent: (m, t) => setMessages((prev) => updateTaskProposal(prev, m, t, (task) => ({ ...task, urgent: !task.urgent }))),
      onAddSingleTask: (m, task) => run([task.id], (set) => setMessages((prev) => markTasksAdded(prev, m, set))),
      onAddAllTasks: (m, tasks) => run(ids(tasks), (set) => setMessages((prev) => markTasksAdded(prev, m, set))),
      onUpdateTaskUpdate: (m, u, update) => setMessages((prev) => updateTaskUpdateProposal(prev, m, u, update)),
      onApplyTaskUpdate: (m, update) => run([update.id], (set) => setMessages((prev) => markTaskUpdatesApplied(prev, m, set))),
      onApplyAllTaskUpdates: (m, updates) => run(ids(updates), (set) => setMessages((prev) => markTaskUpdatesApplied(prev, m, set))),
      onUpdateEntityUpdate: (m, u, update) => setMessages((prev) => updateEntityUpdateProposal(prev, m, u, update)),
      onApplyEntityUpdate: (m, update) => run([update.id], (set) => setMessages((prev) => markEntityUpdatesApplied(prev, m, set))),
      onApplyAllEntityUpdates: (m, updates) => run(ids(updates), (set) => setMessages((prev) => markEntityUpdatesApplied(prev, m, set))),
      onUpdateHabit: (m, h, u) => setMessages((prev) => updateHabitProposal(prev, m, h, u)),
      onAddSingleHabit: (m, habit) => run([habit.id], (set) => setMessages((prev) => markHabitsAdded(prev, m, set))),
      onAddAllHabits: (m, habits) => run(ids(habits), (set) => setMessages((prev) => markHabitsAdded(prev, m, set))),
      onUpdateNote: (m, n, u) => setMessages((prev) => updateNoteProposal(prev, m, n, u)),
      onAddSingleNote: (m, note) => run([note.id], (set) => setMessages((prev) => markNotesAdded(prev, m, set))),
      onAddAllNotes: (m, notes) => run(ids(notes), (set) => setMessages((prev) => markNotesAdded(prev, m, set))),
      onUpdateFolder: (m, f, u) => setMessages((prev) => updateFolderProposal(prev, m, f, u)),
      onAddSingleFolder: (m, folder) => run([folder.id], (set) => setMessages((prev) => markFoldersAdded(prev, m, set))),
      onAddAllFolders: (m, folders) => run(ids(folders), (set) => setMessages((prev) => markFoldersAdded(prev, m, set))),
    };
  }, [adding, onApplied]);

  return (
    <div className="agent-lab-chat">
      <div className="agent-messages">
        <AssistantMessage message={messages[0]} handlers={handlers} fresh />
      </div>
      <div className="agent-lab-reset"><LabButton onClick={() => { try { localStorage.removeItem("prior.agent.dismissed.v1"); } catch { /* ignore */ } setMessages([{ ...SAMPLE, id: `lab-${Math.random()}` }]); }}>Reset</LabButton></div>
    </div>
  );
}

export function AgentSection({ surface }: LabSectionProps) {
  const [mood, setMood] = useState<AgentMood>("idle");
  const [celebrate, setCelebrate] = useState<AgentMood>("idle");

  return (
    <div className="lab-section-grid agent-lab">
      <LabDemo title="Moods" description="Click a mood to preview it. Idle blinks, glances and breathes on its own." surface={surface} height={300}
        controls={AGENT_MOODS.map((item) => <LabButton key={item} primary={item === mood} onClick={() => setMood(item)}>{item}</LabButton>)}>
        <div className="agent-lab-row">
          <AgentIdentity size="hero" mood={mood} />
          <AgentIdentity size="small" mood={mood} />
          <AgentIdentity size="tiny" mood={mood} />
        </div>
      </LabDemo>
      <LabDemo title="All moods" description="Hero size, side by side." surface={surface} height={200}>
        <div className="agent-lab-grid">
          {AGENT_MOODS.map((item) => (
            <figure key={item}><AgentIdentity size="hero" mood={item} wave={false} /><figcaption>{item}</figcaption></figure>
          ))}
        </div>
      </LabDemo>
      <LabDemo title="Thinking row" description="The status line moves through phases while the request runs." surface={surface} height={200}>
        <div className="agent-lab-chat agent-lab-narrow">
          <div className="agent-messages"><AgentThinking /><AgentThinking mode="working" /></div>
        </div>
      </LabDemo>
      <LabDemo title="Review panel" description="Proposals to add and edit, with diffs, inline edit and Apply all. Applying makes the mascot happy." surface={surface} height={620}>
        <div className="agent-lab-chat agent-lab-wide">
          <div className="agent-lab-mascot"><AgentIdentity size="small" mood={celebrate} /></div>
          <ReviewDemo onApplied={() => { setCelebrate("happy"); window.setTimeout(() => setCelebrate("idle"), 2800); }} />
        </div>
      </LabDemo>
    </div>
  );
}
