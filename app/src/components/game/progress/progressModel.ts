// Pure mapping from the /v1/game shapes to what the identity, fx and pet
// components draw. No rendering here, so every rule is unit-tested.
import type { ReactNode } from "react";
import { CONFETTI_THEME_SPECS } from "../../../lib/fx/themes";
import { CATALOG, CHEST_ITEMS, CRAFT_COST, achievementIcon, catalogEntry, equippedFrame, type CatalogEntry } from "../../../lib/gamification/catalog";
import type {
  ChestDrop,
  GameAchievement,
  GameBoard,
  GameChest,
  GameEquipped,
  GamePlayer,
  GameProfile,
  GameState,
  ProjectLeaderboard,
} from "../../../lib/gamification/state";
import { NAME_EFFECT_LEVELS, NAME_EFFECTS, type CosmeticKind, type NameEffectId, type PetMood, type Rarity } from "../../../lib/gamification/types";
import type { AvatarFrameId } from "../identity/frames";
import { toggleItem, type InventoryItem, type InventoryLoadout } from "../identity/inventory";
import type { EquippedTitle, PinnedBadge } from "../identity/ProfileCard";
import { nameEffectRarity } from "../identity/rules";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type EquipSlot = keyof GameEquipped;

/** Equip slot of each inventory kind (the server's EquipSlots, plus the name effect). */
export const KIND_SLOT: Readonly<Record<CosmeticKind, EquipSlot>> = {
  "name-effect": "nameEffect",
  border: "border",
  title: "title",
  "pet-hat": "petHat",
  "pet-face": "petFace",
  "pet-neck": "petNeck",
  "pet-room": "petRoom",
  confetti: "confetti",
};

const SLOT_KIND = Object.fromEntries(Object.entries(KIND_SLOT).map(([kind, slot]) => [slot, kind])) as Record<EquipSlot, CosmeticKind>;

/** Inventory ids of name effects, which are unlocked by level rather than owned. */
export const nameEffectItemId = (effect: NameEffectId) => `effect:${effect}`;

export const MAX_PINS = 3;

export function isNameEffect(value: unknown): value is NameEffectId {
  return typeof value === "string" && (NAME_EFFECTS as readonly string[]).includes(value);
}

// ── Identity ────────────────────────────────────────────────────────────────

export function anonymousName(key: string | undefined, t: Translate): string {
  const animal = key ? t(`game.animals.${key}`) : "";
  return t("game.anonymousName", { animal: animal && animal !== `game.animals.${key}` ? animal : t("game.animals.otter") });
}

/** How a player is named on boards: the handle, or the anonymous animal. */
export function displayName(player: { readonly handle: string | null; readonly anonymous?: string; readonly anonymousKey?: string }, t: Translate): string {
  if (player.handle) return player.handle;
  return anonymousName(player.anonymous ?? player.anonymousKey, t);
}

export function equippedNameEffect(equipped: GameEquipped | undefined): NameEffectId {
  return isNameEffect(equipped?.nameEffect) ? equipped.nameEffect : "plain";
}

/** The equipped border, or no frame at all when the slot is empty. */
export function equippedFrameId(equipped: GameEquipped | undefined): AvatarFrameId {
  return catalogEntry(equipped?.border)?.kind === "border" ? equippedFrame(equipped) : "none";
}

export function equippedTitle(equipped: GameEquipped | undefined, t: Translate): EquippedTitle | undefined {
  const entry = catalogEntry(equipped?.title);
  return entry?.kind === "title" ? { text: t(`game.items.${entry.id}`), rarity: entry.rarity } : undefined;
}

export function pinnedBadges(pinned: readonly string[], achievements: readonly GameAchievement[], t: Translate): PinnedBadge[] {
  return pinned.slice(0, MAX_PINS).flatMap((id) => {
    const achievement = achievements.find((item) => item.id === id);
    if (!achievement) return [];
    return [{ id, icon: achievementIcon(id), rarity: achievement.rarity, label: t(`game.achievements.${id}.name`) }];
  });
}

export function rankName(rank: string, t: Translate): string {
  return t(`game.ranks.${rank.toLowerCase()}`);
}

