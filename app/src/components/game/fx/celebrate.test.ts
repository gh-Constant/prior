import { describe, expect, it, vi } from "vitest";
import { COMPLETION_FX, XP_ARRIVE_EVENT, celebrateCompletion, flightKeyframes } from "./celebrate";

const parse = (transform: string) => {
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\).*scale\(([-\d.]+)\)/.exec(transform);
  if (!match) throw new Error(`Unexpected transform ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
};

describe("completion celebration", () => {
  it("scales the celebration with the quadrant's value", () => {
    expect(COMPLETION_FX.later.preset).toBe("sparkle");
    expect(COMPLETION_FX.focus.preset).toBe("burst");
    expect(COMPLETION_FX.quick.count).toBeLessThan(COMPLETION_FX.plan.count);
    expect(COMPLETION_FX.plan.count).toBeLessThan(COMPLETION_FX.focus.count);
    expect(COMPLETION_FX.quick.power).toBeLessThan(COMPLETION_FX.focus.power);
  });

  it("builds a label flight that pops out of the checkbox and lands on the target", () => {
    const from = { x: 400, y: 500 };
    const to = { x: 120, y: 60 };
    const frames = flightKeyframes(from, to);
    const offsets = frames.map((frame) => frame.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBeCloseTo(1);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    const first = parse(String(frames[0].transform));
    const last = parse(String(frames.at(-1)!.transform));
    expect(first.x).toBeCloseTo(from.x);
    expect(last).toMatchObject({ x: to.x, y: to.y });
    expect(last.scale).toBeLessThan(1);
    // The label rises above the checkbox before flying.
    expect(parse(String(frames[3].transform)).y).toBeLessThan(from.y);
  });

  it("gives plain feedback when effects are off: lands immediately and notifies the target", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const onArrive = vi.fn();
    const heard = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener(XP_ARRIVE_EVENT, heard);
    await celebrateCompletion({ quadrant: "focus", from: { left: 10, top: 10, width: 20, height: 20 }, xp: 30, to: target, intensity: "off", onArrive });
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ xp: 30 });
    target.remove();
  });
});
