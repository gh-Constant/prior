import type { MailMessage, TaskDraft, TaskPriority } from "../types";
import { getAgentSettings } from "./ai";

/**
 * Draft a task from an email using the configured AI provider. Falls back to a
 * deterministic heuristic draft when no provider key is configured (local dev
 * without an OpenRouter key) so the "Add to task with AI" flow always works.
 */

type MailAiDraft = {
  title?: string;
  description?: string;
  dueDate?: string | null;
  priority?: number;
  important?: boolean;
  urgent?: boolean;
};

function clampPriority(value: unknown): TaskPriority {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 4;
}

function parseJsonObject(text: string): MailAiDraft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as MailAiDraft;
  } catch {
    return null;
  }
}

function buildPrompt(message: MailMessage, today: string): string {
  const body = message.body.length > 4000 ? `${message.body.slice(0, 4000)}\n…` : message.body;
  return [
    "You are converting an email into a single actionable to-do for a personal task manager.",
    `Today's date is ${today}.`,
    "Read the email and return ONLY a JSON object (no markdown, no code fences) with these keys:",
    '- "title": a short imperative action (max 80 chars), not the raw subject.',
    '- "description": 1-3 sentences of useful context from the email, plus the sender.',
    '- "dueDate": an ISO date (YYYY-MM-DD) if the email implies a deadline, else null.',
    '- "priority": integer 1 (urgent) to 4 (none).',
    '- "important": boolean.',
    '- "urgent": boolean.',
    "",
    `From: ${message.from.name} <${message.from.email}>`,
    `Subject: ${message.subject}`,
    `Date: ${message.date}`,
    "",
    "Email body:",
    body,
  ].join("\n");
}

function heuristicDraft(message: MailMessage): TaskDraft {
  const text = `${message.subject}\n${message.body}`.toLowerCase();
  const urgent = /\burgent\b|\basap\b|immediately|right away|deadline|failed|action required/.test(text);
  const important = /\binvoice\b|\bpayment\b|\bcontract\b|\breview\b|\bapprove\b|\bconfirm\b|security|verify/.test(text);
  const priority: TaskPriority = urgent && important ? 1 : urgent ? 2 : important ? 2 : 3;

  const deadline = /(?:by|before|due|until|no later than)\s+(?:on\s+)?(\w+day|\d{1,2}\s+\w+|\w+\s+\d{1,2})/i.exec(message.body);
  let dueDate: string | null = null;
  if (deadline) {
    const parsed = Date.parse(deadline[1]);
    if (!Number.isNaN(parsed)) dueDate = new Date(parsed).toISOString().slice(0, 10);
  }

  const title = message.subject.replace(/^(re|fwd?):\s*/i, "").trim() || "Follow up on email";
  const description = [message.snippet, "", `${message.from.name} <${message.from.email}>`].join("\n").trim();
  return { title: title.slice(0, 120), description, important, urgent, priority, dueDate, status: "inbox" };
}

async function requestAiDraft(message: MailMessage, sessionToken: string | null): Promise<MailAiDraft | null> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildPrompt(message, today);
  const settings = getAgentSettings();

  // Prefer the server proxy (the stored OpenRouter key stays off the device).
  if (sessionToken) {
    try {
      const { api } = await import("./api");
      const result = await api.agentComplete(
        { model: settings.model || "openrouter/free", prompt, system: "You convert emails into tasks. Respond with a single JSON object only.", history: [], webSearch: false },
        sessionToken,
      );
      return parseJsonObject(result.content);
    } catch {
      // fall through to direct
    }
  }

  if (settings.apiKey) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model || "openrouter/free",
          messages: [
            { role: "system", content: "You convert emails into tasks. Respond with a single JSON object only." },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "";
        return parseJsonObject(content);
      }
    } catch {
      // fall through to heuristic
    }
  }
  return null;
}

export async function generateTaskFromMail(message: MailMessage, sessionToken: string | null): Promise<TaskDraft> {
  const fallback = heuristicDraft(message);
  const ai = await requestAiDraft(message, sessionToken);
  if (!ai) return fallback;
  return {
    title: (typeof ai.title === "string" && ai.title.trim() ? ai.title.trim() : fallback.title).slice(0, 120),
    description: (typeof ai.description === "string" && ai.description.trim() ? ai.description.trim() : fallback.description),
    important: typeof ai.important === "boolean" ? ai.important : fallback.important,
    urgent: typeof ai.urgent === "boolean" ? ai.urgent : fallback.urgent,
    priority: clampPriority(ai.priority ?? fallback.priority),
    dueDate: typeof ai.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ai.dueDate) ? ai.dueDate : fallback.dueDate ?? null,
    status: "inbox",
  };
}
