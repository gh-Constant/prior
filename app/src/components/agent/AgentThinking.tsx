import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { AgentIdentity } from "../AgentIdentity";
import "./agentThinking.css";

const LINE_KEYS = ["lookTasks", "weighPriorities", "gatherIdeas", "prepareProposals"] as const;
const WORKING_KEYS = ["working", "writingUp"] as const;

type Props = {
  /** "thinking": waiting for the model. "working": a stream is running (Codex). */
  readonly mode?: "thinking" | "working";
};

/**
 * The assistant's "I'm on it" row: the mascot in its thinking (or working) mood next to a shimmering
 * status line that moves through short phases. The request has no real progress events, so the
 * lines advance on a timer and hold on the last phase of the sequence.
 */
export function AgentThinking({ mode = "thinking" }: Props) {
  const { t } = useI18n();
  const keys = mode === "working" ? WORKING_KEYS : LINE_KEYS;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    const timer = window.setInterval(() => setIndex((current) => Math.min(current + 1, keys.length - 1)), 2800);
    return () => window.clearInterval(timer);
  }, [keys]);

  const key = keys[Math.min(index, keys.length - 1)];
  return (
    <div className="agent-message-row assistant agent-thinking" data-mode={mode}>
      <div className="agent-message-avatar">
        <AgentIdentity size="small" mood={mode} />
      </div>
      <div className="agent-message-bubble loading-bubble" role="status" aria-live="polite">
        <span className="agent-thinking-sr">{t(mode === "working" ? "agent.streaming.codex" : "agent.streaming.thinking")}</span>
        <span className="agent-thinking-line" aria-hidden="true">
          <span key={key} className="loading-text agent-thinking-text">{t(`agentui.thinking.${key}`)}</span>
          <span className="agent-thinking-dots"><i /><i /><i /></span>
        </span>
        <span className="agent-thinking-skeleton" aria-hidden="true"><i /><i /></span>
      </div>
    </div>
  );
}
