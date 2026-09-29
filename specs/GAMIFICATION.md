# Onboarding and gamification

Status: implemented. The client and server described here ship together; the Game Lab (`app/lab.html`, dev only) shows every visual piece in isolation.

Prior stays usable exactly as today. Gamification is a per-account choice, **Calm** or **Gamified**, made during onboarding and changeable in Settings → Account. Status is **earned, never bought**: paid plans (see `BILLING.md`) grant no cosmetics, XP or league advantage.

## 1. Onboarding

Production builds already require an account (`AuthGate`). Onboarding runs once per account, after authentication, full screen, about 60 seconds.

1. **Invite landing** (only when arriving from a share link): "Alex invited you to *Website Redesign*" with the project icon and member avatars, then Sign in / Create account. Backed by a public `GET /v1/collaboration/invites/preview?token=` that returns project name, icon, inviter display name and member count, never emails.
2. **Account**: sign in or create.
3. **Profile**: display name, avatar, language.
4. **How you work**: default view, week start, reminders.
5. **Choose your experience**: two cards with live animated previews, Calm or Gamified.
6. **If Gamified**: public handle, leaderboard visibility, effects intensity (Full / Subtle), sounds (off by default).
7. **Your egg**: the user receives a pet egg. "Complete your first task to hatch it."
8. **First win**: "Add three things on your mind", complete one, then the egg hatches and the user reaches level 2.

Existing accounts see a short version (steps 5–7) the next time they open the app. No data is touched. Onboarding completion is stored on the server with a version number, so it shows once per account, not once per device, and a future version can re-run only new steps.

**Invite token persistence.** Today the web Google sign-in navigates away and the `#invite=` token is lost. The token is saved in storage before any auth redirect and accepted right after authentication, then the project opens. The "copy project link" action (`#project=`) must use `WEB_APP_URL` on native builds like invite links already do.

## 2. Experience points

The server is the only authority for XP. The client shows XP instantly (optimistic) and reconciles on sync.

| Source | XP |
|---|---|
| Focus task (important + urgent) | 30 |
| Plan task (important, not urgent) | 25 |
| Quick task (urgent, not important) | 10 |
| Later task | 5 |
| Completed on or before its due date | +20% |
| Habit check-in | 10, +1 per streak day up to +10 |
| Kudos received | 5 each, at most 5 per day |
| Achievement unlocked | one-time bonus by rarity |

Plan tasks earn almost as much as Focus on purpose: important-but-not-urgent work is what people neglect.

**Anti-farming** (required for fair leaderboards):

- A task awards XP once. Un-completing takes it back; completing it again restores the same amount, never more. Level-up chests are granted once per level, so toggling can't farm them.
- A task completed less than one minute after creation awards 1 XP. Creation time comes from the client (Prior works offline), so this only stops casual farming; the daily cap below is what bounds a scripted client.
- Daily diminishing returns on task XP: full up to 300, then 50%, then 20% after 600, and nothing past a hard cap of 800 (about sixty Focus tasks).
- XP is written in the same transaction as the task mutation that completes it, keyed `(user_id, source_kind, source_id)` so retries and multiple devices can never double-count.
- Project tasks credit the member who completed them.

**Levels.** A smooth curve with no cap, calibrated so that an active user (about 150 XP/day) reaches level 10 in about two weeks, level 20 in about six weeks, level 50 in about a year, and level 100 in several years. Exact constants live in one rules module with tests.

**Ranks** every 10 levels: Spark, Ember, Flame, Blaze, Nova, Comet, Star, Nebula, Galaxy, Infinity.

**First activation.** The past 90 days of completed tasks are credited once ("You're already level 7!"). This backfilled XP counts toward level and all-time boards, never toward weekly leagues.

**Calm mode** keeps recording XP silently, so switching back to Gamified restores the real level.

## 3. Streaks

- A day counts when the user completes at least one qualifying task or habit check-in, in their own time zone.
- **Streak freezes** are consumed automatically on a missed day. They are earned (every 7 consecutive days, and from chests), never bought. At most 2 are held.
- Milestones at 7, 30, 100 and 365 days give a chest.

## 4. Achievements

About 30 achievements in categories: Getting started, Consistency, Focus, Planning, Habits, Team, Secret. Each has a rarity (Common, Rare, Epic, Legendary), unlocks a matching **avatar border**, and some grant a **title** (for example "Unbreakable", "The Planner"). Users can pin three achievements to their profile card.

