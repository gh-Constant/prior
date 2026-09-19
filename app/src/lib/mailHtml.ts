/**
 * Minimal HTML sanitizer for rendering email bodies.
 *
 * Email HTML is untrusted remote content: strip active elements and event
 * handlers, neutralize dangerous URL schemes, and keep the rest so
 * newsletters keep a readable layout. No external dependency on purpose.
 */

const BLOCKED_SELECTORS = [
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "link",
  "meta",
  "base",
  "title",
].join(",");

/** URL schemes allowed in href/src attributes. data: is limited to images. */
const SAFE_URL = /^(https?:|mailto:|tel:|cid:|data:image\/)/i;

/** Cap parsed input so a pathological mail cannot hang the renderer. */
const MAX_HTML_LENGTH = 500_000;

function cleanStyle(value: string): string {
  return value
    .replace(/expression\s*\(/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/vbscript\s*:/gi, "")
    .replace(/behaviou?r\s*:/gi, "")
    .replace(/-moz-binding\s*:/gi, "");
}

export function sanitizeMailHtml(dirty: string): string {
  if (!dirty) return "";
  const source = dirty.length > MAX_HTML_LENGTH ? dirty.slice(0, MAX_HTML_LENGTH) : dirty;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(`<div>${source}</div>`, "text/html");
  } catch {
    return "";
  }
  const root = doc.body.firstElementChild ?? doc.body;
  root.querySelectorAll(BLOCKED_SELECTORS).forEach((el) => el.remove());

  const elements = Array.from(root.querySelectorAll("*"));
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "formaction" || name === "poster" || name === "background" || name === "cite" || name === "data") {
        if (!SAFE_URL.test(attr.value.trim())) el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") {
        const cleaned = cleanStyle(attr.value);
        if (cleaned.trim()) el.setAttribute(attr.name, cleaned);
        else el.removeAttribute(attr.name);
      }
    }
    if (el.tagName.toLowerCase() === "a") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  }
  return root.innerHTML;
}
