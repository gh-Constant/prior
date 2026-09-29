// Shapes returned by the /v1/game endpoints (server/internal/store/game_*.go).
import type { EffectsIntensity, LeagueTier, NameEffectId, PetSpecies, PetStage, Rarity } from "./types";

export type GameVisibility = "public" | "anonymous" | "hidden";

export type GameProgress = { readonly level: number; readonly xpInLevel: number; readonly xpForLevel: number };

export type GameStreak = { readonly current: number; readonly best: number; readonly freezes: number; readonly lastDay?: string };

export type GamePet = { readonly species: PetSpecies | null; readonly name: string; readonly stage: PetStage; readonly hatchedAt: string | null };

/** Equip slots: nameEffect, border, title, petHat, petFace, petNeck, petRoom, confetti. */
export type GameEquipped = Partial<Record<"nameEffect" | "border" | "title" | "petHat" | "petFace" | "petNeck" | "petRoom" | "confetti", string>>;

export type GameProfile = {
  readonly onboardingVersion: number;
  /** The onboarding version the server expects; lower means new steps to show. */
  readonly currentOnboarding: number;
  readonly enabled: boolean;
  readonly handle: string | null;
  readonly anonymousKey: string;
  readonly visibility: GameVisibility;
  readonly effects: EffectsIntensity;
  readonly sounds: boolean;
  readonly timeZone: string;
  readonly xp: number;
  readonly progress: GameProgress;
  readonly rank: string;
  readonly todayTaskXp: number;
  readonly dailyCapXp: number;
  readonly streak: GameStreak;
  readonly stardust: number;
  readonly leagueTier: LeagueTier;
  readonly pet: GamePet | null;
  readonly equipped: GameEquipped;
  readonly pinnedAchievements: string[];
  readonly nameEffects: NameEffectId[];
};

export type GameInventoryItem = { readonly itemId: string; readonly kind: string; readonly acquiredAt: string };

export type GameAchievement = {
  readonly id: string;
  readonly category: string;
  readonly rarity: Rarity;
  readonly secret?: boolean;
  readonly border?: string;
  readonly title?: string;
  readonly target?: number;
  readonly progress: number;
  readonly unlockedAt: string | null;
};

export type GameChest = { readonly id: string; readonly tier: Rarity; readonly source: string; readonly sourceRef: string; readonly grantedAt: string };

export type GameEventKind =
  | "level_up" | "pet_hatched" | "pet_evolved" | "achievement_unlocked" | "streak_milestone" | "freeze_used"
  | "backfill" | "league_result" | "kudos_received";

export type GameEvent = { readonly id: number; readonly kind: GameEventKind; readonly payload: Record<string, unknown>; readonly createdAt: string };

export type GameState = {
  readonly profile: GameProfile;
  readonly inventory: GameInventoryItem[];
  readonly achievements: GameAchievement[];
  readonly chests: GameChest[];
  readonly events: GameEvent[];
};

export type GameSettingsPatch = Partial<{
  onboardingVersion: number;
  enabled: boolean;
  visibility: GameVisibility;
  effects: EffectsIntensity;
  sounds: boolean;
  timeZone: string;
}>;

export type ChestDrop = {
  readonly itemId?: string;
  readonly kind?: string;
  readonly rarity: Rarity;
  readonly duplicate?: boolean;
  readonly stardust?: number;
  readonly freeze?: boolean;
};

export type GamePlayer = {
  readonly position: number;
  readonly handle: string | null;
  readonly anonymous?: string;
  readonly level: number;
  readonly rank: string;
  readonly xp: number;
  readonly streak: number;
  readonly leagueTier: LeagueTier;
  readonly equipped: GameEquipped;
  readonly pet: { readonly species: PetSpecies; readonly stage: PetStage } | null;
  readonly isMe: boolean;
};

export type GameBoard = { readonly board: "level" | "streak"; readonly players: GamePlayer[]; readonly me: GamePlayer | null };

export type GameLeague = {
  readonly tier: LeagueTier;
  readonly tierIndex: number;
  readonly weekStart: string;
  readonly endsAt: string;
  readonly joined: boolean;
  readonly promote: number;
  readonly demote: number;
  readonly members: (GamePlayer & { readonly weeklyXp: number })[];
  readonly lastResult: { readonly outcome: "promoted" | "stayed" | "demoted"; readonly rank: number; readonly tier: LeagueTier } | null;
};

export type ProjectLeaderboardMode = "off" | "competitive" | "team";

export type ProjectLeaderboard = {
  readonly mode: ProjectLeaderboardMode;
  readonly teamGoalXp: number;
  readonly isOwner: boolean;
  /** null until the viewer decides whether to appear on this board. */
  readonly myChoice: boolean | null;
  readonly weekStart: string;
  readonly teamWeeklyXp: number;
  readonly members: {
    readonly userId: string;
    readonly displayName: string;
    readonly avatarUrl: string;
    readonly level: number;
    readonly equipped: GameEquipped;
    readonly pet: { readonly species: PetSpecies; readonly stage: PetStage } | null;
    readonly weeklyXp: number;
    readonly totalXp: number;
    readonly isMe: boolean;
  }[];
};

export type InvitePreview = {
  readonly projectName: string;
  readonly projectIcon: string;
  readonly inviterName: string;
  readonly inviterAvatarUrl: string;
  readonly memberCount: number;
  readonly role: "editor" | "viewer";
  readonly status: "pending" | "accepted" | "expired";
};