## 5. Chests and inventory

**Chests** come from level-ups (common), every fifth level (rare), streak milestones, and some achievements (epic, legendary). Contents are rolled **on the server when the chest is granted**, so they cannot be re-rolled from the client. Opening plays a shake → glow in the rarity color → burst sequence.

Contents are cosmetic only, plus streak freezes: pet hats, accessories and room items, avatar border variants, confetti themes, titles. Duplicates become **stardust**, which can be spent to craft a specific item.

**Inventory** has tabs for Name effects, Borders, Titles, Pet (hats, accessories, room), Confetti and Badges. Each tab has equip slots, plus a live preview of the profile card as it appears on leaderboards.

Rarity colors: Common grey, Rare blue, Epic purple, Legendary orange-gold.

### Name effects (earned by level)

| Level | Effect |
|---|---|
| 5 | Copper: warm metallic gradient |
| 10 | Silver: moving sheen |
| 20 | Gold: animated shimmer with rising gold particles |
| 30 | Emerald: soft green glow with glints |
| 40 | Sapphire: deep blue with twinkling specks |
| 50 | Diamond: prismatic refraction with sparkles |
| 75 | Aurora: flowing northern-lights gradient |
| 100 | Mythic: prismatic flame with orbiting particles |

Unlocked effects stay in the inventory. Users can equip any effect they have unlocked. A viewer in Calm mode sees everyone's names plain.

## 6. Pet

- Received as an egg during onboarding. It hatches after the first completed task into one of four species, chosen at random with rarity weights, one of them rare. The user names it.
- It evolves at levels 10, 25 and 50: baby → young → adult → radiant.
- **No guilt, ever.** It never gets sick, sad or dies. Moods: happy (recent completion), content, sleepy (no activity for a day), asleep (local night), excited (level-up).
- **Reactions**: hops and a heart on task completion, dances on level-up, blinks, yawns, follows the cursor with its eyes on desktop, and purrs when clicked.
- **Where it lives**: bottom of the sidebar on desktop, Today header on mobile, and its own page (the Den) with its room, wardrobe and evolution history.
- It is the user's avatar on leaderboards: a headshot with the equipped hat.
- Art is vector drawn in code, made of named parts animated separately (body, eyes, mouth, ears or wings, accessory anchors), so outfits and expressions combine freely without image files.

## 7. Leaderboards

**Identity.** Unique handle of 3–20 characters `[a-z0-9_]`, with reserved words and a profanity filter. Leaderboards show handle, level, rank, pet avatar and equipped cosmetics, never email or real name.

**Visibility.** Public, Anonymous (a generated "Anonymous Otter" name) or Hidden. **Default: Hidden (opt-in)**. Calm users never appear.

**Weekly leagues** (Duolingo-style):

- Ten tiers: Pebble, Bronze, Silver, Gold, Sapphire, Ruby, Emerald, Amethyst, Obsidian, Diamond.
- Cohorts of about 30 players at the same tier, formed when a player earns their first XP of the week.
- Ranking by weekly XP. The top 7 move up and the bottom 5 move down (not from the lowest tier).
- The week ends Monday 00:00 UTC. A server job run under a PostgreSQL advisory lock closes cohorts and records results.

**All-time boards**: Level, Current streak.

**Project leaderboards.** The project owner chooses a mode in project settings:

- **Off**.
- **Competitive**: members ranked by XP earned on this project's tasks, this week and all-time.
- **Team** (suggested default when enabling): one shared weekly progress bar toward a team goal, with contributions listed but not ranked.

Because Team and Enterprise plans are workplaces, each member **opts in per project** the first time they open a project with a leaderboard. Declining is silent and final until they change it.

**Kudos**: react 🎉 to a teammate's completed task. It gives them a small XP bonus, with a daily limit.

## 8. Effects

- **Task completion** scales with value: Later gets a sparkle, Focus gets a confetti burst from the checkbox. A "+30 XP" label flies into the XP bar.
- **XP bar** in the sidebar: liquid fill, a shimmer sweep, and a glowing edge near the next level.
- **Level-up**: the screen dims, a radial light burst, the number counts up, a confetti cannon, the new rank, then the chest reveal. Skippable, about 2.5 seconds.
- **Clearing a quadrant** plays a wave across it.
- **Streak flame** grows with streak length. **Achievement toast** flips the badge in.
- **Sounds** are synthesized with Web Audio (no files), off by default. **Haptics** on Android.
- **Performance and accessibility**:
  - One shared full-screen canvas particle engine: pooled particles, DPR-aware, paused when the window is hidden.
  - No heavy animation libraries.
  - Subtle mode uses about 30% of the particles and no screen dimming.
  - `prefers-reduced-motion` disables motion and keeps plain feedback.

