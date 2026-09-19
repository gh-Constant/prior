import type { MailLabel, MailMessage } from "../types";
import { DEMO_LABELS, DEMO_MESSAGES } from "./mailDemo";
import { readScopedStorage, writeScopedStorage } from "./accountScope";

/**
 * Mail data layer.
 *
 * Two providers share one interface:
 *  - `GmailProvider` talks to the Gmail REST API with a user access token.
 *  - `DemoProvider` serves a local, fully-editable demo mailbox (used in
 *    development and whenever no Google account is connected).
 *
 * The demo provider persists its edits to scoped localStorage so archive /
 * star / read / label changes survive reloads and feel real while testing
 * without any Google credentials.
 */

export type MailProvider = {
  readonly kind: "gmail" | "demo";
  readonly accountEmail: string;
  listLabels(): Promise<MailLabel[]>;
  listMessages(labelFilter: string, query: string, pageToken?: string): Promise<{ messages: MailMessage[]; nextPageToken?: string }>;
  getMessage(id: string): Promise<MailMessage | null>;
  /** Apply label add/remove. Gmail semantics: removing INBOX archives. */
  modify(id: string, addLabelIds: string[], removeLabelIds: string[]): Promise<MailMessage>;
};

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
] as const;

export const MAIL_FOLDERS: Array<{ id: string; labelFilter: string }> = [
  { id: "inbox", labelFilter: "INBOX" },
  { id: "starred", labelFilter: "STARRED" },
  { id: "sent", labelFilter: "SENT" },
  { id: "all", labelFilter: "" },
  { id: "trash", labelFilter: "TRASH" },
];

/* ------------------------------------------------------------------------ */
/* Gmail API client                                                          */
/* ------------------------------------------------------------------------ */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function b64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  const found = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

function parseAddressList(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const trimmed = part.trim();
    const match = /^(.*)<([^>]+)>$/.exec(trimmed);
    if (match) {
      const name = match[1].replace(/^"|"$/g, "").trim();
      return { name: name || match[2].trim(), email: match[2].trim() };
    }
    return { name: trimmed, email: trimmed };
  });
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((el) => el.remove());
  return (doc.body.textContent ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractBody(payload: GmailPayload | undefined): { text: string; html: string; hasAttachment: boolean } {
  let text = "";
  let html = "";
  let hasAttachment = false;
  const walk = (part: GmailPayload | undefined) => {
    if (!part) return;
    if (part.filename && part.filename.length > 0) hasAttachment = true;
    const data = part.body?.data;
    if (data && part.mimeType === "text/plain" && !text) text = b64UrlDecode(data);
    if (data && part.mimeType === "text/html" && !html) html = b64UrlDecode(data);
    part.parts?.forEach(walk);
  };
  walk(payload);
  const decoded = text || (html ? stripHtml(html) : "");
  return { text: decoded, html, hasAttachment };
}

type GmailHeader = { name: string; value: string };
type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};
type GmailApiMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

function toMailMessage(raw: GmailApiMessage): MailMessage {
  const headers = raw.payload?.headers;
  const fromRaw = headerValue(headers, "From");
  const toRaw = headerValue(headers, "To");
  const from = parseAddressList(fromRaw)[0] ?? { name: fromRaw, email: fromRaw };
  const { text, html, hasAttachment } = extractBody(raw.payload);
  const labelIds = raw.labelIds ?? [];
  const date = raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : new Date().toISOString();
  return {
    id: raw.id,
    threadId: raw.threadId,
    from,
    to: parseAddressList(toRaw),
    subject: headerValue(headers, "Subject") || "(no subject)",
    snippet: raw.snippet ?? "",
    body: text,
    ...(html ? { bodyHtml: html } : {}),
    date,
    labelIds,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    archived: !labelIds.includes("INBOX") && !labelIds.includes("TRASH") && !labelIds.includes("SENT"),
    hasAttachment,
  };
}

export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  constructor(readonly accountEmail: string, private readonly getToken: () => Promise<string>) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${GMAIL_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 401) throw new Error("gmail-unauthorized");
    if (!res.ok) throw new Error(`gmail-error-${res.status}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async listLabels(): Promise<MailLabel[]> {
    const data = await this.call<{ labels?: Array<{ id: string; name: string; type: string; color?: { backgroundColor?: string; textColor?: string } }> }>("/labels");
    return (data.labels ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      system: label.type === "system",
      color: label.color?.backgroundColor,
      textColor: label.color?.textColor,
    }));
  }

  async listMessages(labelFilter: string, query: string, pageToken?: string): Promise<{ messages: MailMessage[]; nextPageToken?: string }> {
    const params = new URLSearchParams({ maxResults: "25" });
    const q: string[] = [];
    if (labelFilter) q.push(`label:${labelFilter}`);
    else q.push("-label:TRASH -label:SPAM");
    if (query.trim()) q.push(query.trim());
    params.set("q", q.join(" "));
    if (pageToken) params.set("pageToken", pageToken);
    const list = await this.call<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(`/messages?${params.toString()}`);
    const ids = list.messages ?? [];
    if (!ids.length) return { messages: [], nextPageToken: list.nextPageToken };
    const detailed = await Promise.all(ids.map((m) => this.call<GmailApiMessage>(`/messages/${m.id}?format=full`)));
    return { messages: detailed.map(toMailMessage), nextPageToken: list.nextPageToken };
  }

  async getMessage(id: string): Promise<MailMessage | null> {
    try {
      return toMailMessage(await this.call<GmailApiMessage>(`/messages/${encodeURIComponent(id)}?format=full`));
    } catch {
      return null;
    }
  }

  async modify(id: string, addLabelIds: string[], removeLabelIds: string[]): Promise<MailMessage> {
    await this.call<GmailApiMessage>(`/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    });
    // The modify endpoint only echoes {id, threadId, labelIds} with no
    // payload: converting it directly would wipe subject/body/sender from
    // the list (empty avatar, "(no subject)"). Refetch the full message.
    const full = await this.getMessage(id);
    if (!full) throw new Error("gmail-error-refetch");
    return full;
  }
}

