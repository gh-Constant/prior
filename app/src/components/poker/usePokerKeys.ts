import { useEffect, useRef, useState } from "react";
import { resolveCardKey } from "../../lib/poker";
import type { PokerDeckId } from "../../lib/api";

type Options = {
  enabled: boolean;
  deck: PokerDeckId;
  canVote: boolean;
  canControl: boolean;
  revealed: boolean;
  onPick: (card: string) => void;
  onClear: () => void;
  /** Enter: reveal the cards, or accept the estimate once they are shown. */
  onPrimary: () => void;
  onRevote: () => void;
};

/** A pause this long commits an ambiguous card ("1" while "13" is also possible). */
const COMMIT_MS = 450;

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Keyboard play: type a card ("5", "13", ".5", "xl", "?", "c"), Enter reveals
 * (then accepts), R re-votes, Backspace takes your card back. Returns the
 * keys typed so far so the hand can show them while a card is still pending.
 */
export function usePokerKeys(options: Options): string {
  const latest = useRef(options);
  latest.current = options;
  const [pending, setPending] = useState("");

  useEffect(() => {
    if (!options.enabled) return undefined;
    let buffer = "";
    let timer: number | undefined;
    const reset = () => { window.clearTimeout(timer); buffer = ""; setPending(""); };
    const commit = () => {
      const { card } = resolveCardKey(buffer, latest.current.deck);
      if (card) latest.current.onPick(card);
      reset();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      // A dialog (sharing, task editor) owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      const current = latest.current;
      // Enter on a focused card would un-pick it; the table's own buttons keep their Enter.
      const onButton = event.target instanceof HTMLElement && !event.target.closest(".poker-hand-card") && Boolean(event.target.closest("button, a, summary, [role='button']"));
      if (event.key === "Enter") {
        if (onButton || !current.canControl) return;
        event.preventDefault();
        current.onPrimary();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!current.canVote || current.revealed) return;
        event.preventDefault();
        reset();
        current.onClear();
        return;
      }
      if (current.revealed) {
        if ((event.key === "r" || event.key === "R") && current.canControl) { event.preventDefault(); current.onRevote(); }
        return;
      }
      if (!current.canVote || event.key.length !== 1) return;
      const next = buffer + event.key;
      let resolved = resolveCardKey(next, current.deck);
      let typed = next;
      if (!resolved.card && !resolved.pending) {
        // Not a continuation: start over with this key alone.
        typed = event.key;
        resolved = resolveCardKey(typed, current.deck);
      }
      if (!resolved.card && !resolved.pending) { reset(); return; }
      event.preventDefault();
      window.clearTimeout(timer);
      buffer = typed;
      if (resolved.card && !resolved.pending) { commit(); return; }
      setPending(typed);
      timer = window.setTimeout(commit, COMMIT_MS);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.clearTimeout(timer); };
  }, [options.enabled]);

  return pending;
}
