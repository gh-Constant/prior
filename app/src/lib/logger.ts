import { isTauri } from "./platform";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  details?: string;
};

const MAX_LOG_ENTRIES = 1000;
const LOGS_STORAGE_KEY = "prior.diagnostics.logs.v1";
const CHANGE_EVENT = "prior-logs-change";

const memoryLogs: LogEntry[] = [];
let isInitialized = false;

function formatTimestamp(date = new Date()): string {
  return date.toISOString();
}

function safeStringify(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function persistLogsDebounced(): void {
  try {
    if (typeof localStorage !== "undefined") {
      // Keep only last 200 entries in localStorage to preserve space
      const toSave = memoryLogs.slice(-200);
      localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(toSave));
    }
  } catch {
    // Storage might be full or disabled; in-memory buffer still preserves logs
  }
}

let persistTimer: number | undefined;
function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistLogsDebounced, 1000);
}

function emitChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

export const logger = {
  init(): void {
    if (isInitialized || typeof window === "undefined") return;
    isInitialized = true;

    // Load persisted logs from previous session if available
    try {
      const raw = localStorage.getItem(LOGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LogEntry[];
        if (Array.isArray(parsed)) {
          memoryLogs.push(...parsed.slice(-200));
        }
      }
    } catch {
      // Ignore
    }

    this.info("APP", `Session started on ${isTauri() ? "desktop" : "web"} (${navigator.userAgent})`);

    // Capture unhandled errors
    window.addEventListener("error", (event) => {
      const errorMsg = event.error instanceof Error ? event.error.message : event.message;
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      this.error("WINDOW", `Unhandled error: ${errorMsg}`, stack);
    });

    // Capture unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : safeStringify(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      this.error("PROMISE", `Unhandled rejection: ${message}`, stack);
    });

    // Intercept console.warn and console.error without breaking standard behavior
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      const first = args[0];
      const category = typeof first === "string" && first.startsWith("Prior") ? "SYNC" : "CONSOLE";
      const message = args.map(safeStringify).join(" ");
      this.warn(category, message);
    };

    console.error = (...args: unknown[]) => {
      originalError(...args);
      const message = args.map(safeStringify).join(" ");
      this.error("CONSOLE", message);
    };
  },

  log(level: LogLevel, category: string, message: string, details?: unknown): void {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: formatTimestamp(),
      level,
      category: category.toUpperCase(),
      message,
      details: details !== undefined ? safeStringify(details) : undefined,
    };

    memoryLogs.push(entry);
    if (memoryLogs.length > MAX_LOG_ENTRIES) {
      memoryLogs.shift();
    }

    schedulePersist();
    emitChange();
  },

  debug(category: string, message: string, details?: unknown): void {
    this.log("debug", category, message, details);
  },

  info(category: string, message: string, details?: unknown): void {
    this.log("info", category, message, details);
  },

  warn(category: string, message: string, details?: unknown): void {
    this.log("warn", category, message, details);
  },

  error(category: string, message: string, details?: unknown): void {
    this.log("error", category, message, details);
  },

  getEntries(): LogEntry[] {
    return [...memoryLogs];
  },

  getLogs(): LogEntry[] {
    return this.getEntries();
  },

  getLogText(): string {
    const header = [
      `=== Prior Diagnostics Log ===`,
      `Generated: ${new Date().toISOString()}`,
      `Platform: ${isTauri() ? "Desktop (Tauri)" : "Web Browser"}`,
      `User Agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
      `==============================\n`,
    ].join("\n");

    const lines = memoryLogs.map((entry) => {
      const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`;
      return entry.details ? `${base}\n  Details: ${entry.details.split("\n").join("\n  ")}` : base;
    });

    return `${header}${lines.join("\n")}\n`;
  },

  clear(): void {
    memoryLogs.length = 0;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LOGS_STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
    emitChange();
  },

  exportLatestLog(): void {
    if (typeof document === "undefined") return;
    const content = this.getLogText();
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "latest.log";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  async openLogFile(): Promise<void> {
    this.exportLatestLog();
  },

  subscribe(callback: () => void): () => void {
    if (typeof window === "undefined") return () => undefined;
    window.addEventListener(CHANGE_EVENT, callback);
    return () => window.removeEventListener(CHANGE_EVENT, callback);
  },
};
