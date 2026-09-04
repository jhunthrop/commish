import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { discoveredHeadline, ReasonChip, strongestLawReasons } from "./reason-chip";

/**
 * `discoveredHeadline`'s GENERIC RENDERER, PINNED against small hand-built `Law` fixtures — never
 * `registry()` or `generateCandidates()` (Task 8 fix round, IMPORTANT 2 RULING: this component reads
 * a discovered law's own PERSISTED `primaryQuantityNoun`/`primaryQuantityUnit` fields rather than
 * importing the candidate generator or its committed quantile table, so this file no longer needs
 * either to pin the mechanical rendering rule). The mechanical rule itself — plain-rounded magnitude
 * formatting, keyed by `primaryQuantityUnit` — is exercised here; `board-reasons.test.ts` exercises
 * the SERVER-SIDE consistency guard that keeps a law's persisted `primaryQuantityId` honest against
 * the live template.
 */

function discoveredLawFixture(over: Partial<Law> = {}): Law {
  return {
    id: "threshold:RB:touches:q70",
    position: "RB",
    claim: "Fixture claim for a discovered law.",
    measured: { effect: -1.4, ci: [-2, -0.8], sample: 100, seasons: "fixture" },
    trainEffect: -1.4,
    verdict: "confirmed",
    modelPath: null,
    hasFoldEvidence: true,
    origin: "discovered",
    primaryQuantityId: "touches",
    primaryQuantityNoun: "carries and receptions",
    primaryQuantityUnit: "whole",
    ...over,
  };
}

describe("discoveredHeadline", () => {
  it("renders a \"whole\" unit with plain rounding, as \"{value} {noun}\"", () => {
    const law = discoveredLawFixture({ primaryQuantityNoun: "carries and receptions", primaryQuantityUnit: "whole" });
    expect(discoveredHeadline(181.5, law)).toBe("182 carries and receptions");
  });

  it("renders a \"two_decimal\" unit with plain rounding (age), never ceiling, NOUN-FIRST (the age unit's own generic word-order rule)", () => {
    const law = discoveredLawFixture({ primaryQuantityNoun: "age", primaryQuantityUnit: "two_decimal" });
    // Ceiling (the THRESHOLD rule) would read "27.73"; plain rounding (the MAGNITUDE rule) reads "27.72".
    // Word order is noun-first for "two_decimal" specifically (`wordOrderFor`) — "age 27.72", not "27.72 age".
    expect(discoveredHeadline(27.723, law)).toBe("age 27.72");
  });

  it("renders a \"one_decimal\" unit with plain rounding", () => {
    const law = discoveredLawFixture({ primaryQuantityNoun: "target depth", primaryQuantityUnit: "one_decimal" });
    expect(discoveredHeadline(11.24, law)).toBe("11.2 target depth");
  });

  it("renders a \"percent\" unit with a trailing % and plain rounding", () => {
    const law = discoveredLawFixture({ primaryQuantityNoun: "touchdown-points share", primaryQuantityUnit: "percent" });
    expect(discoveredHeadline(0.2349, law)).toBe("23.5% touchdown-points share");
  });

  it("returns undefined when the law's presentation fields are null — a tribal law passed by mistake", () => {
    const law = discoveredLawFixture({ origin: "tribal", primaryQuantityId: null, primaryQuantityNoun: null, primaryQuantityUnit: null });
    expect(discoveredHeadline(182, law)).toBeUndefined();
  });

  it("never renders an em-dash across every unit shape", () => {
    const units = [
      ["whole", "carries and receptions", 182] as const,
      ["two_decimal", "age", 27.723] as const,
      ["one_decimal", "target depth", 11.24] as const,
      ["percent", "touchdown-points share", 0.2349] as const,
    ];
    for (const [unit, noun, magnitude] of units) {
      const law = discoveredLawFixture({ primaryQuantityNoun: noun, primaryQuantityUnit: unit });
      expect(discoveredHeadline(magnitude, law)).not.toMatch(/—/);
    }
  });
});

