import { beforeEach, describe, expect, it } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    logger.clear();
  });

  it("records log entries and formats log text", () => {
    logger.info("TEST", "Information message");
    logger.warn("SYNC", "Warning message");
    logger.error("AUTH", "Error message", { reason: "timeout" });

    const entries = logger.getEntries();
    expect(entries.length).toBe(3);
    expect(entries[0].level).toBe("info");
    expect(entries[0].category).toBe("TEST");
    expect(entries[0].message).toBe("Information message");

    expect(entries[1].level).toBe("warn");
    expect(entries[2].level).toBe("error");

    const text = logger.getLogText();
    expect(text).toContain("Prior Diagnostics Log");
    expect(text).toContain("[INFO] [TEST] Information message");
    expect(text).toContain("[WARN] [SYNC] Warning message");
    expect(text).toContain("[ERROR] [AUTH] Error message");
    expect(text).toContain("timeout");
  });

  it("clears entries", () => {
    logger.info("A", "Message");
    expect(logger.getEntries().length).toBe(1);
    logger.clear();
    expect(logger.getEntries().length).toBe(0);
  });
});
