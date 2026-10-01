import { cell, findColumn, normalizeHeader, type CsvTable } from "./csv";
import { inferDayOrder, looksRecurring, parseLooseDate, stripAccents } from "./dates";
import { toRecurrence } from "./recurrence";
import { projectNameFromFile, type ParseOptions } from "./todoist";
import { collectProjects, emptyBatch, makeTask, MAX_DESCRIPTION_LENGTH, MAX_IMPORT_TASKS, type ImportBatch, type ImportedState, type ImportedTask, type ImportSource } from "./types";
import type { TaskPriority, TaskStatus } from "../../types";

/** Which column holds what; -1 means "none". */
export type ColumnMapping = {
  title: number;
  description: number;
  due: number;
  priority: number;
  status: number;
  done: number;
  project: number;
  tags: number;
  parent: number;
};

export const MAPPING_FIELDS = ["title", "description", "due", "priority", "status", "done", "project", "tags", "parent"] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];

const SYNONYMS: Record<MappingField, readonly string[]> = {
  title: ["name", "title", "task", "task name", "tasks", "nom", "titre", "tache", "nom de la tache", "aufgabe", "titel", "tarea", "nombre", "titulo", "tarefa", "nome", "summary", "issue", "to do", "todo", "content", "subject", "objet", "sujet"],
  description: ["description", "notes", "note", "details", "detail", "body", "comment", "comments", "commentaire", "commentaires", "beschreibung", "notizen", "descripcion", "notas", "descricao"],
  due: ["due", "due date", "deadline", "date due", "echeance", "date d echeance", "date limite", "faellig", "falligkeit", "fallig", "falligkeitsdatum", "fecha limite", "vencimiento", "fecha de vencimiento", "prazo", "data de vencimento", "date", "datum", "fecha", "data"],
  priority: ["priority", "priorite", "prioritat", "prioridad", "prioridade", "prio"],
  status: ["status", "statut", "state", "etat", "estado", "zustand", "situacao", "stage"],
  done: ["done", "completed", "complete", "checkbox", "fait", "termine", "terminee", "erledigt", "hecho", "completado", "feito", "concluido", "finished", "is done", "checked"],
  project: ["project", "projet", "list", "liste", "projekt", "proyecto", "projeto", "board", "tableau"],
  tags: ["tags", "tag", "labels", "label", "etiquettes", "etiquette", "categories", "category", "categorie", "kategorie", "schlagworter", "etiquetas", "marcadores"],
  parent: ["parent item", "parent task", "parent", "parent issue", "element parent", "elemento principal", "uberordnetes element", "item pai"],
};

/** Picks a column for every field from the header names (any of five languages). */
export function detectMapping(headers: readonly string[]): ColumnMapping {
  const used = new Set<number>();
  const mapping = { title: -1, description: -1, due: -1, priority: -1, status: -1, done: -1, project: -1, tags: -1, parent: -1 } as ColumnMapping;
  for (const field of MAPPING_FIELDS) {
    // Walk the synonyms in order so "Due" beats "Date", skipping columns another field took.
    for (const name of SYNONYMS[field]) {
      const index = headers.findIndex((header, position) => !used.has(position) && normalizeHeader(header) === name);
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  if (mapping.title < 0 && headers.length > 0) {
    const first = headers.findIndex((_, position) => !used.has(position));
    if (first >= 0) mapping.title = first;
  }
  return mapping;
}

/** A table is "recognised" when its title column came from a header name, not the fallback. */
export function hasKnownTitleColumn(headers: readonly string[]): boolean {
  return findColumn(headers, SYNONYMS.title) >= 0;
}

export function priorityFromText(value: string): TaskPriority | null {
  const text = stripAccents(value).toLowerCase().trim();
  if (!text) return null;
  const digit = /^p?([1-4])$/.exec(text);
  if (digit) return Number(digit[1]) as TaskPriority;
  if (/urgent|critical|critique|highest|blocker|dringend|urgente|maximum|tres haute|muy alta|muito alta/.test(text)) return 1;
  if (/^(high|haute|elevee|eleve|hoch|alta|alto|important|importante|wichtig)$/.test(text)) return 2;
  if (/^(medium|normal|moyenne|moyen|mittel|media|medio|medium priority|mitte)$/.test(text)) return 3;
  if (/^(low|basse|bas|faible|niedrig|baja|bajo|baixa|baixo|none|aucune|no priority|keine)$/.test(text)) return 4;
  return null;
}

type StatusRead = { status: TaskStatus; state: ImportedState };

export function statusFromText(value: string): StatusRead | null {
  const text = stripAccents(value).toLowerCase().trim().replace(/[\s_-]+/g, " ");
  if (!text) return null;
  if (/^(done|complete|completed|finished|closed|resolved|terminé|termine|terminee|fait|faite|erledigt|abgeschlossen|hecho|completado|completada|concluido|concluida|feito|feita|finalizado)$/.test(text)) return { status: "done", state: "completed" };
  if (/^(cancel+ed|annule|annulee|abgebrochen|cancelado|cancelada|dropped|abandonne|won t do)$/.test(text)) return { status: "done", state: "canceled" };
  if (/^(in progress|doing|started|wip|en cours|in arbeit|en curso|em andamento|em curso|in review|active|actif)$/.test(text)) return { status: "in_progress", state: "open" };
  if (/^(waiting|blocked|on hold|en attente|bloque|bloquee|wartend|en espera|aguardando|esperando)$/.test(text)) return { status: "waiting", state: "open" };
  if (/^(not started|todo|to do|a faire|zu erledigen|por hacer|a fazer|next|up next|backlog|planned|planifie|geplant|nouveau|new|open|ouvert|pendiente|pendente|nicht begonnen|pas commence|non commence|sin empezar|nao iniciado)$/.test(text)) return { status: "next", state: "open" };
  return null;
}

function isChecked(value: string): boolean {
  return /^(yes|true|y|x|1|✓|✔|☑|checked|oui|ja|si|sí|sim|vrai|wahr|verdadero|verdadeiro)$/i.test(stripAccents(value).trim());
}

/** Notion relation cells look like "Name (https://www.notion.so/...)": keep the first name. */
export function stripNotionLinks(value: string): string {
  const entries = [...value.matchAll(/([^,()][^()]*?)\s*\(https?:\/\/[^)]+\)/g)].map((match) => match[1].trim()).filter(Boolean);
  if (entries.length > 0) return entries[0];
  return value.trim();
}

/** Same for a list of names, joined with ", ". */
function stripNotionLinksAll(value: string): string {
  const entries = [...value.matchAll(/([^,()][^()]*?)\s*\(https?:\/\/[^)]+\)/g)].map((match) => match[1].trim()).filter(Boolean);
  return entries.length > 0 ? entries.join(", ") : value.trim();
}

