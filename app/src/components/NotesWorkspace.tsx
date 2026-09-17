import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { notesStore, type Note, type NoteAttachment, type NoteFolder } from "../lib/notes";
import { applySlashInsert, filterSlashCommands, matchSlashToken, type SlashCommand } from "../lib/noteSlash";
import "./NotesWorkspace.css";
import "katex/dist/katex.min.css";

type NotesWorkspaceProps = { readonly onOpenNote?: (note: Note) => void };
type EditorMode = "live" | "source" | "reading";

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

function FolderTree({ folders, notes, parentId, selectedId, onSelect, onNewFolder, onRenameFolder }: { folders: NoteFolder[]; notes: Note[]; parentId: string | null; selectedId: string | null; onSelect: (note: Note) => void; onNewFolder: (parentId: string | null) => void; onRenameFolder: (folder: NoteFolder) => void }) {
  const children = folderChildren(folders, parentId);
  const notesInFolder = notes.filter((note) => note.folderId === parentId);
  return <>
    {children.map((folder) => <div className="note-folder-group" key={folder.id}>
      <div className="note-folder-row" onDoubleClick={() => onRenameFolder(folder)}><Icon name="chevron-down" /><Icon name="folder" /><strong>{folder.name}</strong><button type="button" aria-label={`New subfolder in ${folder.name}`} title="New subfolder" onClick={() => onNewFolder(folder.id)}><Icon name="plus" /></button></div>
      <FolderTree folders={folders} notes={notes} parentId={folder.id} selectedId={selectedId} onSelect={onSelect} onNewFolder={onNewFolder} onRenameFolder={onRenameFolder} />
    </div>)}
    {notesInFolder.map((note) => <button type="button" className={`note-file-row ${selectedId === note.id ? "active" : ""}`} key={note.id} onClick={() => onSelect(note)}><span className="note-file-icon">{note.favorite ? <Icon name="star" /> : <Icon name="file" />}</span><span>{note.title}</span></button>)}
  </>;
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const renderedRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => notesStore.subscribe(() => { setNotes(notesStore.list()); setFolders(notesStore.listFolders()); }), []);
  useEffect(() => { const handler = () => newNote(); window.addEventListener("prior-notes-new", handler); return () => window.removeEventListener("prior-notes-new", handler); });
  useEffect(() => { if (!openIds.length && notes[0]) { setOpenIds([notes[0].id]); setSelectedId(notes[0].id); } }, [notes, openIds.length]);
  useEffect(() => { try { localStorage.setItem("prior.notes.tabs", JSON.stringify(openIds)); } catch { /* storage unavailable */ } }, [openIds]);
  useEffect(() => { try { localStorage.setItem("prior.notes.library", String(libraryOpen)); } catch { /* storage unavailable */ } }, [libraryOpen]);
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

  function selectNote(note: Note): void { setSelectedId(note.id); setOpenIds((current) => current.includes(note.id) ? current : [...current, note.id]); onOpenNote?.(note); }
  function newNote(): void { const note = notesStore.create("Untitled note", folderFilter && folderFilter !== "favorites" ? folderFilter : null); setNotes(notesStore.list()); selectNote(note); setExplorerOpen(false); }
  function newFolder(parentId: string | null): void { const name = window.prompt("Folder name", "New folder"); if (!name?.trim()) return; notesStore.createFolder(name, parentId); setFolders(notesStore.listFolders()); }
  function renameFolder(folder: NoteFolder): void { const name = window.prompt("Rename folder", folder.name); if (!name?.trim()) return; notesStore.renameFolder(folder.id, name); setFolders(notesStore.listFolders()); }
  function moveSelected(): void {
    if (!selected) return;
    const choices = ["Library", ...folders.map((folder) => folder.name)];
    const choice = window.prompt(`Move “${selected.title}” to:\n${choices.map((name, index) => `${index + 1}. ${name}`).join("\n")}`, "1");
    const index = Number(choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) return;
    notesStore.move(selected.id, index === 0 ? null : folders[index - 1].id); setNotes(notesStore.list());
  }
  function trashSelected(): void { if (!selected || !window.confirm(`Move “${selected.title}” to Trash?`)) return; notesStore.trash(selected.id); setOpenIds((current) => current.filter((id) => id !== selected.id)); setSelectedId(notes[0]?.id ?? null); setNotes(notesStore.list()); }
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
      <div className="notes-explorer-header"><div><span className="notes-eyebrow">YOUR LIBRARY</span><h2>Notes</h2></div><div className="notes-explorer-header-actions"><button type="button" className="notes-icon-button" title="Collapse library" aria-label="Collapse library" onClick={() => { setLibraryOpen(false); setExplorerOpen(false); }}><Icon name="chevron-left" /></button><button type="button" className="notes-icon-button" title="New note" aria-label="New note" onClick={newNote}><Icon name="plus" /></button><button type="button" className="notes-icon-button notes-mobile-close" title="Close library" aria-label="Close library" onClick={() => setExplorerOpen(false)}><Icon name="close" /></button></div></div>
      <div className="notes-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></div>
      <div className="notes-explorer-actions"><button type="button" onClick={() => setFolderFilter(null)} className={!folderFilter ? "active" : ""}>All notes</button><button type="button" onClick={() => setFolderFilter("favorites")} className={folderFilter === "favorites" ? "active" : ""}>Favorites</button></div>
      <div className="notes-tree" role="tree"><div className="note-folder-row root"><Icon name="chevron-down" /><Icon name="folder" /><strong>Library</strong><button type="button" aria-label="New folder" title="New folder" onClick={() => newFolder(null)}><Icon name="plus" /></button></div>{folderFilter === "favorites" ? notes.filter((note) => note.favorite).map((note) => <button type="button" className={`note-file-row ${selectedId === note.id ? "active" : ""}`} key={note.id} onClick={() => selectNote(note)}><span className="note-file-icon"><Icon name="star" /></span><span>{note.title}</span></button>) : <FolderTree folders={folders} notes={visibleNotes} parentId={null} selectedId={selectedId} onSelect={selectNote} onNewFolder={newFolder} onRenameFolder={renameFolder} />}</div>
    </aside>
    {!libraryOpen && <aside className="notes-rail" aria-label="Library collapsed"><button type="button" className="notes-icon-button" title="Expand library" aria-label="Expand library" onClick={() => setLibraryOpen(true)}><Icon name="chevron-right" /></button><button type="button" className="notes-icon-button" title="New note" aria-label="New note" onClick={newNote}><Icon name="plus" /></button></aside>}
      <div className="notes-main">
      <div className="notes-tabs" role="tablist">{openIds.map((id) => { const note = notes.find((item) => item.id === id); if (!note) return null; return <button type="button" role="tab" aria-selected={selectedId === note.id} className={`notes-tab ${selectedId === note.id ? "active" : ""}`} key={id} onClick={() => setSelectedId(id)}><span className="notes-tab-icon">{note.favorite ? <Icon name="star" /> : <Icon name="file" />}</span><span className="notes-tab-title">{note.title}</span><span className="notes-tab-close" onClick={(event) => { event.stopPropagation(); closeTab(id); }}>×</span></button>; })}<button type="button" className="notes-tab-add" aria-label="New note" onClick={newNote}><Icon name="plus" /></button></div>
      {selected ? <><div className="notes-toolbar"><div className="notes-breadcrumb"><button type="button" className="notes-files-toggle" aria-label="Toggle Library" aria-expanded={libraryOpen} onClick={() => { setLibraryOpen((open) => { const next = !open; setExplorerOpen(next); return next; }); }}>Library</button><span>{folders.find((folder) => folder.id === selected.folderId)?.name ?? "Library"}</span><span>/</span><strong>{selected.title}</strong></div><div className="notes-toolbar-actions"><button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button><button type="button" className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>Source</button><button type="button" className={mode === "reading" ? "active" : ""} onClick={() => setMode("reading")}>Read</button><span className="notes-toolbar-separator" /><button type="button" title="Move note" onClick={moveSelected}>Move</button><button type="button" title="Attach image or video" aria-label="Attach image or video" onClick={() => document.getElementById("notes-attachment-input")?.click()}><Icon name="plus" /></button><input id="notes-attachment-input" type="file" accept="image/*,video/*,audio/*,application/pdf" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} /><button type="button" title="Export Markdown" aria-label="Export Markdown" onClick={exportNote}><Icon name="download" /></button><button type="button" title="Move note to Trash" aria-label="Move note to Trash" onClick={trashSelected}><Icon name="trash" /></button><button type="button" title="Open linked note graph" aria-label="Open linked note graph" onClick={() => setGraphOpen(true)}><Icon name="grid" /></button><button type="button" title="Toggle inspector" aria-label="Toggle inspector" className={inspectorOpen ? "active" : ""} onClick={() => setInspectorOpen((open) => !open)}><Icon name="columns" /></button></div></div><div className="notes-title-row"><input value={selected.title} aria-label="Note title" onChange={(event) => { const title = event.target.value; setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, title } : note)); }} onBlur={() => { const latest = notes.find((note) => note.id === selected.id); if (latest) notesStore.update(latest); }} /><button type="button" className={`note-favorite ${selected.favorite ? "active" : ""}`} aria-label="Favorite note" onClick={() => { const saved = notesStore.update({ ...selected, favorite: !selected.favorite }); setNotes(notesStore.list()); setSelectedId(saved.id); }}><Icon name="star" /></button></div><div className={`notes-editor-layout ${inspectorOpen ? "with-inspector" : ""}`}>
        {mode === "reading" ? <div ref={renderedRef} className="notes-reading" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.body, currentAttachments, currentAttachmentTypes) }} /> : <div className={`notes-editor-pair ${mode === "source" ? "source-only" : ""}`}><div className="notes-editor-pane"><textarea ref={editorRef} value={selected.body} onChange={(event) => { updateBody(event.target.value); refreshSlash(event.target.value, event.target.selectionStart ?? event.target.value.length); }} onKeyDown={onEditorKeyDown} onClick={(event) => refreshSlash(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)} onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) refreshSlash(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }} spellCheck aria-label="Markdown editor" placeholder="Start writing… Type / for blocks" />{slash && slashOptions.length > 0 && <div className="notes-slash-menu" role="listbox" aria-label="Insert block" style={{ top: slashPos.top, left: slashPos.left }}>{slashOptions.map((command, index) => <button key={command.id} type="button" role="option" aria-selected={index === slashIndex} className={index === slashIndex ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashCommand(command)} onMouseEnter={() => setSlashIndex(index)}><strong>{command.label}</strong><small>{command.hint}</small></button>)}</div>}</div>{mode === "live" && <div ref={renderedRef} className="notes-preview-pane" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.body, currentAttachments, currentAttachmentTypes) }} />}</div>}
        {inspectorOpen && <aside className="notes-inspector"><div><span className="notes-inspector-label">OUTLINE</span>{headings.length ? headings.map((heading) => <button type="button" key={heading}>{heading}</button>) : <p>No headings yet</p>}</div><div><span className="notes-inspector-label">BACKLINKS</span>{backlinks.length ? backlinks.map((note) => <button type="button" key={note.id} onClick={() => selectNote(note)}>{note.title}</button>) : <p>No backlinks</p>}</div><div><span className="notes-inspector-label">DETAILS</span><p>{selected.body.trim().split(/\s+/).filter(Boolean).length} words</p><p>Edited {new Date(selected.updatedAt).toLocaleDateString()}</p></div></aside>}
      </div>{graphOpen && <NoteGraph notes={notes} selected={selected} onSelect={(note) => { selectNote(note); setGraphOpen(false); }} onClose={() => setGraphOpen(false)} />}</> : <div className="notes-empty"><div className="notes-empty-mark"><Icon name="file-text" /></div><h2>Your thinking space</h2><p>Create a note to capture an idea, plan a project, or connect a thought.</p><button type="button" className="primary-button" onClick={newNote}><Icon name="plus" />New note</button></div>}
    </div>
  </section>;
}