describe("ReasonChip — a discovered law's reason", () => {
  it("renders the mechanical headline from the law's own persisted fields", () => {
    const law = discoveredLawFixture({
      id: "threshold:WR:touchdownPointsShare:q80",
      primaryQuantityNoun: "touchdown-points share",
      primaryQuantityUnit: "percent",
    });
    const reason: BoardReason = { code: "law", lawId: law.id, effect: -1.4, magnitude: 0.235 };
    render(<ReasonChip reason={reason} registry={[law]} />);
    expect(screen.getByText(/23\.5% touchdown-points share: measured -1\.4 pts per game/)).toBeInTheDocument();
  });

  it("falls back to the mechanical fallback headline for an id with no matching registry entry", () => {
    const reason: BoardReason = { code: "law", lawId: "not_a_real_candidate_id", effect: -1.4, magnitude: 182 };
    render(<ReasonChip reason={reason} registry={[]} />);
    expect(screen.getByText(/Not a real candidate id: measured -1\.4 pts per game/)).toBeInTheDocument();
  });

  it("compact leads with the effect alone and moves the whole sentence to the screen reader", () => {
    // The draft board's sticker (founder screenshot, 2026-09-04): a full sentence in a fixed
    // cell truncates to a bare figure and half a word, so compact shows the one fact that
    // never truncates and keeps the sentence as sr-only elaboration.
    const law = discoveredLawFixture({
      id: "threshold:WR:touchdownPointsShare:q80",
      primaryQuantityNoun: "touchdown-points share",
      primaryQuantityUnit: "percent",
    });
    const reason: BoardReason = { code: "law", lawId: law.id, effect: -1.4, magnitude: 0.235 };
    const { container } = render(<ReasonChip reason={reason} registry={[law]} compact />);
    expect(screen.getByText(/^-1\.4 pts$/)).toBeInTheDocument();
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly?.textContent).toContain("23.5% touchdown-points share: measured -1.4 pts per game");
    expect(srOnly?.textContent).toContain(law.claim);
  });
});

describe("ReasonChip — market_anchor and market_unlisted (I6/M8 fix round)", () => {
  it("renders market_anchor's own marketPoints and signed delta", () => {
    const reason: BoardReason = { code: "market_anchor", marketPoints: 210.4, delta: -3.2 };
    render(<ReasonChip reason={reason} registry={[]} />);
    expect(screen.getByText(/Market 210\.4 pts, -3\.2 from evidence/)).toBeInTheDocument();
  });

  it("renders market_unlisted's own neutral copy (fix round 3, IMPORTANT 2: the old copy claimed model-only pricing, which is no longer true under min(raw, tail))", () => {
    const reason: BoardReason = { code: "market_unlisted" };
    render(<ReasonChip reason={reason} registry={[]} />);
    expect(screen.getByText(/^No market ADP$/)).toBeInTheDocument();
  });
});

describe("strongestLawReasons — the two-chip compact surface stays LAW-ONLY (M8 pin)", () => {
  it("never returns a market_anchor or market_unlisted reason, however many law reasons are present", () => {
    const reasons: readonly BoardReason[] = [
      { code: "market_anchor", marketPoints: 200, delta: 5 },
      { code: "market_unlisted" },
      { code: "law", lawId: "rb_age_curve", effect: -1.25, magnitude: 31 },
      { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
    ];
    const strongest = strongestLawReasons(reasons);
    expect(strongest.every((reason) => reason.code === "law")).toBe(true);
    expect(strongest).toEqual([{ code: "law", lawId: "rb_age_curve", effect: -1.25, magnitude: 31 }]);
  });

  it("returns an empty list when the only reasons present are market_anchor/market_unlisted, never falling back to them", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: 5 }, { code: "market_unlisted" }];
    expect(strongestLawReasons(reasons)).toEqual([]);
  });
});
