import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import { MAX_POKER_ITEMS, POKER_DECK_IDS, normalizeDeckId, openPokerTasks, pokerPresets, type PokerCycleLike, type PokerPresetId, type PokerTaskLike } from "../../lib/poker";
import type { PokerDeckId } from "../../lib/api";
import { formatStoryPointsValue, normalizeStoryPoints } from "../../lib/storyPoints";
import { CardFace } from "./PokerCard";
import { pointsLabel } from "./pointsLabel";

const DECK_KEY = "prior.poker.deck";

function storedDeck(): PokerDeckId {
  try { return normalizeDeckId(window.localStorage.getItem(DECK_KEY)); } catch { return "fibonacci"; }
}

const DECK_SAMPLES: Record<PokerDeckId, readonly string[]> = { fibonacci: ["1", "3", "8"], modified: ["0.5", "5", "20"], tshirt: ["S", "M", "XL"] };

/** A fan of three cards of a deck, drawn like the real ones. */
function DeckPreview({ deck }: { readonly deck: PokerDeckId }) {
  const sample = DECK_SAMPLES[deck];
  return <span className="poker-deck-preview" aria-hidden="true">{sample.map((card, index) => <i key={card} style={{ "--fan": `${(index - (sample.length - 1) / 2) * 9}deg` } as CSSProperties}><CardFace value={card} /></i>)}</span>;
}

/** Choose the tasks to estimate (quick presets or one by one) and the deck, then deal. */
export function PokerStart<T extends PokerTaskLike & { title: string }>({ tasks, cycles, today, busy, disabled, solo, onStart }: {
  readonly tasks: readonly T[];
  readonly cycles: readonly PokerCycleLike[];
  readonly today: string;
  readonly busy: boolean;
  /** Offline or read-only. */
  readonly disabled: boolean;
  readonly solo: boolean;
  readonly onStart: (taskIds: string[], deck: PokerDeckId) => Promise<boolean>;
}) {
  const { t, tp } = useI18n();
  const open = useMemo(() => openPokerTasks(tasks), [tasks]);
  const presets = useMemo(() => pokerPresets(tasks, cycles, today), [tasks, cycles, today]);
  const [deck, setDeck] = useState<PokerDeckId>(storedDeck);
  const [preset, setPreset] = useState<PokerPresetId | "custom">(() => presets[0]?.id ?? "custom");
  const [selected, setSelected] = useState<string[]>(() => (presets[0]?.taskIds ?? []).slice(0, MAX_POKER_ITEMS));
  const [query, setQuery] = useState("");

  // Tasks change under us (a sync, an estimate): drop the ones that are gone.
  useEffect(() => {
    const ids = new Set(open.map((task) => task.id));
    setSelected((current) => current.some((id) => !ids.has(id)) ? current.filter((id) => ids.has(id)) : current);
  }, [open]);

  const chosen = new Set(selected);
  const visible = open.filter((task) => task.title.toLowerCase().includes(query.trim().toLowerCase()));

  function pickPreset(id: PokerPresetId) {
    const found = presets.find((item) => item.id === id);
    setPreset(id);
    setSelected((found?.taskIds ?? []).slice(0, MAX_POKER_ITEMS));
  }
  function toggle(id: string) {
    setPreset("custom");
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function chooseDeck(next: PokerDeckId) {
    setDeck(next);
    try { window.localStorage.setItem(DECK_KEY, next); } catch { /* the choice just is not remembered */ }
  }
  const presetLabel = (id: PokerPresetId, cycleName?: string) => id === "active" ? t("poker.start.presets.active", { name: cycleName ?? "" })
    : id === "next" ? t("poker.start.presets.next", { name: cycleName ?? "" }) : t(`poker.start.presets.${id}`);

  if (!open.length) {
    return (
      <div className="poker-empty" role="status">
        <span className="poker-empty-cards" aria-hidden="true"><i /><i /><i /></span>
        <strong>{t("poker.start.noTasksTitle")}</strong>
        <p>{t("poker.start.noTasks")}</p>
      </div>
    );
  }

  return (
    <form className="poker-start" onSubmit={(event) => { event.preventDefault(); if (selected.length && !disabled && !busy) void onStart(selected.slice(0, MAX_POKER_ITEMS), deck); }}>
      <section className="poker-start-block" aria-labelledby="poker-start-deck">
        <h3 id="poker-start-deck">{t("poker.start.deck")}</h3>
        <div className="poker-decks" role="radiogroup" aria-labelledby="poker-start-deck">
          {POKER_DECK_IDS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={deck === id} className="poker-deck" data-active={deck === id ? "true" : undefined} onClick={() => chooseDeck(id)}>
              <DeckPreview deck={id} />
              <strong>{t(`poker.decks.${id}.name`)}</strong>
              <small>{t(`poker.decks.${id}.hint`)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="poker-start-block" aria-labelledby="poker-start-tasks">
        <div className="poker-start-heading">
          <h3 id="poker-start-tasks">{t("poker.start.tasks")}</h3>
          <span className="poker-start-count" aria-live="polite">{tp("poker.start.selected", selected.length)}</span>
        </div>
        {presets.length > 0 && (
          <div className="poker-presets" role="group" aria-label={t("poker.start.presetsLabel")}>
            {presets.map((item) => (
              <button key={item.id} type="button" className="poker-preset" aria-pressed={preset === item.id} onClick={() => pickPreset(item.id)}>
                {presetLabel(item.id, item.cycleName)} <span>{item.taskIds.length}</span>
              </button>
            ))}
          </div>
        )}
        {open.length > 8 && (
          <input className="poker-search" type="search" value={query} placeholder={t("poker.start.search")} aria-label={t("poker.start.search")} onChange={(event) => setQuery(event.target.value)} />
        )}
        <ul className="poker-task-list">
          {visible.map((task) => {
            const points = normalizeStoryPoints(task.storyPoints);
            return (
              <li key={task.id}>
                <label>
                  <input type="checkbox" checked={chosen.has(task.id)} onChange={() => toggle(task.id)} />
                  <span className="poker-check" aria-hidden="true"><Icon name="check" /></span>
                  <span className="poker-task-title">{task.title}</span>
                  <span className="poker-task-points" data-empty={points === null ? "true" : undefined} title={points === null ? t("poker.start.notEstimated") : pointsLabel(t, tp, points)}>
                    {points === null ? "–" : formatStoryPointsValue(points)}
                  </span>
                </label>
              </li>
            );
          })}
          {visible.length === 0 && <li className="poker-task-none">{t("poker.start.searchNone")}</li>}
        </ul>
      </section>

      <div className="poker-start-bar">
        <p>{selected.length > MAX_POKER_ITEMS ? t("poker.start.tooMany", { max: MAX_POKER_ITEMS }) : solo ? t("poker.start.soloHint") : t("poker.start.teamHint")}</p>
        <button type="submit" className="primary-button" disabled={disabled || busy || selected.length === 0}>
          <Icon name="sparkles" aria-hidden="true" />
          <span>{busy ? t("poker.start.starting") : t("poker.start.begin")}</span>
        </button>
      </div>
    </form>
  );
}