/* ------------------------------------------------------------------------ */
/* Demo provider (local, no Google credentials needed)                       */
/* ------------------------------------------------------------------------ */

const DEMO_STORAGE_KEY = "prior.mail.demo.v1";

type DemoState = { labels: MailLabel[]; messages: MailMessage[] };

function loadDemoState(): DemoState {
  try {
    const raw = readScopedStorage(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (Array.isArray(parsed.messages) && parsed.messages.length) return parsed;
    }
  } catch {
    // fall through to seed
  }
  const seed: DemoState = { labels: DEMO_LABELS, messages: DEMO_MESSAGES };
  try { writeScopedStorage(DEMO_STORAGE_KEY, JSON.stringify(seed)); } catch { /* storage full */ }
  return seed;
}

export class DemoProvider implements MailProvider {
  readonly kind = "demo" as const;
  readonly accountEmail: string;
  private state: DemoState;

  constructor(accountEmail: string) {
    this.accountEmail = accountEmail;
    this.state = loadDemoState();
  }

  private persist(): void {
    try { writeScopedStorage(DEMO_STORAGE_KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  async listLabels(): Promise<MailLabel[]> {
    return this.state.labels;
  }

  async listMessages(labelFilter: string, query: string, pageToken?: string): Promise<{ messages: MailMessage[]; nextPageToken?: string }> {
    let pool = this.state.messages.slice();
    if (labelFilter === "INBOX") pool = pool.filter((m) => m.labelIds.includes("INBOX") && !m.archived);
    else if (labelFilter === "STARRED") pool = pool.filter((m) => m.starred);
    else if (labelFilter === "SENT") pool = pool.filter((m) => m.labelIds.includes("SENT"));
    else if (labelFilter === "TRASH") pool = pool.filter((m) => m.labelIds.includes("TRASH"));
    else if (labelFilter) pool = pool.filter((m) => m.labelIds.includes(labelFilter));
    else pool = pool.filter((m) => !m.labelIds.includes("TRASH"));

    const q = query.trim().toLowerCase();
    if (q) {
      pool = pool.filter((m) =>
        m.subject.toLowerCase().includes(q) ||
        m.snippet.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.from.name.toLowerCase().includes(q) ||
        m.from.email.toLowerCase().includes(q));
    }
    pool.sort((a, b) => (a.date < b.date ? 1 : -1));

    const pageSize = 25;
    const start = pageToken ? Number(pageToken) || 0 : 0;
    const messages = pool.slice(start, start + pageSize);
    const nextPageToken = start + pageSize < pool.length ? String(start + pageSize) : undefined;
    return { messages, nextPageToken };
  }

  async getMessage(id: string): Promise<MailMessage | null> {
    return this.state.messages.find((m) => m.id === id) ?? null;
  }

  async modify(id: string, addLabelIds: string[], removeLabelIds: string[]): Promise<MailMessage> {
    const target = this.state.messages.find((m) => m.id === id);
    if (!target) throw new Error("message not found");
    const labels = new Set(target.labelIds);
    for (const l of addLabelIds) labels.add(l);
    for (const l of removeLabelIds) labels.delete(l);
    target.labelIds = [...labels];
    if (removeLabelIds.includes("INBOX")) target.archived = true;
    if (addLabelIds.includes("INBOX")) target.archived = false;
    if (removeLabelIds.includes("UNREAD")) target.unread = false;
    if (addLabelIds.includes("UNREAD")) target.unread = true;
    if (addLabelIds.includes("STARRED")) target.starred = true;
    if (removeLabelIds.includes("STARRED")) target.starred = false;
    this.persist();
    return { ...target };
  }
}

/* ------------------------------------------------------------------------ */
/* Provider resolution                                                       */
/* ------------------------------------------------------------------------ */

/** Returns a Gmail provider when a token getter is available, else demo. */
export function resolveMailProvider(
  accountEmail: string | null,
  getToken: (() => Promise<string>) | null,
): MailProvider {
  if (accountEmail && getToken) return new GmailProvider(accountEmail, getToken);
  return new DemoProvider(accountEmail ?? "you@example.com");
}
