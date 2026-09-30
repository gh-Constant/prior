// Comment text helpers (specs/COMMENTS.md): @mention autocomplete, mention
// extraction, and safe rendering of plain text with links and mentions.

export type Mentionable = { userId: string; displayName: string; avatarUrl?: string };

/** The "@partial" being typed at the caret, if any. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!match) return null;
  return { query: match[2], start: caret - match[2].length - 1 };
}

export function filterMentionables(members: readonly Mentionable[], query: string, excludeId?: string): Mentionable[] {
  const needle = query.toLowerCase();
  return members
    .filter((member) => member.userId !== excludeId && member.displayName.trim())
    .filter((member) => !needle || member.displayName.toLowerCase().split(/\s+/).some((part) => part.startsWith(needle)) || member.displayName.toLowerCase().startsWith(needle))
    .slice(0, 6);
}

/** Replaces "@partial" with "@Display Name " and returns the new caret. */
export function insertMention(text: string, start: number, caret: number, member: Mentionable): { text: string; caret: number } {
  const token = `@${member.displayName} `;
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length };
}

/** Members whose "@Display Name" appears in the text. */
export function extractMentions(text: string, members: readonly Mentionable[]): string[] {
  const lower = text.toLowerCase();
  const ids: string[] = [];
  for (const member of [...members].sort((left, right) => right.displayName.length - left.displayName.length)) {
    const name = member.displayName.trim().toLowerCase();
    if (!name) continue;
    const token = `@${name}`;
    let index = lower.indexOf(token);
    while (index >= 0) {
      const before = index === 0 ? " " : lower[index - 1];
      const after = lower[index + token.length] ?? " ";
      if (/\s|[(\[]/.test(before) && !/[\p{L}\p{N}_]/u.test(after)) {
        if (!ids.includes(member.userId)) ids.push(member.userId);
        break;
      }
      index = lower.indexOf(token, index + 1);
    }
  }
  return ids;
}

export type CommentPart = { kind: "text"; value: string } | { kind: "link"; value: string; href: string } | { kind: "mention"; value: string; userId: string };

const LINK = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Splits plain text into text, http(s) links and mentions (no HTML is ever parsed). */
export function commentParts(body: string, mentioned: readonly Mentionable[] = []): CommentPart[] {
  const parts: CommentPart[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const names = mentioned.filter((member) => member.displayName.trim()).sort((left, right) => right.displayName.length - left.displayName.length);
    let rest = value;
    while (rest) {
      let best: { index: number; member: Mentionable } | null = null;
      for (const member of names) {
        const index = rest.toLowerCase().indexOf(`@${member.displayName.toLowerCase()}`);
        if (index >= 0 && (!best || index < best.index)) best = { index, member };
      }
      if (!best) {
        parts.push({ kind: "text", value: rest });
        break;
      }
      if (best.index > 0) parts.push({ kind: "text", value: rest.slice(0, best.index) });
      const length = best.member.displayName.length + 1;
      parts.push({ kind: "mention", value: rest.slice(best.index, best.index + length), userId: best.member.userId });
      rest = rest.slice(best.index + length);
    }
  };
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    const index = match.index ?? 0;
    pushText(body.slice(last, index));
    parts.push({ kind: "link", value: match[0], href: match[0] });
    last = index + match[0].length;
  }
  pushText(body.slice(last));
  return parts;
}

export function relativeTime(iso: string, lang: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

const NOTIFIED_KEY = "prior.mentions.notified.v1";

/**
 * Unread mentions this device has not announced yet; remembers them so a
 * mention triggers one local notification per device.
 */
export function newMentionsToNotify<T extends { commentId: string; readAt?: string }>(mentions: readonly T[]): T[] {
  let notified: string[] = [];
  try { notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]") as string[]; } catch { notified = []; }
  const known = new Set(notified);
  const fresh = mentions.filter((mention) => !mention.readAt && !known.has(mention.commentId));
  if (fresh.length) {
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...fresh.map((mention) => mention.commentId), ...notified].slice(0, 200))); } catch { /* storage unavailable */ }
  }
  return fresh;
}
