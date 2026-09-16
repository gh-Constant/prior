import type { AgentMessage, Habit, ProposedHabit, ProposedTask, QuadrantKey, Task, TaskDraft } from "../types";
import { quadrantFor } from "../lib/priority";
import { habitScheduleLabel } from "../lib/habits";
import { AgentIdentity } from "./AgentIdentity";
import { Icon } from "./Icon";

export function getQuadrantBadge(task: Pick<Task, "important" | "urgent">): { key: QuadrantKey; label: string } {
  const key = quadrantFor(task);
  switch (key) {
    case "focus":
      return { key, label: "Focus (Do First)" };
    case "plan":
      return { key, label: "Plan (Schedule)" };
    case "quick":
      return { key, label: "Quick (Delegate)" };
    case "later":
      return { key, label: "Later (Eliminate)" };
  }
}

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function updateTaskProposal(messages: AgentMessage[], messageId: string, taskId: string, update: (task: ProposedTask) => ProposedTask): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedTasks) return msg;
    return { ...msg, proposedTasks: msg.proposedTasks.map((task) => task.id === taskId ? update(task) : task) };
  });
}

export function markTasksAdded(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedTasks) return msg;
    return { ...msg, proposedTasks: msg.proposedTasks.map((task) => ids.has(task.id) ? { ...task, added: true } : task) };
  });
}

export function updateHabitProposal(messages: AgentMessage[], messageId: string, habitId: string, update: Partial<ProposedHabit>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedHabits) return message;
    return { ...message, proposedHabits: message.proposedHabits.map((habit) => habit.id === habitId ? { ...habit, ...update } : habit) };
  });
}

export function markHabitsAdded(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedHabits) return message;
    return { ...message, proposedHabits: message.proposedHabits.map((habit) => ids.has(habit.id) ? { ...habit, added: true } : habit) };
  });
}

export function taskDraftOf(task: ProposedTask): TaskDraft {
  return { title: task.title, description: task.description, dueDate: task.dueDate, priority: task.priority, important: task.important, urgent: task.urgent };
}

export function habitDraftOf(habit: ProposedHabit): Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit"> {
  return { title: habit.title, important: habit.important, urgent: habit.urgent, interval: habit.interval, unit: habit.unit };
}

type FlagTogglesProps = {
  readonly important: boolean | undefined;
  readonly urgent: boolean | undefined;
  readonly disabled: boolean | undefined;
  readonly importantLabel: readonly [string, string];
  readonly urgentLabel: readonly [string, string];
  readonly onToggleImportant: () => void;
  readonly onToggleUrgent: () => void;
};

function FlagToggles({ important, urgent, disabled, importantLabel, urgentLabel, onToggleImportant, onToggleUrgent }: FlagTogglesProps) {
  return (
    <div className="proposed-toggles">
      <button
        type="button"
        className={`task-action flag-toggle ${important ? "active important" : ""}`}
        aria-label={important ? importantLabel[0] : importantLabel[1]}
        aria-pressed={important}
        title={important ? importantLabel[0] : importantLabel[1]}
        disabled={disabled}
        onClick={onToggleImportant}
      >
        <Icon name="star" />
      </button>
      <button
        type="button"
        className={`task-action flag-toggle ${urgent ? "active urgent" : ""}`}
        aria-label={urgent ? urgentLabel[0] : urgentLabel[1]}
        aria-pressed={urgent}
        title={urgent ? urgentLabel[0] : urgentLabel[1]}
        disabled={disabled}
        onClick={onToggleUrgent}
      >
        <Icon name="bolt" />
      </button>
    </div>
  );
}

type ProposedTaskCardProps = {
  readonly messageId: string;
  readonly task: ProposedTask;
  readonly adding: boolean;
  readonly onToggleSelect: (messageId: string, taskId: string) => void;
  readonly onToggleImportant: (messageId: string, taskId: string) => void;
  readonly onToggleUrgent: (messageId: string, taskId: string) => void;
  readonly onAdd: (messageId: string, task: ProposedTask) => void;
};

