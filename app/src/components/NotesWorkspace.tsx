import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { NOTE_FOLDER_COLORS, notesStore, type Note, type NoteAttachment, type NoteFolder } from "../lib/notes";
import { applySlashInsert, filterSlashCommands, matchSlashToken, type SlashCommand } from "../lib/noteSlash";
import "./NotesWorkspace.css";
import "katex/dist/katex.min.css";

type NotesWorkspaceProps = { readonly onOpenNote?: (note: Note) => void };
type EditorMode = "live" | "source" | "reading";
type NoteModalState =
  | { kind: "folder-name"; mode: "create"; parentId: string | null }
  | { kind: "folder-name"; mode: "rename"; folder: NoteFolder }
  | { kind: "move-note"; note: Note }
  | { kind: "folder-color"; folder: NoteFolder }
  | { kind: "confirm-note-delete"; note: Note }
  | { kind: "confirm-folder-delete"; folder: NoteFolder }
  | null;
const LIBRARY_ROOT_ID = "library-root";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|attachment:|data:image\/)/i.test(trimmed)) return trimmed;
  return "#";
}

function inlineMarkdown(value: string, attachments: Record<string, string>, attachmentTypes: Record<string, string>): string {
  let output = escapeHtml(value);
  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, rawUrl: string) => {
    const url = rawUrl.startsWith("attachment://") ? attachments[rawUrl.slice(13)] ?? "" : safeUrl(rawUrl);
    if (!url) return `<span class="note-attachment-pending">Attachment unavailable</span>`;
    const attachmentId = rawUrl.startsWith("attachment://") ? rawUrl.slice(13) : "";
    const mime = attachmentTypes[attachmentId] ?? "";
    if (mime.startsWith("video/")) return `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
    if (mime.startsWith("audio/")) return `<audio src="${escapeHtml(url)}" controls></audio>`;
    if (mime === "application/pdf") return `<a class="note-file-attachment" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open ${escapeHtml(alt)}</a>`;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  });
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => `<a href="${escapeHtml(safeUrl(rawUrl))}" target="_blank" rel="noreferrer">${label}</a>`);
  output = output.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alt?: string) => {
    const url = target.startsWith("attachment:") ? attachments[target.slice(11)] : attachments[target];
    const mime = attachmentTypes[target] ?? "";
    if (!url) return `<span class="note-attachment-pending">${escapeHtml(target)} (not available)</span>`;
    if (mime.startsWith("video/")) return `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
    if (mime.startsWith("audio/")) return `<audio src="${escapeHtml(url)}" controls></audio>`;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt ?? target)}" loading="lazy" />`;
  });
  output = output.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => `<button type="button" class="note-link" data-note="${escapeHtml(target.trim())}">${escapeHtml(label?.trim() ?? target.trim())}</button>`);
  output = output.replace(/(^|\s)#([\w-]+)/g, "$1<span class=\"note-tag\">#$2</span>");
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
  output = output.replace(/\$\$([^$\n]+)\$\$/g, "<span class=\"note-math note-math-display\">$1</span>");
  output = output.replace(/\$([^$\n]+)\$/g, "<span class=\"note-math\">$1</span>");
  return output;
}

