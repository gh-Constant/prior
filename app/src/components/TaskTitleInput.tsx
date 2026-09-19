import { useMemo, useRef, type RefObject } from "react";
import type { Area, Project } from "../types";
import { parseTaskTitle, type ParsedTaskTitle, type TaskTitleToken } from "../lib/taskTitleParser";
import { useI18n } from "../lib/i18n";
import "./TaskTitleInput.css";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onTokenClick: (token: TaskTitleToken) => void;
  readonly projects?: readonly Pick<Project, "id" | "name">[];
  readonly areas?: readonly Pick<Area, "id" | "name">[];
  readonly parsed?: ParsedTaskTitle;
  readonly ignoredTokens?: readonly string[];
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
};

export function TaskTitleInput({ value, onChange, onTokenClick, projects, areas, parsed: parsedProp, ignoredTokens = [], inputRef, placeholder, ariaLabel, disabled = false }: Props) {
  const { lang } = useI18n();
  const internalInputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const activeInputRef = inputRef ?? internalInputRef;
  const parsed = useMemo(
    () => parsedProp ?? parseTaskTitle(value, { projects, areas, lang }, ignoredTokens),
    [areas, ignoredTokens, lang, parsedProp, projects, value],
  );
  let cursor = 0;
  const segments: Array<{ text: string; token?: TaskTitleToken }> = [];
  for (const token of parsed.tokens) {
    if (token.start > cursor) segments.push({ text: value.slice(cursor, token.start) });
    segments.push({ text: token.raw, token });
    cursor = token.end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor) });

  function syncScroll() {
    if (highlightRef.current && activeInputRef.current) highlightRef.current.scrollLeft = activeInputRef.current.scrollLeft;
  }

  return (
    <div className="task-title-input-wrap">
      <div ref={highlightRef} className="task-title-highlight-layer" aria-hidden="true">
        {segments.map((segment, index) => segment.token ? (
          <span
            key={`${segment.token.key}:${index}`}
            className={`task-title-token task-title-token-${segment.token.field}`}
            data-tooltip={segment.token.label}
            title={segment.token.label}
            onMouseDown={(event) => { event.preventDefault(); onTokenClick(segment.token!); }}
          >{segment.text}</span>
        ) : <span key={`${segment.text}:${index}`}>{segment.text}</span>)}
        {!value && <span className="task-title-placeholder">{placeholder}</span>}
      </div>
      <input
        ref={activeInputRef}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="task-composer-title-input task-title-input-control"
        autoComplete="off"
      />
    </div>
  );
}
