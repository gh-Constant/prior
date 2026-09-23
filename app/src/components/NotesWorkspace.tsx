import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
import { NoteGlyph } from "./notes/NoteGlyph";
import { NotesInspector } from "./notes/NotesInspector";
import { countWords, extractOutline, extractTags, folderChain, foldersWithNotes, relativeTime, shortDate } from "./notes/noteInsights";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { DEFAULT_AREA_ICON, DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";
import { NOTE_FOLDER_COLORS, getFolderDescendants, getFolderPath, notesStore, type Note, type NoteAttachment, type NoteFolder } from "../lib/notes";
import { translateStored, useI18n } from "../lib/i18n";
import { applySlashInsert, filterSlashCommands, matchSlashToken, type SlashCommand } from "../lib/noteSlash";
import { Modal } from "./Modal";
import { setAccountPreference } from "../lib/accountDocuments";
import { PREFERENCES_APPLIED } from "../lib/accountPreferences";
import "./NotesWorkspace.css";
import "katex/dist/katex.min.css";

type NotesWorkspaceProps = { readonly onOpenNote?: (note: Note) => void; readonly projectId?: string };
type EditorMode = "live" | "source" | "reading";
type MobileView = "list" | "note";
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
type NoteModalState =
  | { kind: "folder-name"; mode: "create"; parentId: string | null }
  | { kind: "folder-name"; mode: "rename"; folder: NoteFolder }
  | { kind: "move-note"; note: Note }
  | { kind: "move-folder"; folder: NoteFolder }
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
    if (!url) return `<span class="note-attachment-pending">${translateStored("notes.render.attachmentUnavailable")}</span>`;
    const attachmentId = rawUrl.startsWith("attachment://") ? rawUrl.slice(13) : "";
    const mime = attachmentTypes[attachmentId] ?? "";
    if (mime.startsWith("video/")) return `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
    if (mime.startsWith("audio/")) return `<audio src="${escapeHtml(url)}" controls></audio>`;
    if (mime === "application/pdf") return `<a class="note-file-attachment" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${translateStored("notes.render.openFile", { name: escapeHtml(alt) })}</a>`;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  });
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => `<a href="${escapeHtml(safeUrl(rawUrl))}" target="_blank" rel="noreferrer">${label}</a>`);
  output = output.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alt?: string) => {
    const url = target.startsWith("attachment:") ? attachments[target.slice(11)] : attachments[target];
    const mime = attachmentTypes[target] ?? "";
    if (!url) return `<span class="note-attachment-pending">${translateStored("notes.render.notAvailable", { name: escapeHtml(target) })}</span>`;
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
  output = output.replace(/\$\$([^$\n]+)\$\$/g, (_match, tex) => `<span class="note-math note-math-display" data-tex="${tex}">${tex}</span>`);
  output = output.replace(/\$([^$\n]+)\$/g, (_match, tex) => `<span class="note-math" data-tex="${tex}">${tex}</span>`);
  return output;
}

export function renderMarkdown(source: string, attachments: Record<string, string>, attachmentTypes: Record<string, string>): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let language = "";
  let code: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let quote: string[] | null = null;
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
  const codeBlock = (lang: string, body: string) => `<pre class="note-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(body)}</code></pre>`;
  // Consecutive "> " lines form one quote; a leading "[!type] Title" turns it into a callout.
  const closeQuote = () => {
    if (!quote) return;
    const quoteLines = quote;
    quote = null;
    const callout = quoteLines[0]?.match(/^\[!([a-zA-Z-]+)\][+-]?\s*(.*)$/);
    const paragraphs = (callout ? quoteLines.slice(1) : quoteLines).filter((item) => item.trim()).map((item) => `<p>${inlineMarkdown(item, attachments, attachmentTypes)}</p>`).join("");
    if (!callout) { html.push(`<blockquote>${paragraphs}</blockquote>`); return; }
    const kind = callout[1].toLowerCase();
    const title = callout[2].trim();
    html.push(`<div class="note-callout" data-callout="${escapeHtml(kind)}">${title ? `<p class="note-callout-title">${inlineMarkdown(title, attachments, attachmentTypes)}</p>` : ""}${paragraphs}</div>`);
  };
  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (inCode) {
        if (language.toLowerCase() === "mermaid") html.push(`<div class="note-diagram"><span>${translateStored("notes.render.mermaid")}</span><pre>${escapeHtml(code.join("\n"))}</pre></div>`);
        else html.push(codeBlock(language, code.join("\n")));
        inCode = false; code = []; language = "";
      } else { closeList(); closeQuote(); inCode = true; language = fence[1].trim(); }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (/^>/.test(line)) { closeList(); (quote ??= []).push(line.replace(/^>\s?/, "")); continue; }
    closeQuote();
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
    if (/^---+$/.test(line.trim())) { closeList(); html.push("<hr />"); continue; }
    closeList();
    html.push(`<p>${inlineMarkdown(line, attachments, attachmentTypes)}</p>`);
  }
  if (inCode) html.push(codeBlock(language, code.join("\n")));
  closeQuote();
  closeList();
  return html.join("");
}

function folderChildren(folders: NoteFolder[], parentId: string | null): NoteFolder[] { return folders.filter((folder) => folder.parentId === parentId); }

function folderIconFallback(folder: NoteFolder): IconName {
  if (folder.workspaceKind === "area") return DEFAULT_AREA_ICON;
  if (folder.workspaceKind === "project") return DEFAULT_PROJECT_ICON;
  return "folder";
}

/** Vertical offset of the caret at `pos` inside the textarea's content box, in pixels. */
function caretOffsetTop(textarea: HTMLTextAreaElement, pos: number): number {
  const mirror = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  for (const property of ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "whiteSpace", "wordWrap", "overflowWrap", "tabSize"] as const) {
    mirror.style[property] = style[property];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  document.body.removeChild(mirror);
  return top;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isCompactViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])"));
}

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

type TreeHandlers = {
  onSelect: (note: Note) => void;
  onToggleCollapse: (id: string) => void;
  onRenameFolder: (folder: NoteFolder) => void;
  onOpenFolderMenu: (event: React.MouseEvent, folder: NoteFolder) => void;
  onOpenNoteMenu: (event: React.MouseEvent, note: Note) => void;
  onOpenFolderEmptyMenu: (event: React.MouseEvent, folderId: string | null) => void;
};

