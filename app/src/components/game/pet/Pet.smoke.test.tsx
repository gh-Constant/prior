import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PET_SPECIES, type PetStage } from "../../../lib/gamification/types";
import { Pet, type PetHandle } from "./Pet";
import { PetCompanion } from "./PetCompanion";
import { PetDen } from "./PetDen";
import { PetHeadshot } from "./PetHeadshot";

const STAGES: PetStage[] = ["egg", "baby", "young", "adult", "radiant"];

afterEach(() => {
  vi.useRealTimers();
});

describe("Pet smoke", () => {
  it.each(PET_SPECIES)("renders every stage of %s with named parts", (species) => {
    for (const stage of STAGES) {
      const { container, unmount } = render(<Pet species={species} stage={stage} mood="content" name="Pip" moodLabel="Content" accessories={{ hat: "crown", face: "round-glasses", neck: "scarf" }} />);
      const svg = container.querySelector("svg.pet");
      expect(svg?.getAttribute("role")).toBe("img");
      expect(svg?.getAttribute("data-stage")).toBe(stage);
      if (stage === "egg") {
        expect(container.querySelector(".pet-egg-shell")).not.toBeNull();
      } else {
        expect(svg?.getAttribute("aria-label")).toBe("Pip, Content");
        for (const part of [".pet-react", ".pet-idle", ".pet-head", ".pet-eyes", ".pet-mouth", ".pet-paw--l", "[data-accessory='crown']", "[data-accessory='scarf']"]) {
          expect(container.querySelector(part), `${species} ${stage} ${part}`).not.toBeNull();
        }
      }
      unmount();
    }
  });

  it("uses unique gradient ids for pets on the same page", () => {
    const { container } = render(<><Pet species="nova" stage="adult" /><Pet species="nova" stage="adult" /></>);
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("plays reactions through the ref and reports the end", () => {
    vi.useFakeTimers();
    const ref = createRef<PetHandle>();
    const onReactionEnd = vi.fn();
    const { container } = render(<Pet ref={ref} species="mochi" stage="baby" mood="content" onReactionEnd={onReactionEnd} />);
    act(() => ref.current?.play("hop"));
    expect(container.querySelector(".pet--react-hop")).not.toBeNull();
    expect(container.querySelector(".pet-eyes--happy")).not.toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(onReactionEnd).toHaveBeenCalledWith("hop");
    expect(container.querySelector(".pet--react-hop")).toBeNull();
  });

  it("hatches an egg into a baby", () => {
    vi.useFakeTimers();
    const onReactionEnd = vi.fn();
    const { container, rerender } = render(<Pet species="fern" stage="egg" mysteryEgg reaction="hatch" reactionKey={0} onReactionEnd={onReactionEnd} />);
    rerender(<Pet species="fern" stage="egg" mysteryEgg reaction="hatch" reactionKey={1} onReactionEnd={onReactionEnd} />);
    act(() => vi.advanceTimersByTime(1300));
    expect(container.querySelector(".pet-egg-burst")).not.toBeNull();
    expect(container.querySelector("svg.pet")?.getAttribute("data-stage")).toBe("baby");
    act(() => vi.advanceTimersByTime(3000));
    expect(onReactionEnd).toHaveBeenCalledWith("hatch");
    expect(container.querySelector("svg.pet")?.getAttribute("data-stage")).toBe("baby");
  });
});

describe("Pet companions", () => {
  it("renders a labelled companion button that purrs on click", () => {
    const onPet = vi.fn();
    const { getByRole, container } = render(<PetCompanion species="ember" stage="young" mood="happy" name="Ember" moodLabel="Happy" actionLabel="Pet Ember" onPet={onPet} />);
    fireEvent.click(getByRole("button", { name: "Pet Ember" }));
    expect(onPet).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".pet--react-purr")).not.toBeNull();
  });

  it("renders headshots for hatched and egg stages", () => {
    const { container } = render(<><PetHeadshot species="nova" stage="adult" accessories={{ hat: "party-hat" }} name="Nova" size={32} /><PetHeadshot species="mochi" stage="egg" size={24} /></>);
    const shots = container.querySelectorAll("svg.pet-headshot");
    expect(shots).toHaveLength(2);
    expect(shots[0].getAttribute("aria-label")).toBe("Nova");
    expect(container.querySelector("[data-accessory='party-hat']")).not.toBeNull();
  });

  it("equips accessories and edits the name from the Den", () => {
    const onAccessoriesChange = vi.fn();
    const onNameChange = vi.fn();
    const { getByRole, getByLabelText } = render(
      <PetDen species="mochi" stage="young" mood="content" level={12} name="Mochi" onNameChange={onNameChange} accessories={{}} onAccessoriesChange={onAccessoriesChange} timeOfDay="day" />,
    );
    fireEvent.click(getByRole("button", { name: /Party hat/ }));
    expect(onAccessoriesChange).toHaveBeenCalledWith({ hat: "party-hat" });
    fireEvent.change(getByLabelText("Name"), { target: { value: "Mochi II" } });
    expect(onNameChange).toHaveBeenCalledWith("Mochi II");
  });
});
