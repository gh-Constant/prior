// Inventory: every cosmetic as a collection (owned items equip, the rest say
// where they come from), a live leaderboard preview, and crafting with
// stardust for chest items not owned yet.
import { useMemo, useState } from "react";
import type { GameState } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../Icon";
import { Modal } from "../../Modal";
import { StardustIcon } from "../identity/glyphs";
import { InventoryView, type InventoryLabels } from "../identity/InventoryView";
import type { InventoryItem } from "../identity/inventory";
import { PetItemPreview, PlayerAvatar, RewardIcon } from "./ProgressGlyphs";
import { craftOptions, displayName, inventoryAction, inventoryItems, loadoutFor, rankName, type CraftOption, type EquipSlot } from "./progressModel";

export type InventoryTabProps = {
  readonly state: GameState;
  readonly onEquip: (slot: EquipSlot, itemId: string) => void;
  readonly onPin: (ids: string[]) => void;
  readonly onCraft: (itemId: string) => Promise<unknown>;
};

export function InventoryTab({ state, onEquip, onPin, onCraft }: InventoryTabProps) {
  const { t, lang } = useI18n();
  const [crafting, setCrafting] = useState(false);
  const { profile } = state;
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const items = useMemo(() => inventoryItems(state, t, (entry) => <PetItemPreview entry={entry} />), [state, t]);
  const loadout = useMemo(() => loadoutFor(profile), [profile]);
  const name = displayName(profile, t);
  const pet = profile.pet;
  const hatched = Boolean(pet?.species && pet.hatchedAt);

  const labels: InventoryLabels = {
    title: t("progress.inventory.title"),
    tabs: {
      "name-effect": t("progress.inventory.tabs.name-effect"),
      border: t("progress.inventory.tabs.border"),
      title: t("progress.inventory.tabs.title"),
      pet: t("progress.inventory.tabs.pet"),
      confetti: t("progress.inventory.tabs.confetti"),
      badge: t("progress.inventory.tabs.badge"),
    },
    rarity: { common: t("game.rarity.common"), rare: t("game.rarity.rare"), epic: t("game.rarity.epic"), legendary: t("game.rarity.legendary") },
    equip: t("progress.inventory.equip"),
    equipped: t("progress.inventory.equipped"),
    pin: t("progress.inventory.pin"),
    pinned: t("progress.inventory.pinned"),
    locked: t("progress.inventory.locked"),
    craft: t("progress.inventory.craft"),
    stardust: (amount) => t("progress.inventory.stardust", { count: number.format(amount) }),
    preview: t("progress.inventory.preview"),
    empty: t("progress.inventory.empty"),
  };

  function toggle(item: InventoryItem) {
    const action = inventoryAction(loadout, item);
    if (!action) return;
    if (action.type === "pin") onPin(action.ids);
    else onEquip(action.slot, action.itemId);
  }

  return (
    <div className="gp-inventory">
      <InventoryView
        items={items}
        loadout={loadout}
        onToggle={toggle}
        profile={{
          name,
          avatar: <PlayerAvatar pet={hatched && pet?.species ? { species: pet.species, stage: pet.stage } : null} equipped={profile.equipped} name={name} />,
          level: profile.progress.level,
          rank: rankName(profile.rank, t),
          league: profile.leagueTier,
          leagueName: t(`game.leagues.${profile.leagueTier}`),
        }}
        profileLabels={{
          level: (level) => t("game.xp.level", { level }),
          pinned: t("progress.achievements.pinnedList"),
          league: (tier) => t("game.leagueName", { tier }),
        }}
        stardust={profile.stardust}
        onCraft={() => setCrafting(true)}
        labels={labels}
      />
      {crafting && <CraftDialog state={state} onCraft={onCraft} onClose={() => setCrafting(false)} />}
    </div>
  );
}

function CraftDialog({ state, onCraft, onClose }: { readonly state: GameState; readonly onCraft: (itemId: string) => Promise<unknown>; readonly onClose: () => void }) {
  const { t, lang } = useI18n();
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const options = craftOptions(state);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ readonly tone: "done" | "error"; readonly text: string } | null>(null);

  async function craft(option: CraftOption) {
    if (busy) return;
    setBusy(option.id);
    setMessage(null);
    try {
      await onCraft(option.id);
      setMessage({ tone: "done", text: t("progress.inventory.crafted", { item: t(`game.items.${option.id}`) }) });
    } catch {
      setMessage({ tone: "error", text: t("progress.inventory.craftFailed") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={t("progress.inventory.craftTitle")} onClose={onClose} className="gp-craft" maxWidth={520}>
      <div className="gp-craft-body">
        <div className="gp-craft-intro">
          <p>{t("progress.inventory.craftBody")}</p>
          <span className="gp-pill" aria-label={`${t("progress.inventory.balance")}: ${t("progress.inventory.stardust", { count: number.format(state.profile.stardust) })}`}>
            <StardustIcon size={14} />
            <b>{number.format(state.profile.stardust)}</b>
          </span>
        </div>
        {message && (
          <p className={`gp-craft-message gp-craft-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            <Icon name={message.tone === "error" ? "cloud" : "check-circle"} width={15} height={15} />
            {message.text}
          </p>
        )}
        {options.length === 0 ? (
          <p className="gp-empty">{t("progress.inventory.craftAll")}</p>
        ) : (
          <ul className="gp-craft-list">
            {options.map((option) => (
              <li key={option.id} className="gp-craft-item" data-rarity={option.entry.rarity}>
                <span className="gp-craft-art" aria-hidden="true">
                  <CraftArt option={option} />
                </span>
                <span className="gp-craft-text">
                  <b>{t(`game.items.${option.id}`)}</b>
                  <span>
                    <span className="gp-rarity">{t(`game.rarity.${option.entry.rarity}`)}</span> · {t(`progress.kinds.${option.entry.kind}`)}
                  </span>
                </span>
                <button
                  type="button"
                  className="gp-button gp-button--sm"
                  disabled={!option.affordable || busy !== null}
                  aria-busy={busy === option.id}
                  onClick={() => void craft(option)}
                  title={option.affordable ? undefined : t("progress.inventory.craftMissing", { count: number.format(option.cost - state.profile.stardust) })}
                >
                  <StardustIcon size={12} />
                  {number.format(option.cost)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function CraftArt({ option }: { readonly option: CraftOption }) {
  const { entry } = option;
  return entry.kind.startsWith("pet-") ? <PetItemPreview entry={entry} /> : <RewardIcon entry={entry} />;
}
