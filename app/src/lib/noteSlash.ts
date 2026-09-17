import type { IconName } from "../components/Icon";

export type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  keywords: string;
  snippet: string;
  /** Number of characters from the end of the snippet where the caret should land. */
  cursorBack?: number;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1", label: "Heading 1", icon: "heading", hint: "# Large section heading", keywords: "h1 heading title header", snippet: "# " },
  { id: "h2", label: "Heading 2", icon: "heading", hint: "## Medium section heading", keywords: "h2 heading title header subtitle", snippet: "## " },
  { id: "h3", label: "Heading 3", icon: "heading", hint: "### Small section heading", keywords: "h3 heading title header subtitle", snippet: "### " },
  { id: "bullet", label: "Bullet list", icon: "list", hint: "- Simple bulleted list", keywords: "ul bullet list point", snippet: "- " },
  { id: "ordered", label: "Numbered list", icon: "list-ordered", hint: "1. Ordered list", keywords: "ol ordered numbered list number", snippet: "1. " },
  { id: "task", label: "Task list", icon: "list-todo", hint: "Checkable to-do item", keywords: "todo task checklist checkbox done", snippet: "- [ ] " },
  { id: "quote", label: "Quote", icon: "quote", hint: "> Highlighted quote", keywords: "quote cite callout", snippet: "> " },
  { id: "code", label: "Code block", icon: "code", hint: "Fenced code block", keywords: "code block pre snippet", snippet: "```\n\n```", cursorBack: 4 },
  { id: "divider", label: "Divider", icon: "divider", hint: "Horizontal rule", keywords: "divider hr rule line separator", snippet: "---\n" },
  { id: "link", label: "Link to note", icon: "link", hint: "[[ Connect another note", keywords: "link note wikilink bracket reference", snippet: "[[]]", cursorBack: 2 },
  { id: "math", label: "Math", icon: "sparkles", hint: "$$ Inline math", keywords: "math latex formula katex equation", snippet: "$$  $$", cursorBack: 3 },
  { id: "tag", label: "Tag", icon: "tag", hint: "# Organize with a tag", keywords: "tag hash label", snippet: "#" },
];

export type SlashToken = { query: string; start: number };

const TOKEN_PATTERN = /(^|\n|\s)\/([\p{L}\p{N}_-]*)$/u;

export function matchSlashToken(body: string, caret: number): SlashToken | null {
  const before = body.slice(0, Math.max(0, Math.min(caret, body.length)));
  const match = before.match(TOKEN_PATTERN);
  if (!match) return null;
  return { query: match[2] ?? "", start: before.length - match[0].length + match[1].length };
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(normalized));
}

export function applySlashInsert(body: string, caret: number, tokenStart: number, command: SlashCommand): { body: string; caret: number } {
  const safeCaret = Math.max(tokenStart, Math.min(caret, body.length));
  const before = body.slice(0, tokenStart);
  const after = body.slice(safeCaret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const midLine = before.slice(lineStart).trim() !== "";
  const prefix = midLine ? "\n" : "";
  const nextBody = `${before}${prefix}${command.snippet}${after}`;
  const nextCaret = before.length + prefix.length + command.snippet.length - (command.cursorBack ?? 0);
  return { body: nextBody, caret: nextCaret };
}
