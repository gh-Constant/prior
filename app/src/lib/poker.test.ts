import { describe, expect, it } from "vitest";
import {
  POKER_DECKS, cardFace, cardPoints, deckPoints, nearestDeckPoints, nextUndecided, normalizeDeckId, pokerPresets, pokerSummary, resolveCardKey,
  soloEstimate, soloReveal, soloRevote, soloSetCurrent, soloStart, soloVote,
} from "./poker";

describe("decks and cards", () => {
  it("keeps the decks the server accepts", () => {
    expect(POKER_DECKS.fibonacci).toEqual(["0", "1", "2", "3", "5", "8", "13", "21", "?", "coffee"]);
    expect(POKER_DECKS.modified).toEqual(["0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100", "?", "coffee"]);
    expect(POKER_DECKS.tshirt).toEqual(["XS", "S", "M", "L", "XL", "?", "coffee"]);
  });

  it("maps cards to story points", () => {
    expect(cardPoints("13", "fibonacci")).toBe(13);
    expect(cardPoints("0.5", "modified")).toBe(0.5);
    expect(cardPoints("M", "tshirt")).toBe(3);
    expect(cardPoints("XL", "tshirt")).toBe(8);
    expect(cardPoints("?", "fibonacci")).toBeNull();
    expect(cardPoints("coffee", "tshirt")).toBeNull();
    expect(cardFace("0.5")).toBe("½");
    expect(deckPoints("tshirt")).toEqual([1, 2, 3, 5, 8]);
    expect(normalizeDeckId("nope")).toBe("fibonacci");
    expect(normalizeDeckId("tshirt")).toBe("tshirt");
  });

  it("proposes the deck value closest to an average, rounding ties up", () => {
    expect(nearestDeckPoints(4.2, "fibonacci")).toBe(5);
    expect(nearestDeckPoints(6.5, "fibonacci")).toBe(8);
    expect(nearestDeckPoints(10.5, "fibonacci")).toBe(13);
    expect(nearestDeckPoints(100, "fibonacci")).toBe(21);
  });
});

describe("pokerSummary", () => {
  it("summarises a split vote and ignores ? and coffee in the maths", () => {
    const summary = pokerSummary(["3", "5", "8", "?", "coffee", null], "fibonacci");
    expect(summary).toMatchObject({ total: 5, numeric: 3, unsure: 1, coffee: 1, min: 3, max: 8, median: 5, divided: true, consensus: false });
    expect(summary.average).toBeCloseTo(5.33, 2);
    expect(summary.suggested).toBe(5);
    expect(summary.distribution.map((entry) => entry.value)).toEqual(["3", "5", "8", "?", "coffee"]);
  });

  it("detects consensus only when at least two people agree and nobody else voted differently", () => {
    expect(pokerSummary(["5", "5", "5"], "fibonacci")).toMatchObject({ consensus: true, suggested: 5, divided: false });
    expect(pokerSummary(["5", "5", "?"], "fibonacci").consensus).toBe(false);
    expect(pokerSummary(["5"], "fibonacci")).toMatchObject({ consensus: false, suggested: 5 });
    expect(pokerSummary(["M", "M"], "tshirt")).toMatchObject({ consensus: true, suggested: 3 });
  });

  it("has no suggestion when nobody played points", () => {
    expect(pokerSummary([], "fibonacci")).toMatchObject({ total: 0, average: null, suggested: null });
    expect(pokerSummary(["?", "coffee"], "fibonacci")).toMatchObject({ numeric: 0, suggested: null, median: null });
  });

  it("averages even counts for the median and works on t-shirt points", () => {
    expect(pokerSummary(["2", "3", "5", "8"], "fibonacci").median).toBe(4);
    const shirts = pokerSummary(["S", "XL"], "tshirt");
    expect(shirts.average).toBe(5);
    expect(shirts.suggested).toBe(5);
  });
});

describe("resolveCardKey", () => {
  it("picks unambiguous cards at once and waits on prefixes", () => {
    expect(resolveCardKey("5", "fibonacci")).toEqual({ card: "5", pending: false });
    expect(resolveCardKey("1", "fibonacci")).toEqual({ card: "1", pending: true });
    expect(resolveCardKey("13", "fibonacci")).toEqual({ card: "13", pending: false });
    expect(resolveCardKey("4", "fibonacci")).toEqual({ card: null, pending: false });
    expect(resolveCardKey("?", "fibonacci")).toEqual({ card: "?", pending: false });
    expect(resolveCardKey("c", "fibonacci")).toEqual({ card: "coffee", pending: false });
  });

  it("types halves and t-shirt sizes", () => {
    expect(resolveCardKey(".5", "modified")).toEqual({ card: "0.5", pending: false });
    expect(resolveCardKey("0", "modified")).toEqual({ card: "0", pending: true });
    expect(resolveCardKey("x", "tshirt")).toEqual({ card: null, pending: true });
    expect(resolveCardKey("xl", "tshirt")).toEqual({ card: "XL", pending: false });
    expect(resolveCardKey("s", "tshirt")).toEqual({ card: "S", pending: false });
  });
});