function renderMarkdown(source: string, attachments: Record<string, string>, attachmentTypes: Record<string, string>): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let language = "";
  let code: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (inCode) {
        if (language.toLowerCase() === "mermaid") html.push(`<div class="note-diagram"><span>Mermaid diagram</span><pre>${escapeHtml(code.join("\n"))}</pre></div>`);
        else html.push(`<pre class="note-code"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        inCode = false; code = []; language = "";
      } else { closeList(); inCode = true; language = fence[1].trim(); }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; html.push(`<h${level}>${inlineMarkdown(heading[2], attachments, attachmentTypes)}</h${level}>`); continue; }
    const item = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (item || ordered) {
      const nextType = ordered ? "ol" : "ul";
      if (listType && listType !== nextType) closeList();
      if (!listType) { listType = nextType; html.push(`<${listType}>`); }
      if (item) { const checked = item[1]?.toLowerCase() === "x"; html.push(`<li class="${item[1] ? "task-item" : ""}">${item[1] ? `<span class="note-check ${checked ? "checked" : ""}">${checked ? "✓" : ""}</span>` : ""}${inlineMarkdown(item[2], attachments, attachmentTypes)}</li>`); }
      else html.push(`<li>${inlineMarkdown(ordered![1], attachments, attachmentTypes)}</li>`);
      continue;
    }
    if (/^>/.test(line)) { closeList(); html.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""), attachments, attachmentTypes)}</blockquote>`); continue; }
    if (/^---+$/.test(line.trim())) { closeList(); html.push("<hr />"); continue; }
    closeList();
    html.push(`<p>${inlineMarkdown(line, attachments, attachmentTypes)}</p>`);
  }
  if (inCode) html.push(`<pre class="note-code"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  closeList();
  return html.join("");
}

function folderChildren(folders: NoteFolder[], parentId: string | null): NoteFolder[] { return folders.filter((folder) => folder.parentId === parentId); }

function caretMenuPosition(textarea: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const mirror = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  for (const property of ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "whiteSpace", "wordWrap", "overflowWrap", "tabSize"] as const) {
    mirror.style[property] = style[property];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = Number.parseFloat(style.lineHeight) || 24;
  const position = {
    top: Math.min(marker.offsetTop - textarea.scrollTop + lineHeight + 4, textarea.clientHeight - 40),
    left: Math.min(marker.offsetLeft - textarea.scrollLeft + Number.parseFloat(style.borderLeftWidth || "0"), textarea.clientWidth - 272),
  };
  document.body.removeChild(mirror);
  return { top: Math.max(0, position.top), left: Math.max(0, position.left) };
}

function FolderTree({ folders, notes, parentId, selectedId, collapsedIds, onSelect, onToggleCollapse, onRenameFolder, onOpenFolderMenu, onOpenNoteMenu }: { folders: NoteFolder[]; notes: Note[]; parentId: string | null; selectedId: string | null; collapsedIds: Set<string>; onSelect: (note: Note) => void; onToggleCollapse: (id: string) => void; onRenameFolder: (folder: NoteFolder) => void; onOpenFolderMenu: (event: React.MouseEvent, folder: NoteFolder) => void; onOpenNoteMenu: (event: React.MouseEvent, note: Note) => void }) {
  const children = folderChildren(folders, parentId);
  const notesInFolder = notes.filter((note) => note.folderId === parentId);
  return <>
    {children.map((folder) => {
      const isCollapsed = collapsedIds.has(folder.id);
      return <div className="note-folder-group" key={folder.id} style={folder.color ? ({ "--folder-color": folder.color } as CSSProperties) : undefined}>
        <div className="note-folder-row" role="treeitem" aria-expanded={!isCollapsed} onClick={() => onToggleCollapse(folder.id)} onDoubleClick={() => onRenameFolder(folder)} onContextMenu={(event) => onOpenFolderMenu(event, folder)}>
          <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} />
          <span className="note-folder-icon" style={folder.color ? { color: folder.color } : undefined}><Icon name="folder" /></span>
          <strong>{folder.name}</strong>
        </div>
        {!isCollapsed && <div className="note-folder-children" data-folder-id={folder.id}>
          <FolderTree folders={folders} notes={notes} parentId={folder.id} selectedId={selectedId} collapsedIds={collapsedIds} onSelect={onSelect} onToggleCollapse={onToggleCollapse} onRenameFolder={onRenameFolder} onOpenFolderMenu={onOpenFolderMenu} onOpenNoteMenu={onOpenNoteMenu} />
        </div>}
      </div>;
    })}
    {notesInFolder.map((note) => <button type="button" className={`note-file-row ${selectedId === note.id ? "active" : ""}`} key={note.id} onClick={() => onSelect(note)} onContextMenu={(event) => onOpenNoteMenu(event, note)}><span className="note-file-icon">{note.favorite ? <Icon name="star" /> : <Icon name="file" />}</span><span>{note.title}</span></button>)}
  </>;
}

type ContextMenuItem = { icon: IconName; label: string; danger?: boolean; run: () => void };

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="note-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="note-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="note-modal-header"><h3>{title}</h3><button type="button" className="notes-icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </div>
  </div>;
}

function FolderNameModal({ title, initialName, initialColor, submitLabel, onSubmit, onClose }: { title: string; initialName: string; initialColor: string | null; submitLabel: string; onSubmit: (name: string, color: string | null) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string | null>(initialColor);
  return <ModalShell title={title} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim(), color); }}>
      <label className="note-modal-label" htmlFor="note-folder-name">Name</label>
      <input id="note-folder-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Folder name" autoFocus maxLength={60} />
      <span className="note-modal-label">Color</span>
      <div className="note-color-grid">
        <button type="button" className={`note-color-swatch none ${color === null ? "active" : ""}`} aria-label="No color" title="No color" onClick={() => setColor(null)} />
        {NOTE_FOLDER_COLORS.map((option) => <button key={option.value} type="button" className={`note-color-swatch ${color === option.value ? "active" : ""}`} style={{ background: option.value }} aria-label={option.name} title={option.name} onClick={() => setColor(option.value)} />)}
      </div>
      <div className="note-modal-actions"><button type="button" className="note-modal-secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!name.trim()}>{submitLabel}</button></div>
    </form>
  </ModalShell>;
}

function MoveNoteModal({ note, folders, onMove, onClose }: { note: Note; folders: NoteFolder[]; onMove: (folderId: string | null) => void; onClose: () => void }) {
  const [target, setTarget] = useState<string | null>(note.folderId);
  return <ModalShell title={`Move “${note.title}”`} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); onMove(target); }}>
      <div className="note-move-list" role="radiogroup" aria-label="Destination folder">
        <label className={target === null ? "active" : ""}><input type="radio" name="destination" checked={target === null} onChange={() => setTarget(null)} /><Icon name="folder" />Library</label>
        {folders.map((folder) => <label key={folder.id} className={target === folder.id ? "active" : ""}><input type="radio" name="destination" checked={target === folder.id} onChange={() => setTarget(folder.id)} /><span className="note-folder-icon" style={folder.color ? { color: folder.color } : undefined}><Icon name="folder" /></span>{folder.name}</label>)}
      </div>
      <div className="note-modal-actions"><button type="button" className="note-modal-secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Move</button></div>
    </form>
  </ModalShell>;
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return <ModalShell title={title} onClose={onClose}>
    <p className="note-modal-message">{message}</p>
    <div className="note-modal-actions"><button type="button" className="note-modal-secondary" onClick={onClose}>Cancel</button><button type="button" className="note-modal-danger" onClick={onConfirm}>{confirmLabel}</button></div>
  </ModalShell>;
}

function FolderColorModal({ folder, onPick, onClose }: { folder: NoteFolder; onPick: (color: string | null) => void; onClose: () => void }) {
  return <ModalShell title={`Color for “${folder.name}”`} onClose={onClose}>
    <div className="note-color-grid large">
      <button type="button" className={`note-color-swatch none ${folder.color === null ? "active" : ""}`} aria-label="No color" title="No color" onClick={() => { onPick(null); onClose(); }} />
      {NOTE_FOLDER_COLORS.map((option) => <button key={option.value} type="button" className={`note-color-swatch ${folder.color === option.value ? "active" : ""}`} style={{ background: option.value }} aria-label={option.name} title={option.name} onClick={() => { onPick(option.value); onClose(); }} />)}
    </div>
  </ModalShell>;
}

function NoteGraph({ notes, selected, onSelect, onClose }: { notes: Note[]; selected: Note | null; onSelect: (note: Note) => void; onClose: () => void }) {
  const linkedIds = new Set<string>(selected ? [selected.id] : []);
  if (selected) for (const match of selected.body.matchAll(/\[\[([^\]|#]+)/g)) {
    const target = notes.find((note) => note.title.toLowerCase() === match[1].trim().toLowerCase());
    if (target) linkedIds.add(target.id);
  }
  for (const note of notes) {
    if (selected && (note.body.match(/\[\[([^\]|#]+)/g) ?? []).some((link) => link.slice(2).toLowerCase() === selected.title.toLowerCase())) linkedIds.add(note.id);
    if (selected && note.body.toLowerCase().includes(`[[${selected.title.toLowerCase()}`)) linkedIds.add(note.id);
  }
  const nodes = notes.filter((note) => linkedIds.has(note.id)).slice(0, 32);
  const positions = new Map(nodes.map((note, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = nodes.length > 1 ? 145 : 0;
    return [note.id, { x: 230 + Math.cos(angle) * radius, y: 190 + Math.sin(angle) * radius }];
  }));
  const edges: Array<[string, string]> = [];
  for (const note of nodes) for (const match of note.body.matchAll(/\[\[([^\]|#]+)/g)) {
    const target = nodes.find((candidate) => candidate.title.toLowerCase() === match[1].trim().toLowerCase());
    if (target && !edges.some(([from, to]) => from === note.id && to === target.id)) edges.push([note.id, target.id]);
  }
  return <div className="notes-graph-overlay" role="dialog" aria-label="Linked note graph"><div className="notes-graph-card"><div className="notes-graph-header"><div><span className="notes-eyebrow">KNOWLEDGE GRAPH</span><h2>Linked notes</h2></div><button type="button" className="notes-icon-button" aria-label="Close graph" onClick={onClose}><Icon name="close" /></button></div><svg viewBox="0 0 460 380" role="img" aria-label="Graph of linked notes">{edges.map(([from, to]) => { const start = positions.get(from); const end = positions.get(to); return start && end ? <line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} /> : null; })}{nodes.map((note) => { const position = positions.get(note.id); if (!position) return null; return <g key={note.id} className={note.id === selected?.id ? "selected" : ""} tabIndex={0} role="button" aria-label={note.title} onClick={() => onSelect(note)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(note); }}><circle cx={position.x} cy={position.y} r={note.id === selected?.id ? 16 : 11} /><text x={position.x} y={position.y + 32} textAnchor="middle">{note.title.length > 20 ? `${note.title.slice(0, 18)}…` : note.title}</text></g>; })}</svg><p className="notes-graph-help">Select a node to open its note. Links are created with <code>[[double brackets]]</code>.</p></div></div>;
}

export function NotesWorkspace({ onOpenNote }: NotesWorkspaceProps) {
  const [notes, setNotes] = useState<Note[]>(() => notesStore.list());
  const [folders, setFolders] = useState<NoteFolder[]>(() => notesStore.listFolders());
  const [selectedId, setSelectedId] = useState<string | null>(() => notesStore.list()[0]?.id ?? null);
  const [openIds, setOpenIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("prior.notes.tabs") ?? "[]") as string[]; } catch { return []; } });
  const [mode, setMode] = useState<EditorMode>("live");
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(() => { try { return localStorage.getItem("prior.notes.library") !== "false"; } catch { return true; } });
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem("prior.notes.collapsed") ?? "[]") as string[]); } catch { return new Set<string>(); } });
  const [modal, setModal] = useState<NoteModalState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const renderedRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => notesStore.subscribe(() => { setNotes(notesStore.list()); setFolders(notesStore.listFolders()); }), []);
  useEffect(() => { const handler = () => newNote(); window.addEventListener("prior-notes-new", handler); return () => window.removeEventListener("prior-notes-new", handler); });
  useEffect(() => { if (!openIds.length && notes[0]) { setOpenIds([notes[0].id]); setSelectedId(notes[0].id); } }, [notes, openIds.length]);
  useEffect(() => { try { localStorage.setItem("prior.notes.tabs", JSON.stringify(openIds)); } catch { /* storage unavailable */ } }, [openIds]);
  useEffect(() => { try { localStorage.setItem("prior.notes.library", String(libraryOpen)); } catch { /* storage unavailable */ } }, [libraryOpen]);
  useEffect(() => { try { localStorage.setItem("prior.notes.collapsed", JSON.stringify([...collapsedIds])); } catch { /* storage unavailable */ } }, [collapsedIds]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  useEffect(() => {
    let cancelled = false;
    for (const meta of notesStore.attachmentMeta()) {
      void notesStore.loadAttachment(meta.id).then((blob) => {
        if (!cancelled && blob) setAttachmentUrls((current) => current[meta.id] ? current : { ...current, [meta.id]: URL.createObjectURL(blob) });
      }).catch(() => undefined);
    }
    return () => { cancelled = true; if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, []);

  const visibleNotes = useMemo(() => notes.filter((note) => (!folderFilter || folderFilter === "favorites" || note.folderId === folderFilter) && (!query.trim() || `${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase()))), [folderFilter, notes, query]);
  const currentAttachments = useMemo(() => Object.fromEntries(notesStore.attachmentMeta().map((item) => [item.id, attachmentUrls[item.id] ?? ""])), [attachmentUrls]);
  const currentAttachmentTypes = useMemo(() => Object.fromEntries(notesStore.attachmentMeta().map((item) => [item.id, item.type])), [attachmentUrls]);
  const backlinks = useMemo(() => selected ? notes.filter((note) => note.id !== selected.id && (note.body.includes(`[[${selected.title}]]`) || note.body.includes(`[[${selected.title}|`))).slice(0, 8) : [], [notes, selected]);
  const headings = useMemo(() => selected?.body.split("\n").filter((line) => /^#{1,6}\s/.test(line)).map((line) => line.replace(/^#+\s/, "")) ?? [], [selected]);

  useEffect(() => {
    if (!renderedRef.current || !selected || mode === "source") return undefined;
    let cancelled = false;
    void Promise.all([import("mermaid"), import("katex")]).then(async ([mermaidModule, katexModule]) => {
      if (cancelled || !renderedRef.current) return;
      const mermaid = mermaidModule.default;
      const katex = katexModule.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base" });
      const diagrams = Array.from(renderedRef.current.querySelectorAll<HTMLElement>(".note-diagram pre"));
      await Promise.all(diagrams.map(async (pre, index) => {
        const source = pre.textContent ?? "";
        try {
          const rendered = await mermaid.render(`prior-note-diagram-${selected.id}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "-"), source);
          if (!cancelled && pre.parentElement) pre.parentElement.innerHTML = `<span>Mermaid diagram</span>${rendered.svg}`;
        } catch {
          if (!cancelled && pre.parentElement) pre.parentElement.classList.add("has-error");
        }
      }));
      if (!cancelled && renderedRef.current) renderedRef.current.querySelectorAll<HTMLElement>(".note-math").forEach((element) => {
        try { katex.render(element.textContent ?? "", element, { displayMode: element.classList.contains("note-math-display"), throwOnError: false }); } catch { element.classList.add("has-error"); }
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentAttachments, mode, selected]);

  function selectNote(note: Note): void { setSelectedId(note.id); setOpenIds((current) => current.includes(note.id) ? current : [...current, note.id]); setExplorerOpen(false); onOpenNote?.(note); }
  function createNoteIn(folderId: string | null): void { const note = notesStore.create("Untitled note", folderId); setNotes(notesStore.list()); selectNote(note); setExplorerOpen(false); }
  function newNote(): void { createNoteIn(folderFilter && folderFilter !== "favorites" ? folderFilter : null); }
  function toggleCollapse(id: string): void { setCollapsedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function newFolder(parentId: string | null): void { setModal({ kind: "folder-name", mode: "create", parentId }); }
  function renameFolder(folder: NoteFolder): void { setModal({ kind: "folder-name", mode: "rename", folder }); }
  function submitFolderName(name: string, color: string | null, target: { mode: "create"; parentId: string | null } | { mode: "rename"; folder: NoteFolder }): void {
    if (target.mode === "create") {
      notesStore.createFolder(name, target.parentId, color);
      if (target.parentId) {
        const parentId: string = target.parentId;
        setCollapsedIds((current) => { const next = new Set(current); next.delete(parentId); return next; });
      }
    } else {
      notesStore.renameFolder(target.folder.id, name);
      notesStore.setFolderColor(target.folder.id, color);
    }
    setFolders(notesStore.listFolders());
    setModal(null);
  }
  function toggleFavorite(note: Note): void { notesStore.update({ ...note, favorite: !note.favorite }); setNotes(notesStore.list()); }
  function doTrashNote(note: Note): void { notesStore.trash(note.id); setOpenIds((current) => current.filter((id) => id !== note.id)); if (selectedId === note.id) setSelectedId(notes.find((item) => item.id !== note.id)?.id ?? null); setNotes(notesStore.list()); setModal(null); }
  function doDeleteFolder(folder: NoteFolder): void {
    notesStore.deleteFolder(folder.id);
    setFolders(notesStore.listFolders());
    setNotes(notesStore.list());
    if (folderFilter === folder.id) setFolderFilter(null);
    setCollapsedIds((current) => { const next = new Set(current); next.delete(folder.id); return next; });
    setModal(null);
  }
  function moveSelected(): void { if (selected) setModal({ kind: "move-note", note: selected }); }
  function trashSelected(): void { if (selected) setModal({ kind: "confirm-note-delete", note: selected }); }
  function openMenu(event: React.MouseEvent, items: ContextMenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    const width = 224;
    const height = items.length * 34 + 12;
    setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - width)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - height)), items });
  }
  function openFolderMenu(event: React.MouseEvent, folder: NoteFolder): void {
    openMenu(event, [
      { icon: "file-plus", label: "New note", run: () => createNoteIn(folder.id) },
      { icon: "folder-plus", label: "New subfolder", run: () => newFolder(folder.id) },
      { icon: "pencil", label: "Rename", run: () => renameFolder(folder) },
      { icon: "palette", label: "Set color", run: () => setModal({ kind: "folder-color", folder }) },
      { icon: "trash", label: "Delete folder", danger: true, run: () => setModal({ kind: "confirm-folder-delete", folder }) },
    ]);
  }
  function openNoteMenu(event: React.MouseEvent, note: Note): void {
    openMenu(event, [
      { icon: "file", label: "Open", run: () => selectNote(note) },
      { icon: "star", label: note.favorite ? "Remove from favorites" : "Add to favorites", run: () => toggleFavorite(note) },
      { icon: "folder", label: "Move to…", run: () => setModal({ kind: "move-note", note }) },
      { icon: "trash", label: "Delete note", danger: true, run: () => setModal({ kind: "confirm-note-delete", note }) },
    ]);
  }
  function openBackgroundMenu(event: React.MouseEvent): void {
    if ((event.target as HTMLElement).closest(".note-folder-row, .note-file-row, .note-context-menu")) return;
    const container = (event.target as HTMLElement).closest<HTMLElement>("[data-folder-id]");
    const raw = container?.dataset.folderId;
    const folderId = raw ? raw : null;
    openMenu(event, [
      { icon: "file-plus", label: "New note", run: () => createNoteIn(folderId) },
      { icon: "folder-plus", label: "New folder", run: () => newFolder(folderId) },
    ]);
  }
  function updateBody(body: string): void {
    if (!selected) return;
    setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, body, updatedAt: new Date().toISOString() } : note));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { const latest = notesStore.list().find((note) => note.id === selected.id); if (latest) notesStore.update({ ...latest, body }); }, 450);
  }
  function closeTab(id: string): void { setOpenIds((current) => current.filter((item) => item !== id)); if (selectedId === id) setSelectedId(openIds.find((item) => item !== id) ?? visibleNotes[0]?.id ?? null); }
  const slashOptions = useMemo(() => (slash ? filterSlashCommands(slash.query) : []), [slash]);
  function refreshSlash(body: string, caret: number): void {
    if (mode === "reading") { setSlash(null); return; }
    const token = matchSlashToken(body, caret);
    if (!token) { setSlash(null); return; }
    setSlash(token);
    setSlashIndex(0);
    if (editorRef.current) setSlashPos(caretMenuPosition(editorRef.current, token.start));
  }
  function chooseSlashCommand(command: SlashCommand): void {
    if (!selected || !slash || !editorRef.current) return;
    const caret = editorRef.current.selectionStart ?? selected.body.length;
    const next = applySlashInsert(selected.body, caret, slash.start, command);
    setSlash(null);
    updateBody(next.body);
    requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(next.caret, next.caret); });
  }
  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (!slash || slashOptions.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setSlashIndex((index) => (index + 1) % slashOptions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSlashIndex((index) => (index - 1 + slashOptions.length) % slashOptions.length); }
    else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); chooseSlashCommand(slashOptions[slashIndex] ?? slashOptions[0]); }
    else if (event.key === "Escape") { event.preventDefault(); setSlash(null); }
  }
  async function addFiles(files: FileList | null): Promise<void> {
    if (!files?.length || !selected) return;
    let inserted = selected.body;
    for (const file of Array.from(files)) {
      const id = `att-${typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : Date.now()}`;
      const meta: NoteAttachment = { id, name: file.name, type: file.type || "application/octet-stream", size: file.size };
      try { await notesStore.saveAttachment(meta, file); const url = URL.createObjectURL(file); setAttachmentUrls((current) => ({ ...current, [id]: url })); inserted += `\n![${file.name}](attachment://${id})\n`; }
      catch { /* attachment unavailable - the note text still saves */ }
    }
    if (inserted !== selected.body) updateBody(inserted);
  }
  function exportNote(): void {
    if (!selected) return;
    const blob = new Blob([selected.body], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${selected.title.replace(/[^\w\- ]/g, "").trim() || "note"}.md`; link.click(); URL.revokeObjectURL(url);
  }
  function onRenderedClick(event: React.MouseEvent<HTMLDivElement>): void { const target = (event.target as HTMLElement).closest<HTMLElement>("[data-note]"); if (!target) return; const linked = notes.find((note) => note.title.toLowerCase() === target.dataset.note?.toLowerCase()); if (linked) selectNote(linked); else { const created = notesStore.create(target.dataset.note ?? "Untitled note", selected?.folderId ?? null); setNotes(notesStore.list()); selectNote(created); } }

  return <section className={`notes-workspace ${libraryOpen ? "" : "library-collapsed"}`} aria-label="Notes">
    <aside className={`notes-explorer ${explorerOpen ? "mobile-open" : ""}`}>
      <div className="notes-explorer-header"><div><span className="notes-eyebrow">YOUR LIBRARY</span><h2>Notes</h2></div><div className="notes-explorer-header-actions"><button type="button" className="notes-icon-button" title="Collapse library" aria-label="Collapse library" onClick={() => { setLibraryOpen(false); setExplorerOpen(false); }}><Icon name="chevron-left" /></button><button type="button" className="notes-icon-button" title="New note" aria-label="New note" onClick={newNote}><Icon name="plus" /></button></div></div>
      <div className="notes-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></div>
      <div className="notes-explorer-actions"><button type="button" onClick={() => setFolderFilter(null)} className={!folderFilter ? "active" : ""}>All notes</button><button type="button" onClick={() => setFolderFilter("favorites")} className={folderFilter === "favorites" ? "active" : ""}>Favorites</button></div>
      <div className="notes-tree" role="tree" onContextMenu={openBackgroundMenu}><div className="note-folder-row root" role="treeitem" aria-expanded={!collapsedIds.has(LIBRARY_ROOT_ID)} onClick={() => toggleCollapse(LIBRARY_ROOT_ID)}><Icon name={collapsedIds.has(LIBRARY_ROOT_ID) ? "chevron-right" : "chevron-down"} /><Icon name="folder" /><strong>Library</strong><button type="button" aria-label="New folder" title="New folder" onClick={(event) => { event.stopPropagation(); newFolder(null); }}><Icon name="plus" /></button></div>{!collapsedIds.has(LIBRARY_ROOT_ID) && <div className="note-folder-children root-children" data-folder-id="">{folderFilter === "favorites" ? notes.filter((note) => note.favorite).map((note) => <button type="button" className={`note-file-row ${selectedId === note.id ? "active" : ""}`} key={note.id} onClick={() => selectNote(note)} onContextMenu={(event) => openNoteMenu(event, note)}><span className="note-file-icon"><Icon name="star" /></span><span>{note.title}</span></button>) : <FolderTree folders={folders} notes={visibleNotes} parentId={null} selectedId={selectedId} collapsedIds={collapsedIds} onSelect={selectNote} onToggleCollapse={toggleCollapse} onRenameFolder={renameFolder} onOpenFolderMenu={openFolderMenu} onOpenNoteMenu={openNoteMenu} />}</div>}</div>
    </aside>
    {!libraryOpen && <aside className="notes-rail" aria-label="Library collapsed"><button type="button" className="notes-icon-button" title="Expand library" aria-label="Expand library" onClick={() => setLibraryOpen(true)}><Icon name="chevron-right" /></button><button type="button" className="notes-icon-button" title="New note" aria-label="New note" onClick={newNote}><Icon name="plus" /></button></aside>}
      <div className="notes-main">
      <div className="notes-tabs" role="tablist">{openIds.map((id) => { const note = notes.find((item) => item.id === id); if (!note) return null; return <button type="button" role="tab" aria-selected={selectedId === note.id} className={`notes-tab ${selectedId === note.id ? "active" : ""}`} key={id} onClick={() => setSelectedId(id)}><span className="notes-tab-icon">{note.favorite ? <Icon name="star" /> : <Icon name="file" />}</span><span className="notes-tab-title">{note.title}</span><span className="notes-tab-close" onClick={(event) => { event.stopPropagation(); closeTab(id); }}>×</span></button>; })}<button type="button" className="notes-tab-add" aria-label="New note" onClick={newNote}><Icon name="plus" /></button></div>
      {selected ? <><div className="notes-toolbar"><div className="notes-breadcrumb"><button type="button" className="notes-files-toggle" aria-label="Toggle Library" aria-expanded={libraryOpen} onClick={() => { setLibraryOpen((open) => { const next = !open; setExplorerOpen(next); return next; }); }}>Library</button><span>{folders.find((folder) => folder.id === selected.folderId)?.name ?? "Library"}</span><span>/</span><strong>{selected.title}</strong></div><div className="notes-toolbar-actions"><button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button><button type="button" className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>Source</button><button type="button" className={mode === "reading" ? "active" : ""} onClick={() => setMode("reading")}>Read</button><span className="notes-toolbar-separator" /><button type="button" title="Move note" onClick={moveSelected}>Move</button><button type="button" title="Attach image or video" aria-label="Attach image or video" onClick={() => document.getElementById("notes-attachment-input")?.click()}><Icon name="plus" /></button><input id="notes-attachment-input" type="file" accept="image/*,video/*,audio/*,application/pdf" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} /><button type="button" title="Export Markdown" aria-label="Export Markdown" onClick={exportNote}><Icon name="download" /></button><button type="button" title="Move note to Trash" aria-label="Move note to Trash" onClick={trashSelected}><Icon name="trash" /></button><button type="button" title="Open linked note graph" aria-label="Open linked note graph" onClick={() => setGraphOpen(true)}><Icon name="grid" /></button><button type="button" title="Toggle inspector" aria-label="Toggle inspector" className={inspectorOpen ? "active" : ""} onClick={() => setInspectorOpen((open) => !open)}><Icon name="columns" /></button></div></div><div className="notes-title-row"><input value={selected.title} aria-label="Note title" onChange={(event) => { const title = event.target.value; setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, title } : note)); }} onBlur={() => { const latest = notes.find((note) => note.id === selected.id); if (latest) notesStore.update(latest); }} /><button type="button" className={`note-favorite ${selected.favorite ? "active" : ""}`} aria-label="Favorite note" onClick={() => { const saved = notesStore.update({ ...selected, favorite: !selected.favorite }); setNotes(notesStore.list()); setSelectedId(saved.id); }}><Icon name="star" /></button></div><div className={`notes-editor-layout ${inspectorOpen ? "with-inspector" : ""}`}>
        {mode === "reading" ? <div ref={renderedRef} className="notes-reading" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.body, currentAttachments, currentAttachmentTypes) }} /> : <div className={`notes-editor-pair ${mode === "source" ? "source-only" : ""}`}><div className="notes-editor-pane"><textarea ref={editorRef} value={selected.body} onChange={(event) => { updateBody(event.target.value); refreshSlash(event.target.value, event.target.selectionStart ?? event.target.value.length); }} onKeyDown={onEditorKeyDown} onClick={(event) => refreshSlash(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)} onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) refreshSlash(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }} spellCheck aria-label="Markdown editor" placeholder="Start writing… Type / for blocks" />{slash && slashOptions.length > 0 && <div className="notes-slash-menu" role="listbox" aria-label="Insert block" style={{ top: slashPos.top, left: slashPos.left }}>{slashOptions.map((command, index) => <button key={command.id} type="button" role="option" aria-selected={index === slashIndex} className={index === slashIndex ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashCommand(command)} onMouseEnter={() => setSlashIndex(index)}><span className="notes-slash-icon"><Icon name={command.icon} /></span><span className="notes-slash-text"><strong>{command.label}</strong><small>{command.hint}</small></span></button>)}</div>}</div>{mode === "live" && <div ref={renderedRef} className="notes-preview-pane" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.body, currentAttachments, currentAttachmentTypes) }} />}</div>}
        {inspectorOpen && <aside className="notes-inspector"><div><span className="notes-inspector-label">OUTLINE</span>{headings.length ? headings.map((heading) => <button type="button" key={heading}>{heading}</button>) : <p>No headings yet</p>}</div><div><span className="notes-inspector-label">BACKLINKS</span>{backlinks.length ? backlinks.map((note) => <button type="button" key={note.id} onClick={() => selectNote(note)}>{note.title}</button>) : <p>No backlinks</p>}</div><div><span className="notes-inspector-label">DETAILS</span><p>{selected.body.trim().split(/\s+/).filter(Boolean).length} words</p><p>Edited {new Date(selected.updatedAt).toLocaleDateString()}</p></div></aside>}
      </div>{graphOpen && <NoteGraph notes={notes} selected={selected} onSelect={(note) => { selectNote(note); setGraphOpen(false); }} onClose={() => setGraphOpen(false)} />}</> : <div className="notes-empty"><div className="notes-empty-mark"><Icon name="file-text" /></div><h2>Your thinking space</h2><p>Create a note to capture an idea, plan a project, or connect a thought.</p><button type="button" className="primary-button" onClick={newNote}><Icon name="plus" />New note</button></div>}
    </div>
    {menu && <div className="note-context-overlay" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }}><div className="note-context-menu" role="menu" style={{ top: menu.y, left: menu.x }} onClick={(event) => event.stopPropagation()}>{menu.items.map((item) => <button key={item.label} type="button" role="menuitem" className={item.danger ? "danger" : ""} onClick={() => { setMenu(null); item.run(); }}><Icon name={item.icon} /><span>{item.label}</span></button>)}</div></div>}
    {modal?.kind === "folder-name" && <FolderNameModal title={modal.mode === "create" ? "New folder" : `Rename folder`} initialName={modal.mode === "create" ? "" : modal.folder.name} initialColor={modal.mode === "create" ? null : modal.folder.color} submitLabel={modal.mode === "create" ? "Create folder" : "Rename"} onSubmit={(name, color) => submitFolderName(name, color, modal.mode === "create" ? { mode: "create", parentId: modal.parentId } : { mode: "rename", folder: modal.folder })} onClose={() => setModal(null)} />}
    {modal?.kind === "move-note" && <MoveNoteModal note={modal.note} folders={folders} onMove={(folderId) => { notesStore.move(modal.note.id, folderId); setNotes(notesStore.list()); setModal(null); }} onClose={() => setModal(null)} />}
    {modal?.kind === "folder-color" && <FolderColorModal folder={modal.folder} onPick={(color) => { notesStore.setFolderColor(modal.folder.id, color); setFolders(notesStore.listFolders()); }} onClose={() => setModal(null)} />}
    {modal?.kind === "confirm-note-delete" && <ConfirmModal title="Delete note?" message={`“${modal.note.title}” will be moved to Trash.`} confirmLabel="Delete" onConfirm={() => doTrashNote(modal.note)} onClose={() => setModal(null)} />}
    {modal?.kind === "confirm-folder-delete" && <ConfirmModal title="Delete folder?" message={`“${modal.folder.name}” will be removed. Notes and subfolders inside move up one level.`} confirmLabel="Delete folder" onConfirm={() => doDeleteFolder(modal.folder)} onClose={() => setModal(null)} />}
  </section>;
}
