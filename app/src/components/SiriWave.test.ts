import { describe, expect, it } from "vitest";
import { buildSiriShader } from "./SiriWave";

describe("buildSiriShader", () => {
  it("keeps original colors with a transparent background", () => {
    for (const variant of ["wave", "fluid-dots"] as const) {
      const src = buildSiriShader(variant);
      expect(src).not.toContain("fragColor = vec4(col, 1.0);");
      expect(src).toContain("fragColor = vec4(col, clamp(lum * 2.0, 0.0, 1.0));");
    }
  });
});
