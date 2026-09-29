// The pet's den with its real species, stage, name and outfit, a room picker
// for the one equipped decoration, and a short profile. Before hatching, the
// egg waits for the first completed task.
import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, equippedAccessories, equippedRoom, type AccessoryArt } from "../../../lib/gamification/catalog";
import type { GameState } from "../../../lib/gamification/state";
import type { PetAccessorySlot } from "../../../lib/gamification/types";
import { useI18n } from "../../../lib/i18n";
import { useResolvedTheme } from "../../../lib/theme";
import type { PetAccessories, PetAccessoryId } from "../pet/accessories";
import { Pet } from "../pet/Pet";
import { PetDen, type PetDenLabels } from "../pet/PetDen";
import { RoomGlyph } from "./ProgressGlyphs";
import { nextEvolutionLevel, petMoodFor, type EquipSlot } from "./progressModel";

export type PetTabProps = {
  readonly state: GameState;
  readonly now?: number;
  readonly onEquip: (slot: EquipSlot, itemId: string) => void;
  readonly onRename: (name: string) => void;
};

const ACCESSORY_SLOT: Readonly<Record<PetAccessorySlot, EquipSlot>> = { hat: "petHat", face: "petFace", neck: "petNeck" };

/** Server name rules: collapsed whitespace, 24 characters at most. */
const normalizeName = (name: string) => name.trim().split(/\s+/).filter(Boolean).join(" ");

/** Item id of each accessory art (the catalog maps ids to art, this goes back). */
const ITEM_FOR_ART: ReadonlyMap<AccessoryArt, string> = new Map(
  [...CATALOG.values()].flatMap((entry) => ("accessory" in entry ? [[entry.accessory, entry.id] as const] : [])),
);

