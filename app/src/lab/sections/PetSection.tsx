import { useRef, useState } from "react";
import { PetAccessoryIcon } from "../../components/game/pet/AccessoryArt";
import { accessoriesForSlot, PET_ACCESSORY_IDS, type PetAccessories, type PetAccessoryId } from "../../components/game/pet/accessories";
import { stageForLevel } from "../../components/game/pet/geometry";
import { isRareSpecies, pickWeightedSpecies, PET_SPECIES_WEIGHTS } from "../../components/game/pet/hatch";
import { Pet, type PetHandle } from "../../components/game/pet/Pet";
import { PetCompanion } from "../../components/game/pet/PetCompanion";
import { PetDen } from "../../components/game/pet/PetDen";
import { PetHatchScene } from "../../components/game/pet/PetHatchScene";
import { PetHeadshot } from "../../components/game/pet/PetHeadshot";
import { PET_SPECIES, type PetAccessorySlot, type PetMood, type PetReaction, type PetSpecies, type PetStage } from "../../lib/gamification/types";
import { LabButton, LabDemo, LabRange, LabSelect, type LabSectionProps } from "../LabKit";
import { useResolvedTheme } from "../../lib/theme";
import "./PetSection.css";

const STAGES: readonly PetStage[] = ["egg", "baby", "young", "adult", "radiant"];
const MOODS: readonly PetMood[] = ["happy", "content", "sleepy", "asleep", "excited"];
const REACTIONS: readonly PetReaction[] = ["hop", "dance", "purr", "yawn", "wiggle", "hatch"];
const SPECIES_NAMES: Record<PetSpecies, string> = { mochi: "Mochi", fern: "Fern", nova: "Nova", ember: "Ember" };
const MOOD_NAMES: Record<PetMood, string> = { happy: "Happy", content: "Content", sleepy: "Sleepy", asleep: "Asleep", excited: "Excited" };

type Option<T extends string> = T | "none";
const slotOptions = (slot: PetAccessorySlot) => ["none", ...accessoriesForSlot(slot)] as Option<PetAccessoryId>[];
const orNull = (value: Option<PetAccessoryId>) => (value === "none" ? null : value);

const OUTFITS: Record<string, PetAccessories> = {
  party: { hat: "party-hat", face: null, neck: "bow-tie" },
  cozy: { hat: "beanie", face: null, neck: "scarf" },
  royal: { hat: "crown", face: null, neck: "bell-collar" },
  scholar: { hat: null, face: "round-glasses", neck: "bow-tie" },
  garden: { hat: "flower", face: "heart-shades", neck: null },
};
type OutfitName = keyof typeof OUTFITS;

// Lab-only layout: let a few demos span the whole row.

export function PetSection({ surface }: LabSectionProps) {
  // The sidebar is dark in both themes; the canvas follows the app theme.
  const theme = useResolvedTheme();
  const backdrop = surface === "sidebar" ? "dark" : theme;
  return (
    <div>
      <PlaygroundDemo surface={surface} backdrop={backdrop} />
      <MoodsDemo surface={surface} backdrop={backdrop} />
      <GridDemo surface={surface} backdrop={backdrop} />
      <OutfitsDemo surface={surface} backdrop={backdrop} />
      <HeadshotDemo surface={surface} />
      <CompanionDemo />
      <HatchDemo surface={surface} backdrop={backdrop} />
      <DenDemo surface={surface} />
    </div>
  );
}

type DemoProps = LabSectionProps & { readonly backdrop: "light" | "dark" };

