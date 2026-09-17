// Shared Markdown renderer for AI assistant messages.
//
// Same safety contract as the notes renderer: raw HTML is escaped first,
// so only the tags generated below can reach the DOM. Links are restricted
// to http/https/mailto. Math spans are hydrated with KaTeX by the caller.

export function escapeChatHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function safeChatUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return "#";
}

const CODE_PLACEHOLDER = "\u0000CHATCODE";

function inlineChatMarkdown(value: string): string {
  // Pull `code` spans aside so **, _, links and math never apply inside them.
  const codeSpans: string[] = [];
  let output = escapeChatHtml(value).replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `${CODE_PLACEHOLDER}${codeSpans.length - 1}\u0000`;
  });
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label: string, rawUrl: string) => {
    const url = safeChatUrl(rawUrl);
    if (url === "#") return label;
    return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  output = output.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  output = output.replace(/(^|[^\w])_([^_\n]+)_/g, "$1<em>$2</em>");
  output = output.replace(/\$\$([^$\n]+)\$\$/g, '<span class="chat-math chat-math-display">$1</span>');
  output = output.replace(/\$([^$\n]+)\$/g, '<span class="chat-math">$1</span>');
  output = output.replace(new RegExp(`${CODE_PLACEHOLDER}(\\d+)\u0000`, "g"), (_match, index: string) => codeSpans[Number(index)] ?? "");
  return output;
}

export function renderChatMarkdown(source: string): string {
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
        const lang = escapeChatHtml(language.toLowerCase());
        html.push(`<pre class="chat-code"${lang ? ` data-language="${lang}"` : ""}><code>${escapeChatHtml(code.join("\n"))}</code></pre>`);
        inCode = false; code = []; language = "";
      } else { closeList(); inCode = true; language = fence[1].trim(); }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; html.push(`<h${level + 1}>${inlineChatMarkdown(heading[2])}</h${level + 1}>`); continue; }
    const item = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (item || ordered) {
      const nextType = ordered ? "ol" : "ul";
      if (listType && listType !== nextType) closeList();
      if (!listType) { listType = nextType; html.push(`<${listType}>`); }
      if (item) {
        const checked = item[1]?.toLowerCase() === "x";
        html.push(`<li>${item[1] ? `<span class="chat-check${checked ? " checked" : ""}">${checked ? "✓" : ""}</span>` : ""}${inlineChatMarkdown(item[2])}</li>`);
      } else html.push(`<li>${inlineChatMarkdown(ordered![1])}</li>`);
      continue;
    }
    if (/^>/.test(line)) { closeList(); html.push(`<blockquote>${inlineChatMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
    if (/^---+$/.test(line.trim())) { closeList(); html.push("<hr />"); continue; }
    closeList();
    html.push(`<p>${inlineChatMarkdown(line)}</p>`);
  }
  if (inCode) html.push(`<pre class="chat-code"><code>${escapeChatHtml(code.join("\n"))}</code></pre>`);
  closeList();
  return html.join("");
}