/**
 * Reads any task table (Notion database, spreadsheet, other tools) with a
 * column mapping, which `detectMapping` prefills and the wizard lets the user
 * change.
 */
export function parseTable(table: CsvTable, mapping: ColumnMapping, options: ParseOptions = {}, source: ImportSource = "csv"): ImportBatch {
  const batch = emptyBatch(source);
  options = { ...options, order: inferDayOrder(table.rows.map((row) => cell(row, mapping.due)), options.order) };
  // A Notion database is a project; the name of an arbitrary spreadsheet says nothing.
  const fileProject = source === "notion" && options.fileName ? projectNameFromFile(options.fileName, "") : "";
  const keyName = options.fileName ? projectNameFromFile(options.fileName, "") : "";
  const prefix = (keyName || "csv").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "csv";
  const parents = new Map<ImportedTask, string>();
  const byTitle = new Map<string, ImportedTask>();
  let unreadDates = 0;

  for (const row of table.rows) {
    const title = cell(row, mapping.title);
    if (!title) continue;
    if (batch.tasks.length >= MAX_IMPORT_TASKS) {
      batch.warnings.push({ code: "truncated", count: MAX_IMPORT_TASKS, file: options.fileName });
      break;
    }
    const notes: string[] = [];
    let dueDate: string | null = null;
    let dueTime: string | null = null;
    let recurrence = null;
    const dueText = cell(row, mapping.due);
    if (dueText) {
      if (looksRecurring(dueText)) {
        recurrence = toRecurrence(dueText);
        if (!recurrence) notes.push(`Repeats: ${dueText}`);
      } else {
        const parsed = parseLooseDate(dueText, options);
        if (parsed) {
          dueDate = parsed.date;
          dueTime = parsed.time;
        } else {
          unreadDates += 1;
          notes.push(`Date: ${dueText}`);
        }
      }
    }
    const tags = stripNotionLinksAll(cell(row, mapping.tags));
    if (tags) notes.push(`Labels: ${tags}`);
    const read = statusFromText(cell(row, mapping.status));
    let state: ImportedState = read?.state ?? "open";
    let status: TaskStatus = read?.status ?? "next";
    if (mapping.done >= 0 && isChecked(cell(row, mapping.done))) {
      state = "completed";
      status = "done";
    }
    const projectCell = mapping.project >= 0 ? stripNotionLinks(cell(row, mapping.project)) : "";
    const task = makeTask(`${prefix}:${batch.tasks.length + 1}`, title, {
      description: [cell(row, mapping.description), ...notes].filter(Boolean).join("\n\n").slice(0, MAX_DESCRIPTION_LENGTH),
      priority: priorityFromText(cell(row, mapping.priority)) ?? 4,
      dueDate,
      dueTime,
      recurrence,
      status,
      state,
      projectName: (mapping.project >= 0 ? projectCell : fileProject) || null,
    });
    batch.tasks.push(task);
    if (!byTitle.has(task.title.toLowerCase())) byTitle.set(task.title.toLowerCase(), task);
    const parent = mapping.parent >= 0 ? stripNotionLinks(cell(row, mapping.parent)) : "";
    if (parent) parents.set(task, parent);
  }

  for (const [task, parentTitle] of parents) {
    const parent = byTitle.get(parentTitle.toLowerCase());
    if (parent && parent !== task && parent.projectName === task.projectName) task.parentKey = parent.key;
    else task.description = [task.description, `Parent: ${parentTitle}`].filter(Boolean).join("\n\n");
  }
  if (unreadDates > 0) batch.warnings.push({ code: "dates", count: unreadDates, file: options.fileName });
  collectProjects(batch);
  return batch;
}