// ── Pet ─────────────────────────────────────────────────────────────────────

function zonedParts(date: Date, timeZone: string | undefined): { day: string; hour: number } {
  const build = (zone: string | undefined) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) % 24 };
  };
  try {
    return build(timeZone || undefined);
  } catch {
    return build(undefined);
  }
}

/**
 * The pet's mood from the profile (specs/GAMIFICATION.md §6). No guilt: at
 * worst it is sleepy. Asleep at local night, happy after a completion today.
 */
export function petMoodFor(profile: Pick<GameProfile, "streak" | "timeZone">, now: Date = new Date()): PetMood {
  const { day, hour } = zonedParts(now, profile.timeZone);
  if (hour >= 23 || hour < 6) return "asleep";
  const last = profile.streak.lastDay;
  if (last === day) return "happy";
  if (last && last === zonedParts(new Date(now.getTime() - 86_400_000), profile.timeZone).day) return "content";
  return "sleepy";
}

/** Level of the pet's next evolution, or undefined once radiant. */
export function nextEvolutionLevel(level: number): number | undefined {
  return [10, 25, 50].find((threshold) => level < threshold);
}

// ── Inventory ───────────────────────────────────────────────────────────────

export function loadoutFor(profile: Pick<GameProfile, "equipped" | "pinnedAchievements">): InventoryLoadout {
  const equipped: Partial<Record<CosmeticKind, string>> = { "name-effect": nameEffectItemId(equippedNameEffect(profile.equipped)) };
  for (const [slot, itemId] of Object.entries(profile.equipped) as [EquipSlot, string | undefined][]) {
    if (!itemId || slot === "nameEffect" || !(slot in SLOT_KIND)) continue;
    equipped[SLOT_KIND[slot]] = itemId;
  }
  return { equipped, pinnedBadges: profile.pinnedAchievements.slice(0, MAX_PINS) };
}

const CONFETTI_COLORS = (entry: CatalogEntry) => (entry.kind === "confetti" ? CONFETTI_THEME_SPECS[entry.theme].colors : []);

const KIND_ORDER: readonly CatalogEntry["kind"][] = ["border", "title", "pet-hat", "pet-face", "pet-neck", "pet-room", "confetti"];

/** The achievement that grants a border or title, if any. */
export function rewardingAchievement(itemId: string, achievements: readonly GameAchievement[]): GameAchievement | undefined {
  return achievements.find((achievement) => achievement.border === itemId || achievement.title === itemId);
}

export function achievementLabel(achievement: GameAchievement, t: Translate): string {
  return isHiddenSecret(achievement) ? t("game.secretAchievement") : t(`game.achievements.${achievement.id}.name`);
}

/**
 * Every cosmetic, owned or not, so each tab reads as a collection. Items not
 * owned are locked with where they come from: a level, an achievement or chests.
 */
export function inventoryItems(state: Pick<GameState, "profile" | "inventory" | "achievements">, t: Translate, previewFor?: (entry: CatalogEntry) => ReactNode): InventoryItem[] {
  const { profile, inventory, achievements } = state;
  const owned = new Set(inventory.map((item) => item.itemId));
  const unlockedEffects = new Set<NameEffectId>(["plain", ...profile.nameEffects]);
  const items: InventoryItem[] = NAME_EFFECTS.map((effect) => ({
    kind: "name-effect",
    id: nameEffectItemId(effect),
    label: t(`game.nameEffects.${effect}`),
    rarity: nameEffectRarity(effect),
    effect,
    locked: !unlockedEffects.has(effect),
    unlockHint: t("game.xp.level", { level: NAME_EFFECT_LEVELS[effect] }),
  }));

  const entries = [...CATALOG.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const entry of entries) {
    const label = t(`game.items.${entry.id}`);
    const locked = !owned.has(entry.id);
    const source = rewardingAchievement(entry.id, achievements);
    const unlockHint = source ? achievementLabel(source, t) : CHEST_ITEMS.includes(entry.id) ? t("progress.inventory.fromChests") : undefined;
    const base = { id: entry.id, label, rarity: entry.rarity, locked, unlockHint };
    switch (entry.kind) {
      case "border":
        items.push({ ...base, kind: "border", frame: entry.frame });
        break;
      case "title":
        items.push({ ...base, kind: "title", title: label });
        break;
      case "confetti":
        items.push({ ...base, kind: "confetti", colors: CONFETTI_COLORS(entry) });
        break;
      default:
        items.push({ ...base, kind: entry.kind, preview: previewFor?.(entry) });
    }
  }

  for (const achievement of achievements) {
    const hidden = isHiddenSecret(achievement);
    const unlocked = Boolean(achievement.unlockedAt);
    const target = achievement.target ?? 0;
    items.push({
      kind: "badge",
      id: achievement.id,
      label: achievementLabel(achievement, t),
      rarity: hidden ? "common" : achievement.rarity,
      icon: hidden ? "sparkles" : achievementIcon(achievement.id),
      locked: !unlocked,
      progress: !unlocked && target > 0 ? achievement.progress / target : undefined,
      unlockHint: unlocked ? undefined : !hidden && target > 0 ? `${achievement.progress}/${target}` : undefined,
    });
  }
  return items;
}

