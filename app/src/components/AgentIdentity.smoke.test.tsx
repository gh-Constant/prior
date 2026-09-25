import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AgentIdentity } from "./AgentIdentity";

describe("AgentIdentity smoke", () => {
  it.each(["tiny", "small", "hero"] as const)("renders %s idle", (size) => {
    const { container } = render(<AgentIdentity size={size} />);
    const identity = container.querySelector(".agent-identity");
    expect(identity).not.toBeNull();
    expect(identity?.classList.contains(`agent-identity-${size}`)).toBe(true);
    expect(container.querySelector("svg.agent-mark .agent-mark-trace")).not.toBeNull();
    expect(container.querySelector(".agent-mark-core")).not.toBeNull();
  });

  it("exposes the thinking state", () => {
    const { container } = render(<AgentIdentity size="small" thinking />);
    expect(container.querySelector(".is-thinking")).not.toBeNull();
    expect(container.querySelector("[data-state='thinking']")).not.toBeNull();
  });
});