/** Enter/Space toggles a folder row; Right expands and Left collapses, like a native tree. */
function treeRowKeyDown(event: React.KeyboardEvent<HTMLElement>, isCollapsed: boolean, toggle: () => void): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  else if (event.key === "ArrowRight" && isCollapsed) { event.preventDefault(); toggle(); }
  else if (event.key === "ArrowLeft" && !isCollapsed) { event.preventDefault(); toggle(); }
}

function NoteRow({ note, depth, selected, showFavorite, onSelect, onOpenNoteMenu }: { note: Note; depth: number; selected: boolean; showFavorite?: boolean; onSelect: (note: Note) => void; onOpenNoteMenu: (event: React.MouseEvent, note: Note) => void }) {
  return (
    <button
      type="button"
      className={`note-file-row ${selected ? "active" : ""}`}
      style={{ "--depth": depth } as CSSProperties}
      aria-current={selected ? "page" : undefined}
      onClick={() => onSelect(note)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNoteMenu(event, note);
      }}
    >
      <span className="note-tree-chevron" aria-hidden="true" />
      <span className="note-file-icon">{showFavorite ? <Icon name="star" /> : <Icon name="file" />}</span>
      <span className="note-row-label">{note.title}</span>
      {!showFavorite && note.favorite && <span className="note-row-favorite" aria-hidden="true"><Icon name="star" /></span>}
    </button>
  );
}

function FolderTree({
  folders,
  notes,
  parentId,
  depth,
  selectedId,
  collapsedIds,
  visibleFolderIds,
  ...handlers
}: {
  folders: NoteFolder[];
  notes: Note[];
  parentId: string | null;
  depth: number;
  selectedId: string | null;
  collapsedIds: Set<string>;
  /** When set (while searching), only these folders are shown. */
  visibleFolderIds: Set<string> | null;
} & TreeHandlers) {
  const { onSelect, onToggleCollapse, onRenameFolder, onOpenFolderMenu, onOpenNoteMenu, onOpenFolderEmptyMenu } = handlers;
  const children = folderChildren(folders, parentId).filter((folder) => !visibleFolderIds || visibleFolderIds.has(folder.id));
  const notesInFolder = notes.filter((note) => note.folderId === parentId);
  return (
    <>
      {children.map((folder) => {
        // A search expands every matching branch so results are never hidden behind a collapsed folder.
        const isCollapsed = !visibleFolderIds && collapsedIds.has(folder.id);
        return (
          <div
            className="note-folder-group"
            key={folder.id}
            role="group"
            style={folder.color ? ({ "--folder-color": folder.color } as CSSProperties) : undefined}
          >
            <div
              className={`note-folder-row ${folder.workspaceKind ? "workspace-folder" : ""}`}
              style={{ "--depth": depth } as CSSProperties}
              role="treeitem"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onClick={() => onToggleCollapse(folder.id)}
              onKeyDown={(event) => treeRowKeyDown(event, isCollapsed, () => onToggleCollapse(folder.id))}
              onDoubleClick={() => { if (!folder.workspaceKind) onRenameFolder(folder); }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenFolderMenu(event, folder);
              }}
            >
              <span className="note-tree-chevron" aria-hidden="true"><Icon name={isCollapsed ? "chevron-right" : "chevron-down"} /></span>
              <span className="note-folder-icon" style={folder.color ? { color: folder.color } : undefined}>
                <WorkspaceIcon icon={folder.icon} fallback={folderIconFallback(folder)} />
              </span>
              <span className="note-row-label">{folder.name}</span>
            </div>
            {!isCollapsed && (
              <div
                className="note-folder-children"
                data-folder-id={folder.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenFolderEmptyMenu(event, folder.id);
                }}
              >
                <FolderTree
                  folders={folders}
                  notes={notes}
                  parentId={folder.id}
                  depth={depth + 1}
                  selectedId={selectedId}
                  collapsedIds={collapsedIds}
                  visibleFolderIds={visibleFolderIds}
                  {...handlers}
                />
              </div>
            )}
          </div>
        );
      })}
      {notesInFolder.map((note) => (
        <NoteRow key={note.id} note={note} depth={depth} selected={selectedId === note.id} onSelect={onSelect} onOpenNoteMenu={onOpenNoteMenu} />
      ))}
    </>
  );
}

