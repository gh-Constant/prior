import { describe, expect, it } from "vitest";
import { bestScore, foldText, fuzzyScore } from "./fuzzy";

describe("fuzzy", () => {
  it("ignores case and accents", () => {
    expect(foldText("Réunion ÉQUIPE")).toBe("reunion equipe");
    expect(fuzzyScore("reunion", "Réunion d’équipe")).not.toBeNull();
  });

  it("matches characters in order and ranks substrings first", () => {
    expect(fuzzyScore("xyz", "Write report")).toBeNull();
    const direct = fuzzyScore("report", "Write report")!;
    const scattered = fuzzyScore("wrrt", "Write report")!;
    expect(direct).toBeGreaterThan(scattered);
    expect(fuzzyScore("rep", "report")!).toBeGreaterThan(fuzzyScore("rep", "prepare")!);
  });

  it("uses the best weighted field", () => {
    const title = bestScore("tax", [{ text: "Pay taxes", weight: 2 }, { text: "", weight: 1 }]);
    const body = bestScore("tax", [{ text: "Groceries", weight: 2 }, { text: "tax receipts", weight: 1 }]);
    expect(title!).toBeGreaterThan(body!);
    expect(bestScore("zzz", [{ text: "Groceries" }])).toBeNull();
  });
});