export type InventoryAction =
  | { readonly type: "equip"; readonly slot: EquipSlot; readonly itemId: string }
  | { readonly type: "pin"; readonly ids: string[] };

/**
 * What toggling an inventory tile asks the server: equip it, empty its slot
 * (itemId ""), or the new pin list for a badge. Locked items and re-picking
 * the implicit plain name do nothing.
 */
export function inventoryAction(loadout: InventoryLoadout, item: InventoryItem): InventoryAction | null {
  if (item.locked) return null;
  if (item.kind === "badge") return { type: "pin", ids: [...toggleItem(loadout, item, MAX_PINS).pinnedBadges] };
  const active = loadout.equipped[item.kind] === item.id;
  const slot = KIND_SLOT[item.kind];
  if (item.kind === "name-effect") {
    if (item.effect === "plain") return active ? null : { type: "equip", slot, itemId: "" };
    return { type: "equip", slot, itemId: active ? "" : item.effect };
  }
  return { type: "equip", slot, itemId: active ? "" : item.id };
}

/** The new pin list after pinning or unpinning one achievement (oldest pin makes room). */
export function togglePin(pinned: readonly string[], id: string): string[] {
  if (pinned.includes(id)) return pinned.filter((item) => item !== id);
  const next = [...pinned, id];
  return next.slice(Math.max(0, next.length - MAX_PINS));
}

export type CraftOption = { readonly id: string; readonly entry: CatalogEntry; readonly cost: number; readonly affordable: boolean };

/** Chest items the user does not own yet, cheapest first, with their stardust cost. */
export function craftOptions(state: Pick<GameState, "profile" | "inventory">): CraftOption[] {
  const owned = new Set(state.inventory.map((item) => item.itemId));
  const rarityRank: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
  return CHEST_ITEMS.flatMap((id) => {
    const entry = catalogEntry(id);
    if (!entry || owned.has(id)) return [];
    const cost = CRAFT_COST[entry.rarity];
    return [{ id, entry, cost, affordable: state.profile.stardust >= cost }];
  }).sort((a, b) => rarityRank[a.entry.rarity] - rarityRank[b.entry.rarity]);
}

// ── Achievements ────────────────────────────────────────────────────────────

/** A secret achievement stays anonymous until it is unlocked. */
export function isHiddenSecret(achievement: GameAchievement): boolean {
  return Boolean(achievement.secret) && !achievement.unlockedAt;
}

export type AchievementGroup = { readonly category: string; readonly items: readonly GameAchievement[]; readonly unlocked: number };

/** Achievements grouped by category, in the server's display order. */
export function achievementGroups(achievements: readonly GameAchievement[]): AchievementGroup[] {
  const groups = new Map<string, GameAchievement[]>();
  for (const achievement of achievements) {
    const list = groups.get(achievement.category) ?? [];
    list.push(achievement);
    groups.set(achievement.category, list);
  }
  return [...groups].map(([category, items]) => ({ category, items, unlocked: items.filter((item) => item.unlockedAt).length }));
}

