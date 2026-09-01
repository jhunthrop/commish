import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CandidateLaw } from "@/projections/laws/discovery/generate";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { discoveredHeadline, ReasonChip } from "./reason-chip";

/**
 * `discoveredHeadline`'s GENERIC RENDERER, PINNED against small hand-built `CandidateLaw` fixtures —
 * never the real `generateCandidates()` (a discovery round changes which ids are `confirmed`), so
 * this file's pass/fail can never move with a future `npm run laws:discover` re-run. The mechanical
 * rule itself (`"{formatted value} {quantity's short label}"`, primary quantity = the AND clause's
 * LEFT half) is exercised end to end here; `board-reasons.test.ts` exercises the identical
 * "primary = left" rule on the `magnitude` NUMBER's own side.
 */

function thresholdCandidate(id: string, quantityId: "touches" | "age" | "touchdownPointsShare"): CandidateLaw {
  return {
    id,
    position: "RB",
    template: "threshold",
    condition: () => true,
    claimParts: { position: "RB", clause: { kind: "threshold", quantityId, quantileLevel: 0.7 } },
  };
}

function andCandidate(id: string): CandidateLaw {
  return {
    id,
    position: "WR",
    template: "and",
    condition: () => true,
    claimParts: {
      position: "WR",
      clause: {
        kind: "and",
        left: { kind: "threshold", quantityId: "touchdownPointsShare", quantileLevel: 0.7 },
        right: { kind: "threshold", quantityId: "incomingCoachTenureSeasons", quantileLevel: 0.7 },
      },
    },
  };
}

function candidateMap(...candidates: readonly CandidateLaw[]): ReadonlyMap<string, CandidateLaw> {
  return new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
}

describe("discoveredHeadline", () => {
  it("renders a THRESHOLD candidate as \"{formatted value} {short label}\", whole-number quantity", () => {
    const candidates = candidateMap(thresholdCandidate("threshold:RB:touches:q70", "touches"));
    expect(discoveredHeadline("threshold:RB:touches:q70", 182, candidates)).toBe("182 carries and receptions");
  });

  it("renders a THRESHOLD candidate's decimal quantity with the quantity's own precision (age, 2 decimals)", () => {
    const candidates = candidateMap(thresholdCandidate("threshold:RB:age:q70", "age"));
    expect(discoveredHeadline("threshold:RB:age:q70", 27.723, candidates)).toBe("27.73 age");
  });

  it("renders a percent-share quantity with a trailing %", () => {
    const candidates = candidateMap(thresholdCandidate("threshold:WR:touchdownPointsShare:q80", "touchdownPointsShare"));
    expect(discoveredHeadline("threshold:WR:touchdownPointsShare:q80", 0.235, candidates)).toBe("23.5% touchdown-points share");
  });

  it("renders an AND candidate from its PRIMARY (left) clause's quantity, never the right one", () => {
    const candidates = candidateMap(andCandidate("and:WR:td+coach"));
    expect(discoveredHeadline("and:WR:td+coach", 0.41, candidates)).toBe("41.0% touchdown-points share");
  });

  it("returns undefined for a lawId with no matching candidate — a stale, since-regenerated id", () => {
    expect(discoveredHeadline("threshold:RB:touches:q70", 182, candidateMap())).toBeUndefined();
  });

  it("never renders an em-dash — every formatValue and shortLabel this engine ships is em-dash-free", () => {
    const candidates = candidateMap(
      thresholdCandidate("threshold:RB:touches:q70", "touches"),
      thresholdCandidate("threshold:RB:age:q70", "age"),
      andCandidate("and:WR:td+coach"),
    );
    for (const [id, magnitude] of [
      ["threshold:RB:touches:q70", 182],
      ["threshold:RB:age:q70", 27.723],
      ["and:WR:td+coach", 0.41],
    ] as const) {
      expect(discoveredHeadline(id, magnitude, candidates)).not.toMatch(/—/);
    }
  });
});

describe("ReasonChip — a discovered law's reason", () => {
  const REGISTRY: readonly Law[] = [
    {
      id: "not_a_real_candidate_id",
      position: "RB",
      claim: "Fixture claim for a discovered law.",
      measured: { effect: -1.4, ci: [-2, -0.8], sample: 100, seasons: "fixture" },
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "discovered",
    },
  ];

  it("falls back to the mechanical fallback headline for an id with no matching real candidate", () => {
    // No override parameter on the component itself — `ReasonChip` always resolves a discovered
    // headline against the REAL `generateCandidates()`, so a fixture id this file invents (never a
    // real candidate) exercises the graceful `fallbackHeadline` path rather than the mechanical one.
    const reason: BoardReason = { code: "law", lawId: "not_a_real_candidate_id", effect: -1.4, magnitude: 182 };
    render(<ReasonChip reason={reason} registry={REGISTRY} />);
    expect(screen.getByText(/Not a real candidate id: measured -1\.4 pts per game/)).toBeInTheDocument();
  });
});
