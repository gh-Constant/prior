import { useMemo } from "react";
import { Icon } from "../Icon";
import { NoteGlyph } from "./NoteGlyph";
import { useI18n } from "../../lib/i18n";
import type { Note } from "../../lib/notes";
import { countWords, findBacklinks, findNeighbors, shortDate, type OutlineHeading } from "./noteInsights";

type NotesInspectorProps = {
  readonly note: Note;
  readonly notes: readonly Note[];
  readonly folderLabel: string;
  readonly projectLabel: string | null;
  readonly outline: readonly OutlineHeading[];
  readonly activeHeading: number;
  readonly onJumpToHeading: (index: number) => void;
  readonly onSelectNote: (note: Note) => void;
  readonly onOpenGraph: () => void;
};

const GRAPH_WIDTH = 236;
const GRAPH_HEIGHT = 124;
const GRAPH_LIMIT = 8;

function LocalGraph({ note, neighbors, onSelectNote }: { note: Note; neighbors: readonly Note[]; onSelectNote: (note: Note) => void }) {
  const { t } = useI18n();
  const center = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  const shown = neighbors.slice(0, GRAPH_LIMIT);
  const offset = shown.length > 1 ? Math.PI / shown.length : 0;
  const nodes = shown.map((neighbor, index) => {
    const angle = (index / shown.length) * Math.PI * 2 - Math.PI / 2 + offset;
    return { note: neighbor, x: center.x + Math.cos(angle) * 88, y: center.y + Math.sin(angle) * 42 };
  });
  return (
    <svg className="notes-local-graph" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} role="group" aria-label={t("notes.workspace.localGraph")}>
      {nodes.map((node) => <line key={`edge-${node.note.id}`} x1={center.x} y1={center.y} x2={node.x} y2={node.y} />)}
      {nodes.map((node) => (
        <g
          key={node.note.id}
          className="notes-local-graph-node"
          role="button"
          tabIndex={0}
          aria-label={node.note.title}
          onClick={() => onSelectNote(node.note)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectNote(node.note); }
          }}
        >
          <title>{node.note.title}</title>
          <circle cx={node.x} cy={node.y} r={10} className="hit" />
          <circle cx={node.x} cy={node.y} r={5} />
        </g>
      ))}
      <circle className="notes-local-graph-center" cx={center.x} cy={center.y} r={7}><title>{note.title}</title></circle>
    </svg>
  );
}

export function NotesInspector({ note, notes, folderLabel, projectLabel, outline, activeHeading, onJumpToHeading, onSelectNote, onOpenGraph }: NotesInspectorProps) {
  const { t, lang } = useI18n();
  const backlinks = useMemo(() => findBacklinks(note, notes), [note, notes]);
  const neighbors = useMemo(() => findNeighbors(note, notes), [note, notes]);
  const minLevel = outline.reduce((min, heading) => Math.min(min, heading.level), 6);
  const properties: ReadonlyArray<readonly [string, string]> = [
    [t("notes.workspace.folder"), folderLabel],
    [t("notes.workspace.created"), shortDate(note.createdAt, lang)],
    [t("notes.workspace.project"), projectLabel ?? "—"],
    [t("notes.workspace.words"), new Intl.NumberFormat(lang).format(countWords(note.body))],
  ];

  return (
    <aside className="notes-inspector" aria-label={t("notes.workspace.inspectorLabel")}>
      <section className="notes-inspector-section">
        <h2 className="notes-inspector-heading">{t("notes.workspace.properties")}</h2>
        <dl className="notes-properties">
          {properties.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>
          ))}
        </dl>
      </section>

      <section className="notes-inspector-section">
        <h2 className="notes-inspector-heading">{t("notes.workspace.outline")}</h2>
        {outline.length ? (
          <nav className="notes-outline" aria-label={t("notes.workspace.outline")}>
            {outline.map((heading, index) => (
              <button
                type="button"
                key={`${heading.line}-${heading.text}`}
                className={index === activeHeading ? "active" : ""}
                aria-current={index === activeHeading ? "location" : undefined}
                style={{ paddingLeft: 8 + (heading.level - minLevel) * 12 }}
                onClick={() => onJumpToHeading(index)}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        ) : <p className="notes-inspector-empty">{t("notes.inspector.noHeadings")}</p>}
      </section>

      <section className="notes-inspector-section">
        <h2 className="notes-inspector-heading">
          {t("notes.workspace.backlinks")}
          {backlinks.length > 0 && <span className="notes-inspector-count"> · {backlinks.length}</span>}
        </h2>
        {backlinks.length ? (
          <ul className="notes-backlinks">
            {backlinks.map((backlink) => (
              <li key={backlink.id}>
                <button type="button" onClick={() => onSelectNote(backlink)}>
                  <Icon name="file" />
                  <span>{backlink.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="notes-inspector-empty">{t("notes.inspector.noBacklinks")}</p>}
      </section>

      {neighbors.length > 0 && (
        <section className="notes-inspector-section">
          <div className="notes-inspector-heading-row">
            <h2 className="notes-inspector-heading">{t("notes.workspace.localGraph")}</h2>
            <button type="button" className="notes-icon-button" title={t("notes.workspace.graph")} aria-label={t("notes.workspace.graph")} onClick={onOpenGraph}>
              <NoteGlyph name="graph" />
            </button>
          </div>
          <LocalGraph note={note} neighbors={neighbors} onSelectNote={onSelectNote} />
        </section>
      )}
    </aside>
  );
}