/** 0–1 progress of a counter achievement; undefined for one-off conditions. */
export function achievementProgress(achievement: GameAchievement): number | undefined {
  if (achievement.unlockedAt) return 1;
  const target = achievement.target ?? 0;
  return target > 0 ? Math.min(1, Math.max(0, achievement.progress / target)) : undefined;
}

// ── Chests ──────────────────────────────────────────────────────────────────

export function chestTitle(tier: Rarity, t: Translate): string {
  return t("game.chest.title", { tier: t(`game.rarity.${tier}`) });
}

export function chestSource(chest: GameChest, t: Translate): string {
  switch (chest.source) {
    case "level":
      return t("progress.chests.fromLevel", { level: chest.sourceRef });
    case "streak":
      return t("progress.chests.fromStreak", { days: chest.sourceRef });
    case "achievement":
      return t("progress.chests.fromAchievement", { name: t(`game.achievements.${chest.sourceRef}.name`) });
    default:
      return t("progress.chests.fromReward");
  }
}

export type DropKind = CatalogEntry["kind"] | "freeze";

export type ChestRewardData = {
  readonly id: string;
  readonly itemId?: string;
  readonly kind: DropKind;
  readonly label: string;
  readonly kindLabel: string;
  readonly rarity: Rarity;
  readonly duplicate: boolean;
  readonly stardust?: number;
};

/**
 * What came out of a chest, ready for ChestOpening. A freeze that did not fit
 * (two already held) arrives without an item and as stardust: it plays as a
 * duplicate freeze.
 */
export function chestRewards(drops: readonly ChestDrop[], t: Translate): ChestRewardData[] {
  return drops.map((drop, index) => {
    const entry = catalogEntry(drop.itemId);
    if (entry) {
      return {
        id: `${index}-${entry.id}`,
        itemId: entry.id,
        kind: entry.kind,
        label: t(`game.items.${entry.id}`),
        kindLabel: t(`progress.kinds.${entry.kind}`),
        rarity: drop.rarity ?? entry.rarity,
        duplicate: Boolean(drop.duplicate),
        stardust: drop.duplicate ? drop.stardust : undefined,
      };
    }
    const overflow = !drop.freeze && (drop.stardust ?? 0) > 0;
    return {
      id: `${index}-freeze`,
      kind: "freeze",
      label: t("game.chest.freeze"),
      kindLabel: t("progress.kinds.freeze"),
      rarity: drop.rarity ?? "rare",
      duplicate: overflow,
      stardust: overflow ? drop.stardust : undefined,
    };
  });
}

// ── Boards ──────────────────────────────────────────────────────────────────

/** Stable row id: boards never expose user ids. */
export function playerId(player: GamePlayer): string {
  return player.isMe ? "me" : `p${player.position}-${player.handle ?? player.anonymous ?? ""}`;
}

/**
 * The board's rows plus the viewer's own entry when it sits outside them, and
 * whether places are skipped between the two (drawn as a gap).
 */
export function boardEntries(board: GameBoard): { readonly rows: readonly GamePlayer[]; readonly me: GamePlayer | null; readonly gap: boolean } {
  const inList = board.players.some((player) => player.isMe);
  const me = !inList && board.me ? board.me : null;
  const last = board.players[board.players.length - 1];
  return { rows: board.players, me, gap: Boolean(me && last && me.position > last.position + 1) };
}

/** Suggested weekly team goal: about 400 XP per member, at least 500. */
export function suggestedTeamGoal(memberCount: number): number {
  return Math.max(500, Math.round((Math.max(1, memberCount) * 400) / 100) * 100);
}

export function teamGoal(board: Pick<ProjectLeaderboard, "teamGoalXp" | "members">): number {
  return board.teamGoalXp > 0 ? board.teamGoalXp : suggestedTeamGoal(board.members.length);
}

/** Monday 00:00 UTC after weekStart, in epoch ms. */
export function weekEnd(weekStart: string): number {
  const start = Date.parse(weekStart);
  return Number.isFinite(start) ? start + 7 * 86_400_000 : Date.now();
}

/** True when the browser reports no network: failures read as offline, not broken. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
