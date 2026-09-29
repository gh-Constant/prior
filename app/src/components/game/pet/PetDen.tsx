// The Den: the pet's room, wardrobe, evolution history and name.
import { useEffect, useId, useRef, useState } from "react";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import { PET_STAGE_LEVELS, type PetAccessorySlot, type PetMood, type PetReaction, type PetSpecies, type PetStage } from "../../../lib/gamification/types";
import { PetAccessoryIcon } from "./AccessoryArt";
import { accessoriesForSlot, PET_ACCESSORY_IDS, PET_ACCESSORY_SLOTS, type PetAccessories, type PetAccessoryId } from "./accessories";
import { HATCHED_STAGES, type HatchedPetStage } from "./geometry";
import { Pet, type PetHandle } from "./Pet";
import { DEN_CUSHION_X, PET_ROOM_ITEMS, PetDenRoom, type DenTime, type PetRoomItemId } from "./PetDenRoom";
import "./PetDen.css";

export type PetDenLabels = {
  readonly room: string;
  readonly petAction: string;
  readonly name: string;
  readonly wardrobe: string;
  readonly evolution: string;
  readonly none: string;
  readonly locked: string;
  readonly slots: Readonly<Record<PetAccessorySlot, string>>;
  readonly accessories: Readonly<Record<PetAccessoryId, string>>;
  readonly stages: Readonly<Record<HatchedPetStage, string>>;
  readonly level: (level: number) => string;
};

export const DEFAULT_PET_DEN_LABELS: PetDenLabels = {
  room: "Your pet's room",
  petAction: "Pet your companion",
  name: "Name",
  wardrobe: "Wardrobe",
  evolution: "Evolution",
  none: "None",
  locked: "Locked",
  slots: { hat: "Hat", face: "Face", neck: "Neck" },
  accessories: {
    "party-hat": "Party hat",
    beanie: "Beanie",
    crown: "Tiny crown",
    flower: "Flower",
    "round-glasses": "Round glasses",
    "heart-shades": "Heart shades",
    scarf: "Scarf",
    "bow-tie": "Bow tie",
    "bell-collar": "Bell collar",
  },
  stages: { baby: "Baby", young: "Young", adult: "Adult", radiant: "Radiant" },
  level: (level) => `Lv ${level}`,
};

export type PetDenProps = {
  readonly species: PetSpecies;
  readonly stage: PetStage;
  readonly mood: PetMood;
  readonly level: number;
  readonly name: string;
  readonly onNameChange?: (name: string) => void;
  readonly accessories: PetAccessories;
  readonly onAccessoriesChange?: (accessories: PetAccessories) => void;
  /** Accessories the user owns; everything by default. */
  readonly ownedAccessories?: readonly PetAccessoryId[];
  readonly roomItems?: readonly PetRoomItemId[];
  /** "auto" follows local time (day 07:00–19:00). */
  readonly timeOfDay?: "auto" | DenTime;
  readonly reaction?: PetReaction | null;
  readonly reactionKey?: string | number;
  readonly labels?: Partial<PetDenLabels>;
  readonly maxNameLength?: number;
  readonly className?: string;
};

function localTime(): DenTime {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? "day" : "night";
}