function PlaygroundDemo({ surface, backdrop }: DemoProps) {
  const [species, setSpecies] = useState<PetSpecies>("mochi");
  const [stage, setStage] = useState<PetStage>("adult");
  const [mood, setMood] = useState<PetMood>("content");
  const [size, setSize] = useState(200);
  const [crack, setCrack] = useState(0);
  const [tracking, setTracking] = useState<"on" | "off">("on");
  const [hat, setHat] = useState<Option<PetAccessoryId>>("none");
  const [face, setFace] = useState<Option<PetAccessoryId>>("none");
  const [neck, setNeck] = useState<Option<PetAccessoryId>>("none");
  const petRef = useRef<PetHandle>(null);
  return (
    <LabDemo
      title="Pet playground"
      description="One rig for every species. Move the mouse to see the eyes follow; click a reaction to play it on top of the mood."
      surface={surface}
      height={300}
      controls={
        <>
          <LabSelect label="Species" value={species} options={PET_SPECIES} onChange={setSpecies} />
          <LabSelect label="Stage" value={stage} options={STAGES} onChange={setStage} />
          <LabSelect label="Mood" value={mood} options={MOODS} onChange={setMood} />
          <LabSelect label="Hat" value={hat} options={slotOptions("hat")} onChange={setHat} />
          <LabSelect label="Face" value={face} options={slotOptions("face")} onChange={setFace} />
          <LabSelect label="Neck" value={neck} options={slotOptions("neck")} onChange={setNeck} />
          <LabSelect label="Track pointer" value={tracking} options={["on", "off"] as const} onChange={setTracking} />
          <LabRange label="Size" value={size} min={48} max={260} step={4} onChange={setSize} />
          {stage === "egg" && <LabRange label="Crack" value={crack} min={0} max={1} step={0.05} onChange={setCrack} />}
          {REACTIONS.map((reaction) => <LabButton key={reaction} onClick={() => petRef.current?.play(reaction)}>{reaction}</LabButton>)}
        </>
      }
    >
      <Pet
        ref={petRef}
        species={species}
        stage={stage}
        mood={mood}
        size={size}
        crack={crack}
        backdrop={backdrop}
        trackPointer={tracking === "on"}
        accessories={{ hat: orNull(hat), face: orNull(face), neck: orNull(neck) }}
        name={SPECIES_NAMES[species]}
        moodLabel={MOOD_NAMES[mood]}
        onReactionEnd={(reaction) => {
          if (reaction === "hatch") {
            setStage("baby");
            setCrack(0);
          }
        }}
      />
    </LabDemo>
  );
}

function MoodsDemo({ surface, backdrop }: DemoProps) {
  const [species, setSpecies] = useState<PetSpecies>("fern");
  const [stage, setStage] = useState<PetStage>("young");
  return (
    <LabDemo
      title="Moods"
      description="Happy bounces with ^^ eyes, content breathes and blinks, sleepy sways and yawns, asleep curls up with floating z's, excited hops with star eyes. No guilt states."
      surface={surface}
      height={200}
      controls={
        <>
          <LabSelect label="Species" value={species} options={PET_SPECIES} onChange={setSpecies} />
          <LabSelect label="Stage" value={stage} options={STAGES.filter((item) => item !== "egg")} onChange={setStage} />
        </>
      }
    >
      <div className="pet-lab-row">
        {MOODS.map((mood) => (
          <span key={mood} className="pet-lab-cell">
            <Pet species={species} stage={stage} mood={mood} size={96} backdrop={backdrop} name={SPECIES_NAMES[species]} moodLabel={MOOD_NAMES[mood]} />
            {MOOD_NAMES[mood]}
          </span>
        ))}
      </div>
    </LabDemo>
  );
}

function GridDemo({ surface, backdrop }: DemoProps) {
  const [mood, setMood] = useState<PetMood>("content");
  return (
    <LabDemo
      title="4 species × 5 stages"
      description="Egg, then baby (level 1), young (10), adult (25) and radiant (50). Same identity, growing features."
      surface={surface}
      height={420}
      controls={<LabSelect label="Mood" value={mood} options={MOODS} onChange={setMood} />}
    >
      <div className="pet-lab-grid pet-lab-wide">
        {PET_SPECIES.flatMap((species) => STAGES.map((stage) => (
          <Pet key={`${species}-${stage}`} species={species} stage={stage} mood={mood} size={96} backdrop={backdrop} name={SPECIES_NAMES[species]} label={`${SPECIES_NAMES[species]}, ${stage}`} />
        )))}
      </div>
    </LabDemo>
  );
}