export function ProposedTaskCard({ messageId, task, adding, onToggleSelect, onToggleImportant, onToggleUrgent, onAdd }: ProposedTaskCardProps) {
  const badge = getQuadrantBadge(task);
  const priority = task.priority ?? 4;
  return (
    <div className={`proposed-task-item ${task.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={task.selected}
            disabled={task.added}
            onChange={() => onToggleSelect(messageId, task.id)}
          />
          <span className="proposed-task-title">{task.title}</span>
        </label>
        {task.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> Added
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd(messageId, task)}
            title="Add task to Prior"
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      {task.description && <p className="proposed-description">{task.description}</p>}
      <div className="proposed-task-meta">
        <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
          {badge.label}
        </span>
        <span className={`proposed-priority proposed-priority-${priority}`}>P{priority}</span>
        {task.dueDate && <span className="proposed-due-date">Due {formatDueDate(task.dueDate)}</span>}
        <FlagToggles
          important={task.important}
          urgent={task.urgent}
          disabled={task.added}
          importantLabel={["Remove important flag", "Mark important"]}
          urgentLabel={["Remove urgent flag", "Mark urgent"]}
          onToggleImportant={() => onToggleImportant(messageId, task.id)}
          onToggleUrgent={() => onToggleUrgent(messageId, task.id)}
        />
      </div>
      {task.reasoning && <p className="proposed-reasoning">{task.reasoning}</p>}
    </div>
  );
}

type TaskProposalBoxProps = {
  readonly messageId: string;
  readonly tasks: readonly ProposedTask[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onToggleSelect: (messageId: string, taskId: string) => void;
  readonly onToggleImportant: (messageId: string, taskId: string) => void;
  readonly onToggleUrgent: (messageId: string, taskId: string) => void;
  readonly onAddSingle: (messageId: string, task: ProposedTask) => void;
  readonly onAddAll: (messageId: string, tasks: ProposedTask[]) => void;
};

export function TaskProposalBox({ messageId, tasks, addingIds, onToggleSelect, onToggleImportant, onToggleUrgent, onAddSingle, onAddAll }: TaskProposalBoxProps) {
  if (tasks.length === 0) return null;
  const addedCount = tasks.filter((task) => task.added).length;
  return (
    <div className="proposed-tasks-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{addedCount}/{tasks.length} added</span>
        {tasks.some((task) => !task.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll(messageId, [...tasks])}>
            <Icon name="plus" />
            <span>Add all to Prior</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {tasks.map((task) => (
          <ProposedTaskCard
            key={task.id}
            messageId={messageId}
            task={task}
            adding={addingIds[task.id] ?? false}
            onToggleSelect={onToggleSelect}
            onToggleImportant={onToggleImportant}
            onToggleUrgent={onToggleUrgent}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

type ProposedHabitCardProps = {
  readonly messageId: string;
  readonly habit: ProposedHabit;
  readonly adding: boolean;
  readonly onUpdate: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAdd: (messageId: string, habit: ProposedHabit) => void;
};

export function ProposedHabitCard({ messageId, habit, adding, onUpdate, onAdd }: ProposedHabitCardProps) {
  const badge = getQuadrantBadge(habit);
  return (
    <div className={`proposed-task-item ${habit.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={habit.selected}
            disabled={habit.added}
            onChange={() => onUpdate(messageId, habit.id, { selected: !habit.selected })}
          />
          <span className="proposed-task-title">{habit.title}</span>
        </label>
        {habit.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> Added
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd(messageId, habit)}
            title="Add habit to Prior"
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      <div className="proposed-task-meta">
        <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
          {habitScheduleLabel(habit)} · {badge.label}
        </span>
        <FlagToggles
          important={habit.important}
          urgent={habit.urgent}
          disabled={habit.added}
          importantLabel={["Remove important flag", "Mark important"]}
          urgentLabel={["Remove urgent flag", "Mark urgent"]}
          onToggleImportant={() => onUpdate(messageId, habit.id, { important: !habit.important })}
          onToggleUrgent={() => onUpdate(messageId, habit.id, { urgent: !habit.urgent })}
        />
      </div>
      {habit.reasoning && <p className="proposed-reasoning">{habit.reasoning}</p>}
    </div>
  );
}

type HabitProposalBoxProps = {
  readonly messageId: string;
  readonly habits: readonly ProposedHabit[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdate: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAddSingle: (messageId: string, habit: ProposedHabit) => void;
  readonly onAddAll: (messageId: string, habits: ProposedHabit[]) => void;
};

export function HabitProposalBox({ messageId, habits, addingIds, onUpdate, onAddSingle, onAddAll }: HabitProposalBoxProps) {
  if (habits.length === 0) return null;
  const addedCount = habits.filter((habit) => habit.added).length;
  return (
    <div className="proposed-tasks-box proposed-habits-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{addedCount}/{habits.length} habits added</span>
        {habits.some((habit) => !habit.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll(messageId, [...habits])}>
            <Icon name="plus" />
            <span>Add habits to Prior</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {habits.map((habit) => (
          <ProposedHabitCard
            key={habit.id}
            messageId={messageId}
            habit={habit}
            adding={addingIds[habit.id] ?? false}
            onUpdate={onUpdate}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

export type AssistantMessageHandlers = {
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onToggleTaskSelect: (messageId: string, taskId: string) => void;
  readonly onToggleTaskImportant: (messageId: string, taskId: string) => void;
  readonly onToggleTaskUrgent: (messageId: string, taskId: string) => void;
  readonly onAddSingleTask: (messageId: string, task: ProposedTask) => void;
  readonly onAddAllTasks: (messageId: string, tasks: ProposedTask[]) => void;
  readonly onUpdateHabit: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAddSingleHabit: (messageId: string, habit: ProposedHabit) => void;
  readonly onAddAllHabits: (messageId: string, habits: ProposedHabit[]) => void;
};

type AssistantMessageProps = {
  readonly message: AgentMessage;
  readonly handlers: AssistantMessageHandlers;
};

export function AssistantMessage({ message: msg, handlers }: AssistantMessageProps) {
  if (msg.role === "user") {
    return (
      <div className="agent-message-row user">
        <div className="agent-message-bubble">
          <p className="agent-message-text">{msg.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="agent-message-row assistant">
      <div className="agent-message-avatar">
        <AgentIdentity size="tiny" />
      </div>
      <div className="agent-message-bubble">
        <p className="agent-message-text">{msg.content}</p>
        {msg.actualModel && (
          <div className="agent-model-info" title={`Resolved via OpenRouter: ${msg.actualModel}`}>
            <span className="routed-dot" />
            <span>Model: <strong>{msg.actualModel}</strong></span>
          </div>
        )}
        {msg.proposedTasks && (
          <TaskProposalBox
            messageId={msg.id}
            tasks={msg.proposedTasks}
            addingIds={handlers.addingIds}
            onToggleSelect={handlers.onToggleTaskSelect}
            onToggleImportant={handlers.onToggleTaskImportant}
            onToggleUrgent={handlers.onToggleTaskUrgent}
            onAddSingle={handlers.onAddSingleTask}
            onAddAll={handlers.onAddAllTasks}
          />
        )}
        {msg.proposedHabits && (
          <HabitProposalBox
            messageId={msg.id}
            habits={msg.proposedHabits}
            addingIds={handlers.addingIds}
            onUpdate={handlers.onUpdateHabit}
            onAddSingle={handlers.onAddSingleHabit}
            onAddAll={handlers.onAddAllHabits}
          />
        )}
      </div>
    </div>
  );
}
