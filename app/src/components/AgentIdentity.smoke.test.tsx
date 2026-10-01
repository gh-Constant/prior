import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AGENT_MOODS, AgentIdentity } from "./AgentIdentity";

describe("AgentIdentity smoke", () => {
  it.each(["tiny", "small", "hero"] as const)("renders %s idle", (size) => {
    const { container } = render(<AgentIdentity size={size} />);
    const identity = container.querySelector(".agent-identity");
    expect(identity).not.toBeNull();
    expect(identity?.classList.contains(`agent-identity-${size}`)).toBe(true);
    expect(identity?.getAttribute("data-mood")).toBe("idle");
    expect(container.querySelector("svg.agent-mark .mascot-skin")).not.toBeNull();
    expect(container.querySelectorAll(".mascot-eye")).toHaveLength(2);
    expect(container.querySelector(".mascot-star")).not.toBeNull();
  });

  it("exposes the legacy thinking state", () => {
    const { container } = render(<AgentIdentity size="small" thinking />);
    expect(container.querySelector(".is-thinking")).not.toBeNull();
    expect(container.querySelector("[data-state='thinking']")).not.toBeNull();
    expect(container.querySelector("[data-mood='thinking']")).not.toBeNull();
  });

  it.each(AGENT_MOODS)("renders the %s mood", (mood) => {
    const { container } = render(<AgentIdentity mood={mood} />);
    const identity = container.querySelector(".agent-identity");
    expect(identity?.getAttribute("data-mood")).toBe(mood);
    expect(identity?.classList.contains(`mood-${mood}`)).toBe(true);
    expect(identity?.getAttribute("aria-hidden")).toBe("true");
    // Every mood has a mouth; the happy one swaps its round eyes for squinting arcs.
    expect(container.querySelector(".mascot-mouth")?.children.length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".mascot-eye").length).toBe(mood === "happy" ? 0 : 2);
    expect(container.querySelector(".mascot-eyes-happy") !== null).toBe(mood === "happy");
    expect(container.querySelector(".mascot-burst") !== null).toBe(mood === "happy");
    expect(container.querySelector(".mascot-brows") !== null).toBe(mood === "sad");
    expect(container.querySelector(".mascot-tear") !== null).toBe(mood === "sad");
  });

  it("lets an explicit mood win over the thinking flag", () => {
    const { container } = render(<AgentIdentity thinking mood="happy" />);
    expect(container.querySelector("[data-mood='happy']")).not.toBeNull();
    expect(container.querySelector(".is-thinking")).toBeNull();
  });

  it("waves hello on the hero only unless asked otherwise", () => {
    expect(render(<AgentIdentity size="hero" />).container.querySelector(".is-waving")).not.toBeNull();
    expect(render(<AgentIdentity size="small" />).container.querySelector(".is-waving")).toBeNull();
    expect(render(<AgentIdentity size="small" wave />).container.querySelector(".is-waving")).not.toBeNull();
  });

  it("gives every mascot its own gradient id", () => {
    const { container } = render(<><AgentIdentity /><AgentIdentity /></>);
    const ids = Array.from(container.querySelectorAll("radialGradient")).map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(container.querySelector(`.mascot-skin[fill="url(#${id})"]`)).not.toBeNull();
  });
});