function OutfitsDemo({ surface, backdrop }: DemoProps) {
  const [outfit, setOutfit] = useState<OutfitName>("party");
  const [stage, setStage] = useState<PetStage>("adult");
  return (
    <LabDemo
      title="Accessories on every species"
      description="Hat, face and neck anchors adapt per species and stage."
      surface={surface}
      height={200}
      controls={
        <>
          <LabSelect label="Outfit" value={outfit} options={Object.keys(OUTFITS) as OutfitName[]} onChange={setOutfit} />
          <LabSelect label="Stage" value={stage} options={STAGES.filter((item) => item !== "egg")} onChange={setStage} />
        </>
      }
    >
      <div>
        <div className="pet-lab-row">
          {PET_SPECIES.map((species) => <Pet key={species} species={species} stage={stage} mood="happy" size={104} backdrop={backdrop} accessories={OUTFITS[outfit]} name={SPECIES_NAMES[species]} />)}
        </div>
        <div className="pet-lab-icons">
          {PET_ACCESSORY_IDS.map((id) => <PetAccessoryIcon key={id} id={id} size={34} />)}
        </div>
      </div>
    </LabDemo>
  );
}

function HeadshotDemo({ surface }: LabSectionProps) {
  const hats: Record<PetSpecies, PetAccessories> = {
    mochi: { hat: "party-hat" },
    fern: { hat: "flower" },
    nova: { hat: "crown", face: "round-glasses" },
    ember: { hat: "beanie" },
  };
  const [stage, setStage] = useState<PetStage>("adult");
  return (
    <LabDemo
      title="Headshots"
      description="Leaderboard avatars at 24, 32, 48, 64 and 96 px, with the equipped hat."
      surface={surface}
      height={250}
      controls={<LabSelect label="Stage" value={stage} options={STAGES} onChange={setStage} />}
    >
      <div style={{ display: "grid", gap: 10, padding: 12 }}>
        {PET_SPECIES.map((species) => (
          <div key={species} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {[24, 32, 48, 64, 96].map((size) => <PetHeadshot key={size} species={species} stage={stage} size={size} accessories={hats[species]} name={SPECIES_NAMES[species]} />)}
          </div>
        ))}
      </div>
    </LabDemo>
  );
}

function CompanionDemo() {
  const [species, setSpecies] = useState<PetSpecies>("nova");
  const [stage, setStage] = useState<PetStage>("young");
  const [mood, setMood] = useState<PetMood>("content");
  const [trigger, setTrigger] = useState<{ readonly reaction: PetReaction; readonly key: number }>({ reaction: "hop", key: 0 });
  const fire = (reaction: PetReaction, nextMood: PetMood) => {
    setTrigger((current) => ({ reaction, key: current.key + 1 }));
    setMood(nextMood);
  };
  return (
    <LabDemo
      title="Sidebar companion"
      description="Always on the dark rail. Click the pet to purr; external events make it hop (task done) or dance (level-up)."
      surface="sidebar"
      height={230}
      controls={
        <>
          <LabSelect label="Species" value={species} options={PET_SPECIES} onChange={setSpecies} />
          <LabSelect label="Stage" value={stage} options={STAGES} onChange={setStage} />
          <LabSelect label="Mood" value={mood} options={MOODS} onChange={setMood} />
          <LabButton onClick={() => fire("hop", "happy")}>Complete a task</LabButton>
          <LabButton onClick={() => fire("dance", "excited")}>Level up</LabButton>
        </>
      }
    >
      <div className="pet-lab-sidebar">
        <div className="pet-lab-sidebar-nav"><span /><span /><span /></div>
        <PetCompanion
          species={species}
          stage={stage}
          mood={mood}
          name={SPECIES_NAMES[species]}
          moodLabel={stage === "egg" ? "Waiting to hatch" : MOOD_NAMES[mood]}
          actionLabel={`Pet ${SPECIES_NAMES[species]}`}
          accessories={{ hat: "beanie" }}
          reaction={trigger.reaction}
          reactionKey={trigger.key}
        />
      </div>
    </LabDemo>
  );
}