/** Saves the pet's name once typing pauses, and when the tab closes. */
function usePetName(saved: string, onRename: (name: string) => void): [string, (name: string) => void] {
  const [draft, setDraft] = useState(saved);
  const lastSaved = useRef(saved);
  const latest = useRef({ draft, onRename });
  latest.current = { draft, onRename };

  useEffect(() => {
    // Follow a rename from elsewhere unless it is only this draft, normalized.
    if (saved !== lastSaved.current) {
      lastSaved.current = saved;
      setDraft((current) => (normalizeName(current) === saved ? current : saved));
    }
  }, [saved]);

  useEffect(() => {
    const name = normalizeName(draft);
    if (name === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      lastSaved.current = name;
      latest.current.onRename(name);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(
    () => () => {
      const name = normalizeName(latest.current.draft);
      if (name !== lastSaved.current) latest.current.onRename(name);
    },
    [],
  );

  return [draft, setDraft];
}

export function PetTab({ state, now, onEquip, onRename }: PetTabProps) {
  const { profile } = state;
  const pet = profile.pet;
  if (!pet?.species || !pet.hatchedAt) return <EggCard />;
  return <HatchedPet state={state} species={pet.species} now={now} onEquip={onEquip} onRename={onRename} />;
}

function EggCard() {
  const { t } = useI18n();
  const theme = useResolvedTheme();
  return (
    <section className="gp-card gp-egg" aria-labelledby="gp-egg-title">
      <div className="gp-egg-art" aria-hidden="true">
        <Pet species="mochi" stage="egg" mysteryEgg mood="content" size={168} backdrop={theme} decorative />
      </div>
      <h2 id="gp-egg-title">{t("progress.pet.eggTitle")}</h2>
      <p>{t("progress.pet.eggBody")}</p>
    </section>
  );
}

function HatchedPet({ state, species, now, onEquip, onRename }: PetTabProps & { readonly species: NonNullable<NonNullable<GameState["profile"]["pet"]>["species"]> }) {
  const { t } = useI18n();
  const { profile, inventory } = state;
  const pet = profile.pet!;
  const level = profile.progress.level;
  const [name, setName] = usePetName(pet.name, onRename);
  const mood = petMoodFor(profile, now === undefined ? new Date() : new Date(now));
  const owned = useMemo(() => new Set(inventory.map((item) => item.itemId)), [inventory]);
  const accessories = equippedAccessories(profile.equipped) as PetAccessories;
  const ownedAccessories = useMemo(
    () => [...CATALOG.values()].flatMap((entry) => ("accessory" in entry && owned.has(entry.id) ? [entry.accessory as PetAccessoryId] : [])),
    [owned],
  );
  const rooms = useMemo(() => [...CATALOG.values()].filter((entry) => entry.kind === "pet-room" && owned.has(entry.id)), [owned]);
  const displayName = name.trim() || t(`game.species.${species}`);
  const next = nextEvolutionLevel(level);

  const labels: Partial<PetDenLabels> = {
    room: t("progress.pet.room", { name: displayName }),
    petAction: t("progress.pet.petAction", { name: displayName }),
    name: t("progress.pet.name"),
    wardrobe: t("progress.pet.wardrobe"),
    evolution: t("progress.pet.evolution"),
    none: t("progress.pet.none"),
    locked: t("progress.pet.locked"),
    slots: { hat: t("progress.pet.slots.hat"), face: t("progress.pet.slots.face"), neck: t("progress.pet.slots.neck") },
    accessories: Object.fromEntries([...ITEM_FOR_ART].map(([art, id]) => [art, t(`game.items.${id}`)])) as PetDenLabels["accessories"],
    stages: { baby: t("game.stages.baby"), young: t("game.stages.young"), adult: t("game.stages.adult"), radiant: t("game.stages.radiant") },
    level: (value) => t("game.xp.levelShort", { level: value }),
  };

  function changeAccessories(next: PetAccessories) {
    for (const slot of ["hat", "face", "neck"] as const) {
      const before = accessories[slot] ?? null;
      const after = next[slot] ?? null;
      if (before === after) continue;
      onEquip(ACCESSORY_SLOT[slot], after ? (ITEM_FOR_ART.get(after) ?? "") : "");
    }
  }

  const equippedRoomId = profile.equipped.petRoom ?? "";

  return (
    <div className="gp-pet">
      <PetDen
        className="gp-den"
        species={species}
        stage={pet.stage}
        mood={mood}
        level={level}
        name={name}
        onNameChange={setName}
        accessories={accessories}
        onAccessoriesChange={changeAccessories}
        ownedAccessories={ownedAccessories}
        roomItems={equippedRoom(profile.equipped)}
        labels={labels}
        maxNameLength={24}
      />
      <div className="gp-col">
        <section className="gp-card gp-pet-about" aria-labelledby="gp-pet-about-title">
          <header className="gp-card-head">
            <h2 id="gp-pet-about-title">{t(`game.species.${species}`)}</h2>
            <span className="gp-mood" data-mood={mood}>
              {t(`game.moods.${mood}`)}
            </span>
          </header>
          <p>{t(`game.speciesDescriptions.${species}`)}</p>
          <p className="gp-pet-stage">
            <span className="gp-pill gp-pill--quiet">{t(`game.stages.${pet.stage}`)}</span>
            <span>{next ? t("progress.pet.nextStage", { level: next }) : t("progress.pet.maxStage")}</span>
          </p>
        </section>

        <section className="gp-card gp-rooms" aria-labelledby="gp-rooms-title">
          <header className="gp-card-head">
            <h2 id="gp-rooms-title">{t("progress.pet.roomTitle")}</h2>
          </header>
          {rooms.length === 0 ? (
            <p className="gp-empty">{t("progress.pet.roomEmpty")}</p>
          ) : (
            <>
              <p className="gp-hint">{t("progress.pet.roomHint")}</p>
              <div className="gp-room-grid" role="group" aria-label={t("progress.pet.roomTitle")}>
                <button type="button" className="gp-room-item" aria-pressed={!equippedRoomId} onClick={() => equippedRoomId && onEquip("petRoom", "")}>
                  <span className="gp-room-none" aria-hidden="true" />
                  <span>{t("progress.pet.none")}</span>
                </button>
                {rooms.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="gp-room-item"
                    data-rarity={entry.rarity}
                    aria-pressed={equippedRoomId === entry.id}
                    onClick={() => onEquip("petRoom", equippedRoomId === entry.id ? "" : entry.id)}
                  >
                    {entry.kind === "pet-room" && <RoomGlyph room={entry.room} size={34} />}
                    <span>{t(`game.items.${entry.id}`)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
