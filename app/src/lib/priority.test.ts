import { describe, expect, it } from "vitest";
import { quadrantFor } from "./priority";

describe("quadrantFor", () => {
  it("places important and urgent tasks in focus", () => expect(quadrantFor({ important: true, urgent: true })).toBe("focus"));
  it("places important tasks in plan", () => expect(quadrantFor({ important: true, urgent: false })).toBe("plan"));
  it("places urgent tasks in quick", () => expect(quadrantFor({ important: false, urgent: true })).toBe("quick"));
  it("places everything else in later", () => expect(quadrantFor({ important: false, urgent: false })).toBe("later"));
});
