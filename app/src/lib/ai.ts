import type { AgentMessage, AgentSettings, ProposedTask, Task } from "../types";

export const DEFAULT_MODEL = "openrouter/free";

export const POPULAR_FREE_MODELS: Array<{ id: string; label: string; desc: string }> = [
  { id: "openrouter/free", label: "Auto (openrouter/free)", desc: "Automatically selects the best available free model" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (Free)", desc: "High-capacity reasoning from Meta" },
  { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (Free)", desc: "Fast & responsive model from Google" },
  { id: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B (Free)", desc: "Strong multilingual & coding model" },
  { id: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (Free)", desc: "Advanced reasoning and deep breakdown" },
];

const SETTINGS_KEY = "prior.ai.settings.v1";

export function getAgentSettings(): AgentSettings {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AgentSettings>;
        return {
          apiKey: parsed.apiKey || "",
          model: parsed.model || DEFAULT_MODEL,
        };
      }
    }
  } catch {
    // fallback below
  }
  return { apiKey: "", model: DEFAULT_MODEL };
}

export function saveAgentSettings(settings: AgentSettings): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch {
    // ignore
  }
}

export function buildSystemPrompt(existingTasks: Task[] = []): string {
  const activeTasksSummary = existingTasks
    .filter((t) => !t.completed && !t.deletedAt)
    .slice(0, 20)
    .map((t) => `- "${t.title}" (${t.important ? "Important" : "Not Important"}, ${t.urgent ? "Urgent" : "Not Urgent"})`)
    .join("\n");

  return `You are Prior's AI Executive Assistant. Your mission is to help the user clear mental clutter, break down projects, and prioritize tasks using the Eisenhower Decision Matrix.

Eisenhower Matrix Guidelines:
1. Quadrant 1 (Focus / Do First): BOTH Important AND Urgent.
   - Criteria: Critical deadlines due today/tomorrow, severe blockers, emergencies, health/legal/tax crises, broken production systems.
2. Quadrant 2 (Plan / Schedule): Important, but NOT Urgent.
   - Criteria: Strategic long-term goals, deep work, skill learning, relationship building, proactive improvements, preventive maintenance. High long-term value, no immediate fire.
3. Quadrant 3 (Quick / Delegate): Urgent, but NOT Important.
   - Criteria: Immediate requests, quick administrative chores, phone calls, favors, routine emails that need rapid replies but have low strategic value.
4. Quadrant 4 (Later / Eliminate): Neither Important NOR Urgent.
   - Criteria: Someday/maybe ideas, trivial nice-to-haves, backlogged tweaks, low-impact distractions.

Task Formulation Rules:
- Break vague thoughts, brain dumps, or project outlines into clean, atomic, actionable tasks.
- Every task title MUST start with an active imperative verb (e.g. "Prepare pitch deck slides", "Review pull request #42", "Email accountant tax receipt").
- Keep titles concise, punchy, and professional (under 60 characters when possible).
- Set "important" (boolean) and "urgent" (boolean) strictly based on Eisenhower definitions.
- Provide a brief 1-sentence "reasoning" for your priority classification.
- In "reply", write a concise, encouraging, human summary of what you extracted or planned (1-2 sentences max).

Current existing tasks in Prior for context:
${activeTasksSummary || "(No existing active tasks)"}

Output format: You must respond in valid JSON with:
{
  "reply": "Short summary of proposed tasks or answer to user",
  "tasks": [
    {
      "title": "Actionable task title",
      "important": true,
      "urgent": true,
      "reasoning": "Due tomorrow for investor pitch"
    }
  ]
}
If the user's message does not warrant creating any tasks (e.g., greetings, general questions), return "tasks": [] and address their question in "reply".`;
}

export function parseAiResponse(raw: string): { reply: string; tasks: ProposedTask[] } {
  const clean = raw.trim();
  let jsonStr = clean;

  // Extract from markdown code block if present
  const markdownMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(clean);
  if (markdownMatch && markdownMatch[1]) {
    jsonStr = markdownMatch[1].trim();
  } else {
    // If not in code blocks, look for the outer JSON object {...}
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = clean.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as { reply?: string; tasks?: Array<Record<string, unknown>> };
    const reply = typeof parsed.reply === "string" ? parsed.reply : "Here are the suggested tasks based on your input:";
    const tasks: ProposedTask[] = [];

    if (Array.isArray(parsed.tasks)) {
      for (const item of parsed.tasks) {
        if (!item || typeof item.title !== "string" || !item.title.trim()) continue;
        tasks.push({
          id: crypto.randomUUID(),
          title: item.title.trim(),
          important: Boolean(item.important),
          urgent: Boolean(item.urgent),
          reasoning: typeof item.reasoning === "string" ? item.reasoning : "",
          selected: true,
          added: false,
        });
      }
    }

    return { reply, tasks };
  } catch {
    // Fallback: could not parse JSON, return raw message with empty tasks
    return {
      reply: clean,
      tasks: [],
    };
  }
}

export async function askAgent(
  prompt: string,
  history: AgentMessage[],
  existingTasks: Task[],
  settings: AgentSettings,
): Promise<{ reply: string; tasks: ProposedTask[] }> {
  if (!settings.apiKey) {
    throw new Error("Missing OpenRouter API Key. Please add your key in the settings tab.");
  }

  const systemMessage = { role: "system", content: buildSystemPrompt(existingTasks) };
  const conversationMessages = history.slice(-6).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const userMessage = { role: "user", content: prompt };

  const messages = [systemMessage, ...conversationMessages, userMessage];

  const payload: Record<string, unknown> = {
    model: settings.model || DEFAULT_MODEL,
    messages,
    temperature: 0.3,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.apiKey.trim()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://prior.app",
    "X-Title": "Prior AI Assistant",
  };

  // Attempt with structured response_format first
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        response_format: {
          type: "json_object",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      // If response_format caused an issue with this specific model, retry without it
      if (response.status === 400 && errorText.includes("response_format")) {
        return await sendPlainRequest(payload, headers);
      }
      throw new Error(`OpenRouter error (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseAiResponse(content);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("OpenRouter error")) {
      throw err;
    }
    // Try plain request without response_format
    return sendPlainRequest(payload, headers);
  }
}

async function sendPlainRequest(
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ reply: string; tasks: ProposedTask[] }> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenRouter error (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseAiResponse(content);
}
