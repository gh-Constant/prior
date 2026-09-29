// Inventory: tabs of collectible cosmetics with rarity rims, locked unlock
// conditions, equip/pin actions, stardust and crafting, and a live preview of
// the profile card as it will appear on leaderboards.
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { EffectsIntensity, Rarity } from "../../../lib/gamification/types";
import { Icon } from "../../Icon";
import { AchievementBadge } from "./AchievementBadge";
import { AvatarFrame, AvatarPlaceholder } from "./AvatarFrame";
import { ConfettiPreview, StardustIcon } from "./glyphs";
import {
  INVENTORY_TABS,
  equippedItem,
  isEquipped,
  pinnedBadgeItems,
  tabCounts,
  tabForItem,
  type InventoryItem,
  type InventoryLoadout,
  type InventoryTab,
} from "./inventory";
import { Nameplate } from "./Nameplate";
import { ProfileCard, type ProfileCardProps } from "./ProfileCard";
import { TitleChip } from "./TitleChip";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./InventoryView.css";

export type InventoryLabels = {
  readonly title: string;
  readonly tabs: Readonly<Record<InventoryTab, string>>;
  readonly rarity: Readonly<Record<Rarity, string>>;
  readonly equip: string;
  readonly equipped: string;
  readonly pin: string;
  readonly pinned: string;
  readonly locked: string;
  readonly craft: string;
  readonly stardust: (amount: number) => string;
  readonly preview: string;
  readonly empty: string;
};

