import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AgentIdentity } from "./AgentIdentity";

describe("AgentIdentity smoke", () => {
  it.each(["tiny", "small", "hero"] as const)("renders %s idle", (size) => {
    const { container } = render(<AgentIdentity size={size} />);
    expect(container.querySelector(".agent-identity")).not.toBeNull();
    expect(container.querySelector(".agent-fluid")).not.toBeNull();
    expect(container.querySelector(".agent-fluid-fallback")).not.toBeNull();
  });

  it("mounts the siri canvas and thinking state", () => {
    const { container } = render(<AgentIdentity size="small" thinking />);
    expect(container.querySelector(".is-thinking")).not.toBeNull();
    expect(container.querySelector("canvas.agent-siri")).not.toBeNull();
  });
});