## 9. Architecture

### Server (implemented)

- **Migration**: `server/internal/database/migrations/027_gamification.sql`.
  - Profiles: `game_profiles`.
  - XP ledger: `xp_events`, unique per `(user, source_kind, source_id)`. Each task entry records its quadrant, whether it was on time, and the local hour, so achievements can be counted from the ledger.
  - Rewards: `user_achievements`, `inventory_items`, and `chests` (contents rolled at grant, idempotent per source).
  - Celebrations: `game_events` (unseen celebrations, pruned 30 days after being seen).
  - Leagues: `league_cohorts`, `league_members`.
  - Projects: `project_game_settings` (separate from `projects`, so workspace sync can't overwrite it), `project_leaderboard_optins`.
  - Social: `kudos`.
- **Rules**: `server/internal/gamification`, pure and unit-tested.
  - XP and the daily curve, levels and ranks, streaks and freezes.
  - Chests and loot tables, leagues, achievements.
  - The cosmetic catalog; handle validation (reserved words; profanity matched as stems, or as whole words for ambiguous ones).
- **Store**:
  - `server/internal/store/game.go`: the award engine.
    - `Store.Push` records task completions and habit check-ins in the same transaction, inside a savepoint that can never fail the sync.
    - A completion synced more than 48 h late is dated to the sync, so forged timestamps can't dodge the daily cap.
    - Only check-ins for today and yesterday earn XP.
  - `game_profile.go`: state, settings, first activation (egg, starter items, 90-day backfill), handle, equip, pin, pet name, chests, crafting.
  - `game_social.go`: boards, leagues and their weekly close, project boards, kudos, invite preview.
- **HTTP**: `server/internal/httpapi/game.go`, documented in `OPENAPI.yaml`.
  - Rate-limited with the settings budget.
  - League weeks close on the 5-minute cleanup tick, under an advisory lock.

### Client

- `app/src/lib/gamification/`:
  - `gameStore.ts`: the per-account cache of `/v1/game`, optimistic XP, and celebration events handed out once.
  - `celebrations.ts`: where bursts start and land, intensity, sounds, and pet reactions.
  - `rules.ts` mirrors the server rules. The same test values pin both, and `catalog.test.ts` reads the Go catalog so the client draws every item the server can grant.
  - `catalog.ts`, `state.ts`, `effects.tsx`.
- `app/src/lib/pendingLink.ts` keeps `#invite=` and `#project=` through sign-in. After sync, the invite is accepted or the project opened. `InvitePreviewCard` shows who invited you before sign-in.
- Onboarding: `components/game/onboarding/OnboardingFlow.tsx`, gated in `App.tsx` on `needsOnboarding`, replayable from Settings → Game.
- In the app:
  - `GameSidebarWidget`: pet, streak, and the XP bar that labels fly into.
  - `GameCelebrations`: server events become the level-up, hatch and welcome moments and toasts. Events are acknowledged only after they have been shown.
  - `components/game/progress/`: the Progress view (Overview, Leagues, Achievements, Inventory, Pet), `ChestDialog`, and `ProjectLeaderboardPanel`, which is a tab on shared projects.
  - `GameSettingsPanel`: Settings → Game.
  - `KudosButton`: in the task detail of completed shared-project tasks.
- Visual components: `components/game/fx`, `identity` and `pet`, plus the particle engine in `lib/fx/` and synthesized sounds in `lib/fx/sound.ts`. All of them follow the light and dark themes (`lib/theme.ts`, see `DESIGN.md`).
- Strings live in the `game`, `onboarding` and `progress` namespaces, in all five locales.

## 10. Build order (done)

1. Onboarding, invite landing and token persistence, the Calm/Gamified setting, handle and visibility.
2. XP ledger, levels, streaks, XP bar, completion effects, level-up.
3. Pet: egg, hatch, species, moods, sidebar, Den.
4. Achievements, chests, inventory, name effects, borders, titles.
5. Leagues, all-time boards, project leaderboards, kudos.
6. Polish: sounds, haptics, Android performance, reduced motion, full test pass.