const DEFAULT_LABELS: InventoryLabels = {
  title: "Inventory",
  tabs: { "name-effect": "Name effects", border: "Borders", title: "Titles", pet: "Pet", confetti: "Confetti", badge: "Badges" },
  rarity: { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" },
  equip: "Equip",
  equipped: "Equipped",
  pin: "Pin",
  pinned: "Pinned",
  locked: "Locked",
  craft: "Craft",
  stardust: (amount) => `${amount.toLocaleString("en-US")} stardust`,
  preview: "Leaderboard preview",
  empty: "Nothing here yet.",
};

export type InventoryProfile = Omit<ProfileCardProps, "nameEffect" | "frame" | "title" | "badges" | "tone" | "intensity" | "labels" | "className">;

export type InventoryViewProps = {
  readonly items: readonly InventoryItem[];
  readonly loadout: InventoryLoadout;
  /** Equip/unequip (or pin/unpin a badge). Use toggleItem() for the default rules. */
  readonly onToggle: (item: InventoryItem) => void;
  /** Base identity for the live preview; equipped cosmetics are layered on top. */
  readonly profile: InventoryProfile;
  readonly stardust: number;
  readonly onCraft?: () => void;
  readonly defaultTab?: InventoryTab;
  readonly labels?: Partial<InventoryLabels>;
  readonly profileLabels?: ProfileCardProps["labels"];
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

function ItemArt({ item, name }: { readonly item: InventoryItem; readonly name: string }): ReactNode {
  // Locked previews stay still: motion is part of the reward.
  const still = item.locked ? "off" : undefined;
  switch (item.kind) {
    case "name-effect":
      return <Nameplate name={name} effect={item.effect} size="md" intensity={still} />;
    case "border":
      return (
        <AvatarFrame frame={item.frame} size={60} intensity={still}>
          <AvatarPlaceholder name={name} />
        </AvatarFrame>
      );
    case "title":
      return <TitleChip title={item.title} rarity={item.rarity} intensity={still} />;
    case "confetti":
      return <ConfettiPreview colors={item.colors} seed={item.id} />;
    case "badge":
      return <AchievementBadge icon={item.icon} rarity={item.rarity} label={item.label} size={54} locked={item.locked} progress={item.progress} />;
    default:
      return item.preview ?? <Icon name="gift" width={32} height={32} />;
  }
}

export function InventoryView({
  items,
  loadout,
  onToggle,
  profile,
  stardust,
  onCraft,
  defaultTab = "name-effect",
  labels,
  profileLabels,
  tone,
  intensity,
  className,
}: InventoryViewProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const text = { ...DEFAULT_LABELS, ...labels };
  const [tab, setTab] = useState<InventoryTab>(defaultTab);
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const visible = items.filter((item) => tabForItem(item) === tab);

  const effect = equippedItem(items, loadout, "name-effect");
  const border = equippedItem(items, loadout, "border");
  const title = equippedItem(items, loadout, "title");
  const badges = pinnedBadgeItems(items, loadout).map((badge) => ({ id: badge.id, icon: badge.icon, rarity: badge.rarity, label: badge.label }));

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = INVENTORY_TABS.indexOf(tab);
    const next = INVENTORY_TABS[(index + (event.key === "ArrowRight" ? 1 : INVENTORY_TABS.length - 1)) % INVENTORY_TABS.length];
    setTab(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <section className={cx("gi-inv", identityClass(resolvedTone, fx), className)} aria-label={text.title}>
      <div className="gi-inv-preview">
        <span className="gi-inv-eyebrow">{text.preview}</span>
        <ProfileCard
          {...profile}
          nameEffect={effect?.effect ?? "plain"}
          frame={border?.frame ?? "none"}
          title={title ? { text: title.title, rarity: title.rarity } : undefined}
          badges={badges}
          labels={profileLabels}
          tone={resolvedTone}
          intensity={intensity}
        />
      </div>

      <div className="gi-inv-bar">
        <h3>{text.title}</h3>
        <span className="gi-inv-dust" title={text.stardust(stardust)}>
          <StardustIcon size={16} />
          <b>{stardust.toLocaleString("en-US")}</b>
          <span className="gi-inv-sr">{text.stardust(stardust)}</span>
        </span>
        <button type="button" className="gi-inv-craft" onClick={onCraft}>
          <Icon name="sparkles" width={14} height={14} strokeWidth={2} />
          {text.craft}
        </button>
      </div>

      <div className="gi-inv-tabs" role="tablist" aria-label={text.title} onKeyDown={onTabKey}>
        {INVENTORY_TABS.map((option) => {
          const counts = tabCounts(items, option);
          return (
            <button
              key={option}
              id={`${baseId}-tab-${option}`}
              type="button"
              role="tab"
              aria-selected={tab === option}
              aria-controls={`${baseId}-panel`}
              tabIndex={tab === option ? 0 : -1}
              onClick={() => setTab(option)}
            >
              {text.tabs[option]}
              <span className="gi-inv-count">
                {counts.owned}/{counts.total}
              </span>
            </button>
          );
        })}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="gi-inv-panel">
        {visible.length === 0 ? (
          <p className="gi-inv-empty">{text.empty}</p>
        ) : (
          <ul className="gi-inv-grid">
            {visible.map((item) => {
              const active = isEquipped(loadout, item);
              const badge = item.kind === "badge";
              return (
                <li
                  key={item.id}
                  className={cx("gi-inv-tile", active && "gi-inv-tile--on", item.locked && "gi-inv-tile--locked")}
                  data-rarity={item.rarity}
                >
                  <div className="gi-inv-art">
                    <ItemArt item={item} name={profile.name} />
                  </div>
                  <div className="gi-inv-meta">
                    <span className="gi-inv-name">{item.label}</span>
                    <span className="gi-inv-rarity">{text.rarity[item.rarity]}</span>
                  </div>
                  {item.locked ? (
                    <span className="gi-inv-action gi-inv-action--locked">
                      <Icon name="lock" width={12} height={12} strokeWidth={2.2} />
                      {item.unlockHint ?? text.locked}
                    </span>
                  ) : (
                    <button type="button" className="gi-inv-action" aria-pressed={active} onClick={() => onToggle(item)}>
                      {active && <Icon name="check" width={13} height={13} strokeWidth={2.4} />}
                      {active ? (badge ? text.pinned : text.equipped) : badge ? text.pin : text.equip}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