function FolderNameModal({
  title,
  initialName,
  initialColor,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName: string;
  initialColor: string | null;
  submitLabel: string;
  onSubmit: (name: string, color: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string | null>(initialColor);
  const canSubmit = name.trim().length > 0;
  const { t } = useI18n();

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="prior-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit(name.trim(), color);
        }}
      >
        <label className="prior-modal-field">
          <span>{t("notes.folderModal.nameLabel")}</span>
          <input
            className="prior-modal-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("notes.folderModal.namePlaceholder")}
            autoFocus
            maxLength={60}
          />
        </label>
        <div className="prior-modal-field">
          <span>{t("notes.folderModal.colorLabel")}</span>
          <div className="note-color-grid">
            <button
              type="button"
              className={`note-color-swatch none ${color === null ? "active" : ""}`}
              aria-label={t("notes.common.noColor")}
              title={t("notes.common.noColor")}
              onClick={() => setColor(null)}
            />
            {NOTE_FOLDER_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`note-color-swatch ${color === option.value ? "active" : ""}`}
                style={{ background: option.value }}
                aria-label={option.name}
                title={option.name}
                onClick={() => setColor(option.value)}
              />
            ))}
          </div>
        </div>
        <div className="prior-modal-actions">
          <button type="button" className="prior-modal-button-secondary" onClick={onClose}>
            {t("notes.common.cancel")}
          </button>
          <button type="submit" className="prior-modal-button-primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveNoteModal({
  note,
  folders,
  onMove,
  onClose,
}: {
  note: Note;
  folders: NoteFolder[];
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(note.folderId);
  const { t } = useI18n();
  const folderOptions = useMemo(() => {
    return folders
      .map((f) => ({ folder: f, path: getFolderPath(f.id, folders) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [folders]);

  return (
    <Modal title={t("notes.moveNote.title", { title: note.title })} onClose={onClose}>
      <form
        className="prior-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onMove(target);
        }}
      >
        {note.projectId && (
          <div className="note-move-project-badge">
            <Icon name="folder" />
            <span>{t("notes.moveNote.projectBadge")}</span>
          </div>
        )}
        <div className="note-move-list" role="radiogroup" aria-label={t("notes.move.destination")}>
          <label className={target === null ? "active" : ""}>
            <input
              type="radio"
              name="destination"
              checked={target === null}
              onChange={() => setTarget(null)}
            />
            <Icon name="folder" />
            <span>{t("notes.common.library")}</span>
          </label>
          {folderOptions.map(({ folder, path }) => (
            <label key={folder.id} className={target === folder.id ? "active" : ""}>
              <input
                type="radio"
                name="destination"
                checked={target === folder.id}
                onChange={() => setTarget(folder.id)}
              />
              <span
                className="note-folder-icon"
                style={folder.color ? { color: folder.color } : undefined}
              >
                <WorkspaceIcon icon={folder.icon} fallback={folderIconFallback(folder)} />
              </span>
              <span>{path}</span>
            </label>
          ))}
        </div>
        <div className="prior-modal-actions">
          <button type="button" className="prior-modal-button-secondary" onClick={onClose}>
            {t("notes.common.cancel")}
          </button>
          <button type="submit" className="prior-modal-button-primary">
            {t("notes.moveNote.move")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveFolderModal({
  folder,
  folders,
  onMove,
  onClose,
}: {
  folder: NoteFolder;
  folders: NoteFolder[];
  onMove: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(folder.parentId);
  const { t } = useI18n();
  const descendants = useMemo(() => getFolderDescendants(folder.id, folders), [folder.id, folders]);

  const validFolders = useMemo(() => {
    return folders
      .filter((f) => f.id !== folder.id && !descendants.has(f.id))
      .map((f) => ({ folder: f, path: getFolderPath(f.id, folders) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [folders, folder.id, descendants]);

  return (
    <Modal title={t("notes.moveFolder.title", { name: folder.name })} onClose={onClose}>
      <form
        className="prior-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onMove(target);
        }}
      >
        <div className="note-move-list" role="radiogroup" aria-label={t("notes.move.destination")}>
          <label className={target === null ? "active" : ""}>
            <input
              type="radio"
              name="destination"
              checked={target === null}
              onChange={() => setTarget(null)}
            />
            <Icon name="folder" />
            <span>{t("notes.moveFolder.topLevel")}</span>
          </label>
          {validFolders.map(({ folder: item, path }) => (
            <label key={item.id} className={target === item.id ? "active" : ""}>
              <input
                type="radio"
                name="destination"
                checked={target === item.id}
                onChange={() => setTarget(item.id)}
              />
              <span
                className="note-folder-icon"
                style={item.color ? { color: item.color } : undefined}
              >
                <WorkspaceIcon icon={item.icon} fallback={folderIconFallback(item)} />
              </span>
              <span>{path}</span>
            </label>
          ))}
        </div>
        <div className="prior-modal-actions">
          <button type="button" className="prior-modal-button-secondary" onClick={onClose}>
            {t("notes.common.cancel")}
          </button>
          <button type="submit" className="prior-modal-button-primary">
            {t("notes.moveFolder.move")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="prior-modal-body">
        <p className="note-modal-message" style={{ margin: "0 0 16px" }}>{message}</p>
        <div className="prior-modal-actions">
          <button type="button" className="prior-modal-button-secondary" onClick={onClose}>
            {t("notes.common.cancel")}
          </button>
          <button type="button" className="note-modal-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FolderColorModal({
  folder,
  onPick,
  onClose,
}: {
  folder: NoteFolder;
  onPick: (color: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t("notes.colorModal.title", { name: folder.name })} onClose={onClose}>
      <div className="prior-modal-body">
        <div className="note-color-grid large">
          <button
            type="button"
            className={`note-color-swatch none ${folder.color === null ? "active" : ""}`}
            aria-label={t("notes.common.noColor")}
            title={t("notes.common.noColor")}
            onClick={() => {
              onPick(null);
              onClose();
            }}
          />
          {NOTE_FOLDER_COLORS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`note-color-swatch ${folder.color === option.value ? "active" : ""}`}
              style={{ background: option.value }}
              aria-label={option.name}
              title={option.name}
              onClick={() => {
                onPick(option.value);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NoteGraph({ notes, selected, onSelect, onClose }: { notes: Note[]; selected: Note | null; onSelect: (note: Note) => void; onClose: () => void }) {
  const { t } = useI18n();
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
  return <div className="notes-graph-overlay" role="dialog" aria-label={t("notes.graph.label")}><div className="notes-graph-card"><div className="notes-graph-header"><div><span className="notes-eyebrow">{t("notes.graph.eyebrow")}</span><h2>{t("notes.graph.title")}</h2></div><button type="button" className="notes-icon-button" aria-label={t("notes.graph.close")} onClick={onClose}><Icon name="close" /></button></div><svg viewBox="0 0 460 380" role="img" aria-label={t("notes.graph.imageLabel")}>{edges.map(([from, to]) => { const start = positions.get(from); const end = positions.get(to); return start && end ? <line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} /> : null; })}{nodes.map((note) => { const position = positions.get(note.id); if (!position) return null; return <g key={note.id} className={note.id === selected?.id ? "selected" : ""} tabIndex={0} role="button" aria-label={note.title} onClick={() => onSelect(note)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(note); }}><circle cx={position.x} cy={position.y} r={note.id === selected?.id ? 16 : 11} /><text x={position.x} y={position.y + 32} textAnchor="middle">{note.title.length > 20 ? `${note.title.slice(0, 18)}…` : note.title}</text></g>; })}</svg><p className="notes-graph-help">{t("notes.graph.help", { example: "[[double brackets]]" })}</p></div></div>;
}

export function NotesWorkspace({ onOpenNote, projectId }: NotesWorkspaceProps) {
  const { t, tp, lang } = useI18n();
  const scopedNotes = () => notesStore.list().filter((note) => projectId ? note.projectId === projectId : true);
  const [notes, setNotes] = useState<Note[]>(scopedNotes);
  const [folders, setFolders] = useState<NoteFolder[]>(() => notesStore.listFolders());
  const [selectedId, setSelectedId] = useState<string | null>(() => scopedNotes()[0]?.id ?? null);
  const [openIds, setOpenIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("prior.notes.tabs") ?? "[]") as string[]; } catch { return []; } });
  // "Write" maps to the source editor (optionally with the side-by-side preview), "Read" to the rendered note.
  const [reading, setReading] = useState(true);
  const [splitPreview, setSplitPreview] = useState(false);
  const mode: EditorMode = reading ? "reading" : splitPreview ? "live" : "source";
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(() => { try { return localStorage.getItem("prior.notes.library") !== "false"; } catch { return true; } });
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [graphOpen, setGraphOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem("prior.notes.collapsed") ?? "[]") as string[]); } catch { return new Set<string>(); } });
  const [modal, setModal] = useState<NoteModalState>(null);
  const { menu, openMenu: showMenu, closeMenu } = useContextMenu();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const renderedRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const projectFolder = projectId ? folders.find((folder) => folder.workspaceKind === "project" && folder.workspaceId === projectId) ?? null : null;
  const visibleFolders = useMemo(() => {
    if (!projectId || !projectFolder) return folders;
    const allowed = new Set([projectFolder.id]);
    if (projectFolder.parentId) allowed.add(projectFolder.parentId);
    return folders.filter((folder) => allowed.has(folder.id));
  }, [folders, projectFolder, projectId]);

  useEffect(() => notesStore.subscribe(() => { setNotes(scopedNotes()); setFolders(notesStore.listFolders()); }), [projectId]);
  useEffect(() => { const next = scopedNotes(); setNotes(next); setSelectedId(next[0]?.id ?? null); setOpenIds((current) => current.filter((id) => next.some((note) => note.id === id))); setFolderFilter(null); setQuery(""); }, [projectId]);
  useEffect(() => { const handler = () => newNote(); window.addEventListener("prior-notes-new", handler); return () => window.removeEventListener("prior-notes-new", handler); });
  useEffect(() => { if (!notes.some((note) => note.id === selectedId)) setSelectedId(notes[0]?.id ?? null); if (!openIds.length && notes[0]) { setOpenIds([notes[0].id]); setSelectedId(notes[0].id); } }, [notes, openIds.length, selectedId]);
  useEffect(() => { try { localStorage.setItem("prior.notes.tabs", JSON.stringify(openIds)); } catch { /* storage unavailable */ } }, [openIds]);
  useEffect(() => { try { localStorage.setItem("prior.notes.library", String(libraryOpen)); } catch { /* storage unavailable */ } }, [libraryOpen]);
  useEffect(() => { try { localStorage.setItem("prior.notes.collapsed", JSON.stringify([...collapsedIds])); } catch { /* storage unavailable */ } }, [collapsedIds]);
  const previousPreferences = useRef({ tabs: JSON.stringify(openIds), library: String(libraryOpen), collapsed: JSON.stringify([...collapsedIds]) });
  useEffect(() => {
    const next = { tabs: JSON.stringify(openIds), library: String(libraryOpen), collapsed: JSON.stringify([...collapsedIds]) };
    const patch: Record<string, string> = {};
    for (const key of ["tabs", "library", "collapsed"] as const) if (next[key] !== previousPreferences.current[key]) patch[`prior.notes.${key}`] = next[key];
    previousPreferences.current = next;
    if (Object.keys(patch).length) setAccountPreference("ui", patch);
  }, [openIds, libraryOpen, collapsedIds]);
  useEffect(() => {
    const apply = () => {
      try {
        const tabs: unknown = JSON.parse(localStorage.getItem("prior.notes.tabs") ?? "[]");
        const collapsed: unknown = JSON.parse(localStorage.getItem("prior.notes.collapsed") ?? "[]");
        if (Array.isArray(tabs)) setOpenIds(tabs.filter((id): id is string => typeof id === "string"));
        if (Array.isArray(collapsed)) setCollapsedIds(new Set(collapsed.filter((id): id is string => typeof id === "string")));
        setLibraryOpen(localStorage.getItem("prior.notes.library") !== "false");
      } catch { console.warn("Note view preferences could not be loaded."); }
    };
    window.addEventListener(PREFERENCES_APPLIED, apply);
    return () => window.removeEventListener(PREFERENCES_APPLIED, apply);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const urls = new Set<string>();
    const requested = new Set<string>();
    const refreshAttachments = () => {
      for (const meta of notesStore.attachmentMeta()) {
        if (requested.has(meta.id)) continue;
        requested.add(meta.id);
        void notesStore.loadAttachment(meta.id).then((blob) => {
          if (!blob) requested.delete(meta.id);
          if (!cancelled && blob) setAttachmentUrls((current) => {
            if (current[meta.id]) return current;
            const url = URL.createObjectURL(blob); urls.add(url);
            return { ...current, [meta.id]: url };
          });
        }).catch(() => { requested.delete(meta.id); console.warn("Note attachment unavailable; retrying on the next sync."); });
      }
    };
    refreshAttachments();
    const unsubscribe = notesStore.subscribe(refreshAttachments);
    return () => { cancelled = true; unsubscribe(); for (const url of urls) URL.revokeObjectURL(url); if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, []);
  // Keeps "Modified 2 min ago" honest without re-rendering on every second.
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  // "/" jumps to the note search from anywhere outside a text field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || modal || menu || graphOpen) return;
      event.preventDefault();
      setLibraryOpen(true);
      setMobileView("list");
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graphOpen, menu, modal]);

  const visibleNotes = useMemo(() => notes.filter((note) => (!folderFilter || folderFilter === "favorites" || note.folderId === folderFilter) && (!query.trim() || `${note.title} ${note.body}`.toLowerCase().includes(query.trim().toLowerCase()))), [folderFilter, notes, query]);
  const searching = query.trim().length > 0;
  const matchingFolderIds = useMemo(() => searching ? foldersWithNotes(visibleNotes, visibleFolders) : null, [searching, visibleFolders, visibleNotes]);
  const favoriteNotes = useMemo(() => visibleNotes.filter((note) => note.favorite), [visibleNotes]);
  const currentAttachments = useMemo(() => Object.fromEntries(notesStore.attachmentMeta().map((item) => [item.id, attachmentUrls[item.id] ?? ""])), [attachmentUrls]);
  const currentAttachmentTypes = useMemo(() => Object.fromEntries(notesStore.attachmentMeta().map((item) => [item.id, item.type])), [attachmentUrls]);
  const outline = useMemo(() => selected ? extractOutline(selected.body) : [], [selected?.body]);
  const tags = useMemo(() => selected ? extractTags(selected.body) : [], [selected?.body]);
  const renderedHtml = useMemo(() => selected ? renderMarkdown(selected.body, currentAttachments, currentAttachmentTypes) : "", [selected?.body, currentAttachments, currentAttachmentTypes]);
  const breadcrumb = useMemo(() => selected ? folderChain(selected.folderId, folders) : [], [folders, selected?.folderId]);
  const folderLabel = breadcrumb.map((folder) => folder.name).join(" / ") || t("notes.common.library");
  const projectLabel = selected?.projectId ? folders.find((folder) => folder.workspaceKind === "project" && folder.workspaceId === selected.projectId)?.name ?? null : null;
  const effectiveMobileView: MobileView = selected ? mobileView : "list";

  useEffect(() => { setActiveHeading(0); }, [selected?.id]);

  useEffect(() => {
    if (!renderedRef.current || !selected || mode === "source") return undefined;
    let cancelled = false;
    void Promise.all([import("mermaid"), import("katex")]).then(async ([mermaidModule, katexModule]) => {
      if (cancelled || !renderedRef.current) return;
      const mermaid = mermaidModule.default;
      const katex = katexModule.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          fontFamily: "\"DM Sans Variable\", -apple-system, \"Segoe UI\", sans-serif",
          fontSize: "13px",
          primaryColor: "#ffffff",
          primaryBorderColor: "#dcdad5",
          primaryTextColor: "#1d1c1a",
          secondaryColor: "#f6f6f4",
          tertiaryColor: "#fafaf9",
          lineColor: "#9d9a93",
          textColor: "#3f3d39",
        },
      });
      const diagrams = Array.from(renderedRef.current.querySelectorAll<HTMLElement>(".note-diagram pre"));
      await Promise.all(diagrams.map(async (pre, index) => {
        const source = pre.textContent ?? "";
        try {
          const rendered = await mermaid.render(`prior-note-diagram-${selected.id}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "-"), source);
          if (!cancelled && pre.parentElement) pre.parentElement.innerHTML = `<span>${translateStored("notes.render.mermaid")}</span>${rendered.svg}`;
        } catch {
          if (!cancelled && pre.parentElement) {
            pre.parentElement.classList.add("has-error");
            pre.parentElement.setAttribute("data-error", translateStored("notes.workspace.diagramError"));
          }
        }
      }));
      if (!cancelled && renderedRef.current) {
        renderedRef.current.querySelectorAll<HTMLElement>(".note-math:not([data-rendered])").forEach((element) => {
          const rawTex = element.getAttribute("data-tex") ?? element.textContent ?? "";
          try {
            katex.render(rawTex, element, {
              displayMode: element.classList.contains("note-math-display"),
              throwOnError: false,
            });
            element.setAttribute("data-rendered", "true");
          } catch {
            element.classList.add("has-error");
            element.setAttribute("data-rendered", "true");
          }
        });
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentAttachments, mode, selected?.id, selected?.body]);

  // The editor grows with its content so the title, meta and body scroll as one document.
  function fitEditor(): void {
    const textarea = editorRef.current;
    if (!textarea) return;
    const container = scrollRef.current;
    const containerTop = container?.scrollTop ?? 0;
    const windowTop = window.scrollY;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    if (container) container.scrollTop = containerTop;
    if (window.scrollY !== windowTop) window.scrollTo(0, windowTop);
  }
  useLayoutEffect(fitEditor, [selected?.id, selected?.body, mode]);
  useEffect(() => { window.addEventListener("resize", fitEditor); return () => window.removeEventListener("resize", fitEditor); });

  function selectNote(note: Note): void {
    setSelectedId(note.id);
    setOpenIds((current) => current.includes(note.id) ? current : [...current, note.id]);
    setMobileView("note");
    if (isCompactViewport()) setReading(true);
    onOpenNote?.(note);
  }
  function createNoteIn(folderId: string | null): void {
    const note = notesStore.create(projectId ? t("notes.editor.untitledProject") : t("notes.editor.untitled"), folderId, projectId ?? null);
    setNotes(scopedNotes());
    selectNote(note);
    setReading(false);
    requestAnimationFrame(() => titleRef.current?.select());
  }
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
  function toggleFavorite(note: Note): void { notesStore.update({ ...note, favorite: !note.favorite }); setNotes(scopedNotes()); }
  function doTrashNote(note: Note): void { notesStore.trash(note.id); const remaining = scopedNotes(); setOpenIds((current) => current.filter((id) => id !== note.id)); if (selectedId === note.id) { setSelectedId(remaining.find((item) => item.id !== note.id)?.id ?? null); setMobileView("list"); } setNotes(remaining); setModal(null); }
  function doDeleteFolder(folder: NoteFolder): void {
    notesStore.deleteFolder(folder.id);
    setFolders(notesStore.listFolders());
    setNotes(scopedNotes());
    if (folderFilter === folder.id) setFolderFilter(null);
    setCollapsedIds((current) => { const next = new Set(current); next.delete(folder.id); return next; });
    setModal(null);
  }
  function moveSelected(): void { if (selected) setModal({ kind: "move-note", note: selected }); }
  function trashSelected(): void { if (selected) setModal({ kind: "confirm-note-delete", note: selected }); }
  function openMenu(event: React.MouseEvent, items: ContextMenuItem[]): void {
    showMenu(event, items);
  }
  function openFolderMenu(event: React.MouseEvent, folder: NoteFolder): void {
    const items: ContextMenuItem[] = [
      { icon: "file-plus", label: t("notes.menu.newNoteHere"), run: () => createNoteIn(folder.id) },
    ];
    if (!folder.workspaceKind) items.push(
      { icon: "folder-plus", label: t("notes.menu.newSubfolderHere"), run: () => newFolder(folder.id) },
      { icon: "folder", label: t("notes.menu.moveFolderTo"), run: () => setModal({ kind: "move-folder", folder }) },
      { icon: "pencil", label: t("notes.common.rename"), run: () => renameFolder(folder) },
      { icon: "palette", label: t("notes.menu.setColor"), run: () => setModal({ kind: "folder-color", folder }) },
      { icon: "trash", label: t("notes.menu.deleteFolder"), danger: true, run: () => setModal({ kind: "confirm-folder-delete", folder }) },
    );
    openMenu(event, items);
  }
  function openNoteMenu(event: React.MouseEvent, note: Note): void {
    openMenu(event, [
      { icon: "file", label: t("notes.menu.open"), run: () => selectNote(note) },
      { icon: "star", label: note.favorite ? t("notes.menu.removeFromFavorites") : t("notes.menu.addToFavorites"), run: () => toggleFavorite(note) },
      { icon: "folder", label: t("notes.menu.moveTo"), run: () => setModal({ kind: "move-note", note }) },
      { icon: "trash", label: t("notes.menu.deleteNote"), danger: true, run: () => setModal({ kind: "confirm-note-delete", note }) },
    ]);
  }
  function openFolderEmptyMenu(event: React.MouseEvent, folderId: string | null): void {
    openMenu(event, [
      { icon: "file-plus", label: t("notes.menu.newNoteHere"), run: () => createNoteIn(folderId) },
      { icon: "folder-plus", label: t("notes.menu.newFolderHere"), run: () => newFolder(folderId) },
    ]);
  }
  /** The toolbar's overflow menu, anchored under its trigger so keyboard activation opens it in place too. */
  function openMoreMenu(event: React.MouseEvent<HTMLButtonElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    showMenu({ clientX: rect.right - 232, clientY: rect.bottom + 6, target: null, preventDefault: () => undefined }, [
      { icon: "columns", label: splitPreview ? t("notes.workspace.hideSplit") : t("notes.workspace.showSplit"), run: () => { setSplitPreview((value) => !value); setReading(false); } },
      { icon: "folder", label: t("notes.menu.moveTo"), run: moveSelected },
      { icon: "plus", label: t("notes.toolbar.attach"), run: () => attachmentInputRef.current?.click() },
      { icon: "download", label: t("notes.toolbar.export"), run: exportNote },
      { icon: "trash", label: t("notes.menu.deleteNote"), danger: true, run: trashSelected },
    ]);
  }
  function updateBody(body: string): void {
    if (!selected) return;
    setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, body, updatedAt: new Date().toISOString() } : note));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { const latest = notesStore.list().find((note) => note.id === selected.id); if (latest) notesStore.update({ ...latest, body }); }, 450);
  }
  function commitTitle(): void { if (!selected) return; const latest = notes.find((note) => note.id === selected.id); if (latest) notesStore.update(latest); }
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
  function searchFor(value: string): void {
    setQuery(value);
    setFolderFilter(null);
    setLibraryOpen(true);
    setMobileView("list");
  }
  function onRenderedClick(event: React.MouseEvent<HTMLDivElement>): void {
    const element = event.target as HTMLElement;
    const tag = element.closest<HTMLElement>(".note-tag");
    if (tag?.textContent) { searchFor(tag.textContent); return; }
    const target = element.closest<HTMLElement>("[data-note]");
    if (!target) return;
    const linked = notes.find((note) => note.title.toLowerCase() === target.dataset.note?.toLowerCase());
    if (linked) selectNote(linked);
    else { const created = notesStore.create(target.dataset.note ?? t("notes.editor.untitled"), selected?.folderId ?? null, projectId ?? null); setNotes(scopedNotes()); selectNote(created); }
  }
  /** Outline highlight follows the reading position: the last heading scrolled past the top. */
  function syncActiveHeading(): void {
    const container = scrollRef.current;
    const rendered = renderedRef.current;
    if (!container || !rendered || mode === "source" || !outline.length) return;
    const threshold = container.getBoundingClientRect().top + 72;
    let index = 0;
    rendered.querySelectorAll<HTMLElement>(HEADING_SELECTOR).forEach((heading, headingIndex) => { if (heading.getBoundingClientRect().top <= threshold) index = headingIndex; });
    setActiveHeading(index);
  }
  function syncActiveHeadingFromCaret(textarea: HTMLTextAreaElement): void {
    if (!outline.length) return;
    const caretLine = textarea.value.slice(0, textarea.selectionStart ?? 0).split("\n").length - 1;
    let index = 0;
    outline.forEach((heading, headingIndex) => { if (heading.line <= caretLine) index = headingIndex; });
    setActiveHeading(index);
  }
  function jumpToHeading(index: number): void {
    const heading = outline[index];
    if (!heading || !selected) return;
    setActiveHeading(index);
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (mode !== "source" && renderedRef.current) {
      renderedRef.current.querySelectorAll<HTMLElement>(HEADING_SELECTOR)[index]?.scrollIntoView?.({ block: "start", behavior });
      return;
    }
    const textarea = editorRef.current;
    if (!textarea) return;
    const offset = textarea.value.split("\n").slice(0, heading.line).reduce((sum, line) => sum + line.length + 1, 0);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(offset, offset);
    const container = scrollRef.current;
    if (container && typeof container.scrollTo === "function") {
      const top = textarea.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop + caretOffsetTop(textarea, offset) - 24;
      container.scrollTo({ top: Math.max(0, top), behavior });
    }
  }

  const relative = selected ? relativeTime(selected.updatedAt, lang, now) : null;
  const modifiedLabel = selected ? (relative ? t("notes.workspace.modified", { time: relative }) : t("notes.workspace.modifiedOn", { date: shortDate(selected.updatedAt, lang, now) })) : "";
  const favoriteLabel = selected?.favorite ? t("notes.menu.removeFromFavorites") : t("notes.menu.addToFavorites");
  const rootCollapsed = !searching && collapsedIds.has(LIBRARY_ROOT_ID);
  const treeHandlers = { onSelect: selectNote, onToggleCollapse: toggleCollapse, onRenameFolder: renameFolder, onOpenFolderMenu: openFolderMenu, onOpenNoteMenu: openNoteMenu, onOpenFolderEmptyMenu: openFolderEmptyMenu };
  const treeEmpty = folderFilter === "favorites" ? favoriteNotes.length === 0 : searching && visibleNotes.length === 0;

  return <section
    className={`notes-workspace ${libraryOpen ? "" : "library-collapsed"} ${inspectorOpen && selected ? "with-inspector" : ""}`}
    data-mobile-view={effectiveMobileView}
    aria-label={t("notes.section.label")}
  >
    <aside className="notes-explorer" aria-label={t("notes.library.title")}>
      <div className="notes-explorer-header">
        <h2>{projectFolder?.name ?? t("notes.library.title")}</h2>
        <div className="notes-explorer-header-actions">
          <button type="button" className="notes-icon-button" title={t("notes.workspace.graph")} aria-label={t("notes.workspace.graph")} disabled={!selected} onClick={() => setGraphOpen(true)}><NoteGlyph name="graph" /></button>
          <button type="button" className="notes-icon-button bordered" title={t("notes.common.newNote")} aria-label={t("notes.common.newNote")} onClick={newNote}><Icon name="plus" /></button>
        </div>
      </div>
      <label className="notes-search">
        <Icon name="search" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } else if (event.key === "Escape") event.currentTarget.blur(); }}
          placeholder={t("notes.workspace.search")}
          aria-label={t("notes.library.search")}
          aria-keyshortcuts="/"
          enterKeyHint="search"
        />
        {query
          ? <button type="button" className="notes-search-clear" aria-label={t("notes.workspace.clearSearch")} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><Icon name="close" /></button>
          : <kbd className="notes-kbd" aria-hidden="true">/</kbd>}
      </label>
      <div className="notes-segmented notes-explorer-filter" role="group" aria-label={t("notes.workspace.filterLabel")}>
        <button type="button" aria-pressed={folderFilter !== "favorites"} className={folderFilter !== "favorites" ? "active" : ""} onClick={() => setFolderFilter(null)}>{t("notes.workspace.all")}</button>
        <button type="button" aria-pressed={folderFilter === "favorites"} className={folderFilter === "favorites" ? "active" : ""} onClick={() => setFolderFilter("favorites")}><Icon name="star" />{t("notes.library.favorites")}</button>
      </div>
      <div
        className="notes-tree"
        role="tree"
        aria-label={t("notes.common.library")}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openFolderEmptyMenu(event, null);
        }}
      >
        {folderFilter === "favorites" ? (
          favoriteNotes.map((note) => <NoteRow key={note.id} note={note} depth={0} selected={selectedId === note.id} showFavorite onSelect={selectNote} onOpenNoteMenu={openNoteMenu} />)
        ) : (
          <>
            <div
              className="note-folder-row root"
              style={{ "--depth": 0 } as CSSProperties}
              role="treeitem"
              tabIndex={0}
              aria-expanded={!rootCollapsed}
              onClick={() => toggleCollapse(LIBRARY_ROOT_ID)}
              onKeyDown={(event) => treeRowKeyDown(event, rootCollapsed, () => toggleCollapse(LIBRARY_ROOT_ID))}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openFolderEmptyMenu(event, null);
              }}
            >
              <span className="note-tree-chevron" aria-hidden="true"><Icon name={rootCollapsed ? "chevron-right" : "chevron-down"} /></span>
              <span className="note-folder-icon"><Icon name="folder" /></span>
              <span className="note-row-label">{t("notes.common.library")}</span>
              <button
                type="button"
                className="note-row-action"
                aria-label={t("notes.common.newFolder")}
                title={t("notes.common.newFolder")}
                onClick={(event) => {
                  event.stopPropagation();
                  newFolder(null);
                }}
              >
                <Icon name="plus" />
              </button>
            </div>
            {!rootCollapsed && (
              <div
                className="note-folder-children root-children"
                role="group"
                data-folder-id=""
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openFolderEmptyMenu(event, null);
                }}
              >
                <FolderTree
                  folders={visibleFolders}
                  notes={visibleNotes}
                  parentId={null}
                  depth={1}
                  selectedId={selectedId}
                  collapsedIds={collapsedIds}
                  visibleFolderIds={matchingFolderIds}
                  {...treeHandlers}
                />
              </div>
            )}
          </>
        )}
        {treeEmpty && <p className="notes-tree-empty">{searching ? t("notes.workspace.noResults", { query: query.trim() }) : t("notes.workspace.noFavorites")}</p>}
      </div>
      <p className="notes-explorer-footer">{tp("notes.workspace.count", notes.length)}</p>
    </aside>

    <div className="notes-main">
      {selected && <header className="notes-mobilebar">
        <button type="button" className="notes-mobilebar-button" aria-label={t("notes.workspace.back")} onClick={() => setMobileView("list")}><Icon name="chevron-left" /></button>
        <span className="notes-mobilebar-title">{breadcrumb[breadcrumb.length - 1]?.name ?? t("notes.common.library")}</span>
        <span className="notes-mobilebar-actions">
          <button type="button" className={`notes-mobilebar-button ${selected.favorite ? "is-favorite" : ""}`} aria-pressed={selected.favorite} aria-label={favoriteLabel} onClick={() => toggleFavorite(selected)}><Icon name="star" /></button>
          <button type="button" className={`notes-mobilebar-button ${reading ? "" : "is-active"}`} aria-label={reading ? t("notes.workspace.edit") : t("notes.workspace.doneEditing")} onClick={() => setReading((value) => !value)}><Icon name={reading ? "pencil" : "check"} /></button>
        </span>
      </header>}

      <div className="notes-tabs" role="tablist" aria-label={t("notes.workspace.openNotes")}>
        {openIds.map((id) => {
          const note = notes.find((item) => item.id === id);
          if (!note) return null;
          const active = selectedId === note.id;
          return <div className={`notes-tab ${active ? "active" : ""}`} key={id}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="notes-tab-button"
              title={note.title}
              onClick={() => setSelectedId(id)}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(id); } }}
            >
              <span className="notes-tab-icon"><Icon name="file" /></span>
              <span className="notes-tab-title">{note.title || t("notes.editor.untitled")}</span>
            </button>
            <button type="button" className="notes-tab-close" aria-label={t("notes.workspace.closeTab")} title={t("notes.workspace.closeTab")} onClick={() => closeTab(id)}><Icon name="close" /></button>
          </div>;
        })}
        <button type="button" className="notes-tab-add" aria-label={t("notes.common.newNote")} title={t("notes.common.newNote")} onClick={newNote}><Icon name="plus" /></button>
      </div>

      {selected ? <>
        <div className="notes-toolbar">
          <div className="notes-toolbar-leading">
            <button type="button" className="notes-icon-button" aria-label={libraryOpen ? t("notes.library.collapse") : t("notes.library.expand")} title={libraryOpen ? t("notes.library.collapse") : t("notes.library.expand")} aria-pressed={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}><NoteGlyph name="sidebar-left" /></button>
            <nav className="notes-breadcrumb" aria-label={t("notes.workspace.breadcrumb")}>
              <ol>
                <li>{t("notes.common.library")}</li>
                {breadcrumb.map((folder) => <li key={folder.id}>{folder.name}</li>)}
                <li aria-current="page">{selected.title || t("notes.editor.untitled")}</li>
              </ol>
            </nav>
          </div>
          <div className="notes-toolbar-actions">
            <div className="notes-segmented" role="group" aria-label={t("notes.workspace.modeLabel")}>
              <button type="button" aria-pressed={!reading} className={!reading ? "active" : ""} onClick={() => setReading(false)}><Icon name="pencil" />{t("notes.workspace.write")}</button>
              <button type="button" aria-pressed={reading} className={reading ? "active" : ""} onClick={() => setReading(true)}><Icon name="book-open" />{t("notes.workspace.read")}</button>
            </div>
            <button type="button" className={`notes-icon-button ${selected.favorite ? "is-favorite" : ""}`} aria-pressed={selected.favorite} aria-label={favoriteLabel} title={favoriteLabel} onClick={() => toggleFavorite(selected)}><Icon name="star" /></button>
            <button type="button" className="notes-icon-button" aria-pressed={inspectorOpen} aria-label={t("notes.toolbar.inspector")} title={t("notes.toolbar.inspector")} onClick={() => setInspectorOpen((open) => !open)}><NoteGlyph name="sidebar-right" /></button>
            <button type="button" className="notes-icon-button" aria-haspopup="menu" aria-label={t("notes.workspace.more")} title={t("notes.workspace.more")} onClick={openMoreMenu}><NoteGlyph name="more" /></button>
            <input ref={attachmentInputRef} type="file" accept="image/*,video/*,audio/*,application/pdf" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} />
          </div>
        </div>

        <div className="notes-document-scroll" ref={scrollRef} onScroll={syncActiveHeading}>
          <article className={`notes-document ${mode === "live" ? "is-split" : ""}`}>
            <header className="notes-document-header">
              {reading
                ? <h1 className={`notes-document-title ${selected.title ? "" : "is-placeholder"}`}>{selected.title || t("notes.editor.untitled")}</h1>
                : <input
                    ref={titleRef}
                    className="notes-document-title"
                    value={selected.title}
                    placeholder={t("notes.editor.untitled")}
                    aria-label={t("notes.titleRow.title")}
                    onChange={(event) => { const title = event.target.value; setNotes((current) => current.map((note) => note.id === selected.id ? { ...note, title } : note)); }}
                    onBlur={commitTitle}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); editorRef.current?.focus(); } }}
                  />}
              <div className="notes-document-meta">
                {tags.length > 0 && <ul className="notes-tags" aria-label={t("notes.workspace.tags")}>
                  {tags.map((tag) => <li key={tag}><button type="button" className="notes-chip" title={t("notes.workspace.searchTag", { tag: `#${tag}` })} onClick={() => searchFor(`#${tag}`)}><NoteGlyph name="hash" />{tag}</button></li>)}
                </ul>}
                <span className="notes-document-stats">
                  <time dateTime={selected.updatedAt} title={new Date(selected.updatedAt).toLocaleString(lang)}>{modifiedLabel}</time>
                  <span aria-hidden="true"> · </span>
                  {tp("notes.inspector.words", countWords(selected.body))}
                </span>
              </div>
            </header>

            {reading ? (
              selected.body.trim()
                ? <div key={`reading-${selected.id}`} ref={renderedRef} className="notes-prose notes-reading" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                : <div className="notes-empty-body">
                    <p>{t("notes.workspace.emptyBody")}</p>
                    <button type="button" className="notes-button" onClick={() => { setReading(false); requestAnimationFrame(() => editorRef.current?.focus()); }}><Icon name="pencil" />{t("notes.workspace.startWriting")}</button>
                  </div>
            ) : (
              <div className="notes-editor-pair">
                <div className="notes-editor-pane">
                  <textarea
                    ref={editorRef}
                    value={selected.body}
                    rows={12}
                    onChange={(event) => { updateBody(event.target.value); refreshSlash(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
                    onKeyDown={onEditorKeyDown}
                    onClick={(event) => refreshSlash(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
                    onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) refreshSlash(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }}
                    onSelect={(event) => syncActiveHeadingFromCaret(event.currentTarget)}
                    spellCheck
                    aria-label={t("notes.editor.label")}
                    placeholder={t("notes.editor.placeholder")}
                  />
                  {slash && slashOptions.length > 0 && <div className="notes-slash-menu" role="listbox" aria-label={t("notes.editor.insertBlock")} style={{ top: slashPos.top, left: slashPos.left }}>{slashOptions.map((command, index) => <button key={command.id} type="button" role="option" aria-selected={index === slashIndex} className={index === slashIndex ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashCommand(command)} onMouseEnter={() => setSlashIndex(index)}><span className="notes-slash-icon"><Icon name={command.icon} /></span><span className="notes-slash-text"><strong>{command.label}</strong><small>{command.hint}</small></span></button>)}</div>}
                </div>
                {mode === "live" && <div key={`live-${selected.id}`} ref={renderedRef} className="notes-prose notes-preview-pane" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: renderedHtml }} />}
              </div>
            )}
          </article>
        </div>
        {graphOpen && <NoteGraph notes={notes} selected={selected} onSelect={(note) => { selectNote(note); setGraphOpen(false); }} onClose={() => setGraphOpen(false)} />}
      </> : <div className="notes-empty"><div className="notes-empty-mark"><Icon name="file-text" /></div><h2>{t("notes.empty.title")}</h2><p>{t("notes.empty.body")}</p><button type="button" className="primary-button" onClick={newNote}><Icon name="plus" />{t("notes.common.newNote")}</button></div>}
    </div>

    {inspectorOpen && selected && <NotesInspector
      note={selected}
      notes={notes}
      folderLabel={folderLabel}
      projectLabel={projectLabel}
      outline={outline}
      activeHeading={activeHeading}
      onJumpToHeading={jumpToHeading}
      onSelectNote={selectNote}
      onOpenGraph={() => setGraphOpen(true)}
    />}

    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    {modal?.kind === "folder-name" && <FolderNameModal title={modal.mode === "create" ? t("notes.folderModal.newTitle") : t("notes.folderModal.renameTitle")} initialName={modal.mode === "create" ? "" : modal.folder.name} initialColor={modal.mode === "create" ? null : modal.folder.color} submitLabel={modal.mode === "create" ? t("notes.folderModal.create") : t("notes.common.rename")} onSubmit={(name, color) => submitFolderName(name, color, modal.mode === "create" ? { mode: "create", parentId: modal.parentId } : { mode: "rename", folder: modal.folder })} onClose={() => setModal(null)} />}
    {modal?.kind === "move-note" && <MoveNoteModal note={modal.note} folders={folders} onMove={(folderId) => { notesStore.move(modal.note.id, folderId); setNotes(scopedNotes()); setModal(null); }} onClose={() => setModal(null)} />}
    {modal?.kind === "move-folder" && <MoveFolderModal folder={modal.folder} folders={folders} onMove={(parentId) => { notesStore.moveFolder(modal.folder.id, parentId); setFolders(notesStore.listFolders()); setModal(null); }} onClose={() => setModal(null)} />}
    {modal?.kind === "folder-color" && <FolderColorModal folder={modal.folder} onPick={(color) => { notesStore.setFolderColor(modal.folder.id, color); setFolders(notesStore.listFolders()); }} onClose={() => setModal(null)} />}
    {modal?.kind === "confirm-note-delete" && <ConfirmModal title={t("notes.deleteNote.title")} message={t("notes.deleteNote.message", { title: modal.note.title })} confirmLabel={t("notes.deleteNote.confirm")} onConfirm={() => doTrashNote(modal.note)} onClose={() => setModal(null)} />}
    {modal?.kind === "confirm-folder-delete" && <ConfirmModal title={t("notes.deleteFolder.title")} message={t("notes.deleteFolder.message", { name: modal.folder.name })} confirmLabel={t("notes.deleteFolder.confirm")} onConfirm={() => doDeleteFolder(modal.folder)} onClose={() => setModal(null)} />}
  </section>;
}