function useDenTime(mode: "auto" | DenTime): DenTime {
  const [auto, setAuto] = useState(localTime);
  useEffect(() => {
    if (mode !== "auto") return;
    const handle = window.setInterval(() => setAuto(localTime()), 5 * 60 * 1000);
    return () => window.clearInterval(handle);
  }, [mode]);
  return mode === "auto" ? auto : mode;
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

/** Idles, then strolls somewhere else on the floor. Only animates while walking. */
function useWander(enabled: boolean, home: number, speed: number) {
  const walkerRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<HTMLDivElement>(null);
  const position = useRef(home);

  useEffect(() => {
    const walker = walkerRef.current;
    const flip = flipRef.current;
    if (!walker || !flip) return;
    const place = (x: number) => {
      position.current = x;
      walker.style.left = `${x.toFixed(2)}%`;
    };
    if (!enabled) {
      place(home);
      walker.classList.remove("is-walking");
      flip.classList.remove("is-left");
      return;
    }
    let timer = 0;
    let frame = 0;
    let target = home;
    let last = 0;
    const step = (time: number) => {
      const dt = last ? Math.min(64, time - last) / 1000 : 0;
      last = time;
      const x = position.current;
      const delta = target - x;
      const move = Math.sign(delta) * Math.min(Math.abs(delta), speed * dt);
      place(x + move);
      if (Math.abs(target - position.current) < 0.1) {
        walker.classList.remove("is-walking");
        frame = 0;
        timer = window.setTimeout(startWalk, randomBetween(3500, 8000));
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    const startWalk = () => {
      const x = position.current;
      let next = randomBetween(20, 80);
      if (Math.abs(next - x) < 12) next = x < 50 ? Math.min(80, x + 24) : Math.max(20, x - 24);
      target = next;
      flip.classList.toggle("is-left", next < x);
      walker.classList.add("is-walking");
      last = 0;
      frame = window.requestAnimationFrame(step);
    };
    place(position.current);
    timer = window.setTimeout(startWalk, randomBetween(1500, 4000));
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
      walker.classList.remove("is-walking");
    };
  }, [enabled, home, speed]);

  return { walkerRef, flipRef };
}

function stageUnlocked(stage: HatchedPetStage, level: number): boolean {
  return level >= PET_STAGE_LEVELS[stage];
}

export function PetDen({
  species,
  stage,
  mood,
  level,
  name,
  onNameChange,
  accessories,
  onAccessoriesChange,
  ownedAccessories = PET_ACCESSORY_IDS,
  roomItems = PET_ROOM_ITEMS,
  timeOfDay = "auto",
  reaction,
  reactionKey,
  labels: labelOverrides,
  maxNameLength = 20,
  className,
}: PetDenProps) {
  const labels = { ...DEFAULT_PET_DEN_LABELS, ...labelOverrides };
  const intensity = useEffectsIntensity();
  const time = useDenTime(timeOfDay);
  const [slot, setSlot] = useState<PetAccessorySlot>("hat");
  const petRef = useRef<PetHandle>(null);
  const nameId = useId();
  const resting = mood === "asleep" || mood === "sleepy" || stage === "egg";
  const onCushion = mood === "asleep" && roomItems.includes("cushion");
  const home = onCushion ? DEN_CUSHION_X : 52;
  const { walkerRef, flipRef } = useWander(intensity !== "off" && !resting, home, intensity === "subtle" ? 5 : 8);
  // React only sets the first position; the wander hook owns `left` afterwards.
  const [initialLeft] = useState(home);
  const owned = accessoriesForSlot(slot).filter((id) => ownedAccessories.includes(id));
  const equipped = accessories[slot] ?? null;
  const equip = (id: PetAccessoryId | null) => onAccessoriesChange?.({ ...accessories, [slot]: id });

  return (
    <section className={["pet-den", `pet-den--${time}`, intensity === "off" ? "pet-den--still" : "", className].filter(Boolean).join(" ")}>
      <div className="pet-den-room">
        <PetDenRoom time={time} items={roomItems} label={labels.room} />
        {name && <span className="pet-den-plaque">{name}</span>}
        <div className={onCushion ? "pet-den-walker is-resting" : "pet-den-walker"} ref={walkerRef} style={{ left: `${initialLeft}%` }}>
          <div className="pet-den-flip" ref={flipRef}>
            <button type="button" className="pet-den-pet" aria-label={labels.petAction} onClick={() => petRef.current?.play(stage === "egg" ? "wiggle" : "purr")}>
              <span className="pet-den-bob">
                <Pet ref={petRef} species={species} stage={stage} mood={mood} accessories={accessories} reaction={reaction} reactionKey={reactionKey} name={name} decorative size={160} />
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="pet-den-panel">
        <label className="pet-den-name" htmlFor={nameId}>
          <span>{labels.name}</span>
          <input id={nameId} type="text" value={name} maxLength={maxNameLength} autoComplete="off" spellCheck={false} onChange={(event) => onNameChange?.(event.target.value)} />
        </label>

        <div className="pet-den-block">
          <h4>{labels.wardrobe}</h4>
          <div className="pet-den-tabs" role="group" aria-label={labels.wardrobe}>
            {PET_ACCESSORY_SLOTS.map((item) => (
              <button key={item} type="button" aria-pressed={slot === item} className={slot === item ? "is-active" : undefined} onClick={() => setSlot(item)}>
                {labels.slots[item]}
              </button>
            ))}
          </div>
          <div className="pet-den-items">
            <button type="button" className="pet-den-item" aria-pressed={equipped === null} onClick={() => equip(null)}>
              <span className="pet-den-item-icon pet-den-item-none" aria-hidden="true" />
              <span className="pet-den-item-label">{labels.none}</span>
            </button>
            {owned.map((id) => (
              <button key={id} type="button" className="pet-den-item" aria-pressed={equipped === id} onClick={() => equip(equipped === id ? null : id)}>
                <span className="pet-den-item-icon"><PetAccessoryIcon id={id} size={34} /></span>
                <span className="pet-den-item-label">{labels.accessories[id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pet-den-block">
          <h4>{labels.evolution}</h4>
          <ol className="pet-den-timeline">
            {HATCHED_STAGES.map((item) => {
              const unlocked = stageUnlocked(item, level);
              const current = stage === item;
              return (
                <li key={item} className={["pet-den-step", unlocked ? "is-unlocked" : "is-locked", current ? "is-current" : ""].filter(Boolean).join(" ")} aria-current={current ? "step" : undefined}>
                  <span className="pet-den-step-art">
                    <Pet species={species} stage={item} mood="content" size={64} zoom={1.12} still silhouette={!unlocked} accessories={unlocked ? accessories : undefined} decorative />
                    {!unlocked && (
                      <svg className="pet-den-lock" viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="3" y="7" width="10" height="7.5" rx="2" fill="currentColor" />
                        <path d="M5.2 7V5.4a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    )}
                  </span>
                  <span className="pet-den-step-name">{unlocked ? labels.stages[item] : labels.locked}</span>
                  <span className="pet-den-step-level">{labels.level(PET_STAGE_LEVELS[item])}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