function HatchDemo({ surface, backdrop }: DemoProps) {
  const [species, setSpecies] = useState<PetSpecies>(() => pickWeightedSpecies());
  const [egg, setEgg] = useState(0);
  const [hatchKey, setHatchKey] = useState(0);
  const [crack, setCrack] = useState(0.3);
  const [rolls, setRolls] = useState<Record<PetSpecies, number>>({ mochi: 0, fern: 0, nova: 0, ember: 0 });
  const newEgg = (next: PetSpecies = pickWeightedSpecies()) => {
    setSpecies(next);
    setEgg((value) => value + 1);
    setHatchKey(0);
    setCrack(0.3);
  };
  const odds = PET_SPECIES.map((item) => `${SPECIES_NAMES[item]} ${PET_SPECIES_WEIGHTS[item]}%`).join(" · ");
  const total = Object.values(rolls).reduce((sum, value) => sum + value, 0);
  return (
    <LabDemo
      title="Hatch sequence"
      description={`The egg rattles, cracks spread, the shell bursts and the baby blinks. Odds: ${odds}.`}
      surface={surface}
      height={300}
      controls={
        <>
          <LabButton primary onClick={() => setHatchKey((value) => value + 1)}>Hatch</LabButton>
          <LabButton onClick={() => newEgg()}>Random species</LabButton>
          <LabButton onClick={() => newEgg("ember")}>Force Ember</LabButton>
          <LabRange label="Crack" value={crack} min={0} max={1} step={0.05} onChange={setCrack} />
          <LabButton
            onClick={() => {
              const next = { ...rolls };
              for (let index = 0; index < 1000; index += 1) next[pickWeightedSpecies()] += 1;
              setRolls(next);
            }}
          >
            Roll ×1000
          </LabButton>
        </>
      }
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 8, padding: 12 }}>
        <PetHatchScene
          key={egg}
          species={species}
          hatchKey={hatchKey}
          crack={crack}
          size={170}
          backdrop={backdrop}
          label="Your egg"
          rareLabel="Rare!"
          revealContent={isRareSpecies(species) ? `${SPECIES_NAMES[species]} hatched — a 1 in 10 find` : `${SPECIES_NAMES[species]} hatched`}
        />
        {total > 0 && <p className="pet-lab-note">{PET_SPECIES.map((item) => `${SPECIES_NAMES[item]} ${((rolls[item] / total) * 100).toFixed(1)}%`).join(" · ")} ({total} rolls)</p>}
      </div>
    </LabDemo>
  );
}

function DenDemo({ surface }: LabSectionProps) {
  const [species, setSpecies] = useState<PetSpecies>("mochi");
  const [level, setLevel] = useState(27);
  const [mood, setMood] = useState<PetMood>("content");
  const [time, setTime] = useState<"auto" | "day" | "night">("auto");
  const [name, setName] = useState("Mochi");
  const [accessories, setAccessories] = useState<PetAccessories>({ hat: "beanie", neck: "scarf" });
  return (
    <LabDemo
      title="The Den"
      description="Room with a window on local day/night, items from chests, a wandering pet (click it), wardrobe, evolution history and an editable name."
      surface={surface}
      height={420}
      controls={
        <>
          <LabSelect label="Species" value={species} options={PET_SPECIES} onChange={setSpecies} />
          <LabRange label="Level" value={level} min={1} max={60} onChange={setLevel} />
          <LabSelect label="Mood" value={mood} options={MOODS} onChange={setMood} />
          <LabSelect label="Time" value={time} options={["auto", "day", "night"] as const} onChange={setTime} />
        </>
      }
    >
      <div className="pet-lab-den pet-lab-wide">
        <PetDen
          species={species}
          stage={stageForLevel(level)}
          mood={mood}
          level={level}
          name={name}
          onNameChange={setName}
          accessories={accessories}
          onAccessoriesChange={setAccessories}
          timeOfDay={time}
        />
      </div>
    </LabDemo>
  );
}