describe("pokerPresets", () => {
  const tasks = [
    { id: "a", title: "A", storyPoints: null },
    { id: "b", title: "B", storyPoints: 3 },
    { id: "c", title: "C", storyPoints: null },
    { id: "d", title: "D", storyPoints: null, completed: true },
    { id: "e", title: "E", storyPoints: 2, deletedAt: "2026-01-01" },
    { id: "f", title: "F" },
  ];
  const cycles = [
    { id: "s1", name: "Sprint 1", startsOn: "2026-09-21", endsOn: "2026-10-04", issueIds: ["a", "b", "d"] },
    { id: "s2", name: "Sprint 2", startsOn: "2026-10-05", endsOn: "2026-10-18", issueIds: ["c"] },
    { id: "s0", name: "Sprint 0", startsOn: "2026-09-07", endsOn: "2026-09-20", issueIds: [] },
  ];

  it("builds the quick selections from open tasks and the sprints around today", () => {
    const presets = pokerPresets(tasks, cycles, "2026-10-02");
    expect(presets.map((preset) => preset.id)).toEqual(["unestimated", "active", "next", "backlog", "open"]);
    expect(presets.find((preset) => preset.id === "unestimated")?.taskIds).toEqual(["a", "c", "f"]);
    expect(presets.find((preset) => preset.id === "active")).toMatchObject({ cycleName: "Sprint 1", taskIds: ["a", "b"] });
    expect(presets.find((preset) => preset.id === "next")).toMatchObject({ cycleName: "Sprint 2", taskIds: ["c"] });
    expect(presets.find((preset) => preset.id === "backlog")?.taskIds).toEqual(["f"]);
    expect(presets.find((preset) => preset.id === "open")?.taskIds).toEqual(["a", "b", "c", "f"]);
  });

  it("leaves out empty presets and an 'all open' that adds nothing", () => {
    expect(pokerPresets([{ id: "a", title: "A" }], [], "2026-10-02").map((preset) => preset.id)).toEqual(["unestimated"]);
    expect(pokerPresets([], cycles, "2026-10-02")).toEqual([]);
  });
});

describe("solo state machine", () => {
  const me = { id: "me", name: "Ada" };
  const start = () => soloStart(me, [{ id: "a", title: "A", storyPoints: 2 }, { id: "b", title: "B" }, { id: "c", title: "C" }], "fibonacci", "p1");

  it("deals, votes, reveals and re-votes with the server's session shape", () => {
    let session = start();
    expect(session).toMatchObject({ status: "active", canControl: true, currentIndex: 0, round: 1, revealed: false, myVote: null });
    expect(session.items.map((item) => item.storyPoints)).toEqual([2, null, null]);
    session = soloVote(session, "5");
    expect(session.participants[0]).toMatchObject({ voted: true, vote: null });
    expect(soloVote(session, "99")).toBe(session);
    session = soloReveal(session);
    expect(session.participants[0].vote).toBe("5");
    expect(soloVote(session, "8").myVote).toBe("5");
    session = soloRevote(session);
    expect(session).toMatchObject({ revealed: false, myVote: null, round: 2 });
    expect(session.participants[0]).toMatchObject({ voted: false, vote: null });
  });

  it("records the estimate and moves to the next undecided task", () => {
    let session = soloReveal(soloVote(start(), "3"));
    session = soloEstimate(session, 3, true);
    expect(session.items[0]).toMatchObject({ finalPoints: 3, storyPoints: 3 });
    expect(session).toMatchObject({ currentIndex: 1, revealed: false, myVote: null, round: 1 });
    session = soloSetCurrent(session, 2);
    session = soloEstimate(session, 8, true);
    expect(session.currentIndex).toBe(1);
    session = soloEstimate(session, 1, true);
    expect(session.items.every((item) => item.finalPoints !== null)).toBe(true);
    expect(nextUndecided(session, 1)).toBeNull();
    expect(soloSetCurrent(session, 9)).toBe(session);
  });
});
