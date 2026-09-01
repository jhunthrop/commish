import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Law } from "@/projections/laws/types";
import type { PipelineCounts } from "@/projections/laws/registry";
import PlayerLawsPage from "./page";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

const registryMock = vi.hoisted(() => vi.fn<() => readonly Law[]>());
const discoveredPipelineCountsMock = vi.hoisted(() => vi.fn<() => PipelineCounts>());
vi.mock("@/projections/laws/registry", () => ({ registry: registryMock, discoveredPipelineCounts: discoveredPipelineCountsMock }));

const DEFAULT_COUNTS: PipelineCounts = { candidates: 1737, untestable: 488, bhSurvivors: 10, replicated: 4 };
discoveredPipelineCountsMock.mockReturnValue(DEFAULT_COUNTS);

/**
 * `boardConsequenceSentence` (fix round, I7): the page's own "where these show up" sentence used to
 * be a static claim — "every confirmed law feeds the board's own rankings" — which stopped being
 * true the moment a law could be confirmed with no `modelPath` wired to it yet. These render the
 * whole page with a controlled `registry()` fixture and read the sentence back off the DOM, so a
 * regression to a hardcoded claim would fail here rather than only being caught by inspection.
 */
function lawFixture(over: Partial<Law> = {}): Law {
  return {
    id: "fake_law",
    position: "RB",
    claim: "Fake law: a claim for fixtures only.",
    measured: { effect: -1, ci: [-2, -0.5], sample: 100, seasons: "2013-2023" },
    verdict: "confirmed",
    modelPath: null,
    hasFoldEvidence: true,
    origin: "tribal",
    primaryQuantityId: null,
    primaryQuantityNoun: null,
    primaryQuantityUnit: null,
    ...over,
  };
}

// Real committed candidate ids (`generateCandidates()`'s own output) — `groupIntoFamilies` looks
// every discovered `Law.id` up there, so a fixture using a fake id would throw. "touches" (RB) and
// "age" (WR) are deliberately DIFFERENT quantities AND different positions, so they never collapse
// into one family under the NESTING RULING (fix round 2).
const RB_TOUCHES_ID = "threshold:RB:touches:q80";
const WR_AGE_ID = "threshold:WR:age:q70";
const WR_TD_SHARE_ID = "threshold:WR:touchdownPointsShare:q80";

function discoveredLawFixture(over: Partial<Law> = {}): Law {
  return {
    id: RB_TOUCHES_ID,
    position: "RB",
    claim: "Running back carries and receptions: A running back whose combined carries and receptions that season is 182 or more gains points per game the following season.",
    measured: { effect: 1.5, ci: [0.5, 2.5], sample: 200, seasons: "2013-2023" },
    verdict: "confirmed",
    modelPath: null,
    hasFoldEvidence: true,
    origin: "discovered",
    // This page never reads these three (they are `ReasonChip`'s concern) — set to match the
    // default id's own quantity so the fixture stays internally honest either way.
    primaryQuantityId: "touches",
    primaryQuantityNoun: "carries and receptions",
    primaryQuantityUnit: "whole",
    ...over,
  };
}

describe("PlayerLawsPage — the mechanical claim count (fix round, CRITICAL 3)", () => {
  it("counts tribal laws plus confirmed discovered laws, never a hardcoded number", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a" }), lawFixture({ id: "b" }), discoveredLawFixture({ id: WR_AGE_ID })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/^3 claims about fantasy production, tested against what actually happened rather than assumed true\.$/)).toBeInTheDocument();
  });

  it("excludes a non-confirmed discovered law from the count", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a" }), discoveredLawFixture({ id: WR_AGE_ID, verdict: "weak" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/^1 claims? about fantasy production/)).toBeInTheDocument();
  });
});

describe("PlayerLawsPage — the discovered-laws section (fix round 1, CRITICAL 3; fix round 2, NESTING RULING)", () => {
  it("renders only CONFIRMED discovered laws, never weak or debunked ones", async () => {
    registryMock.mockReturnValue([
      lawFixture({ id: "tribal" }),
      discoveredLawFixture({ id: WR_AGE_ID, verdict: "confirmed" }),
      discoveredLawFixture({ id: WR_TD_SHARE_ID, verdict: "weak", claim: "Weak title: weak body sentence." }),
    ]);
    render(await PlayerLawsPage());
    expect(document.getElementById(WR_AGE_ID)).not.toBeNull();
    expect(document.getElementById(WR_TD_SHARE_ID)).toBeNull();
  });

  it("states the pipeline's own methodology sentence with the real counts, never a hardcoded number", async () => {
    discoveredPipelineCountsMock.mockReturnValueOnce({ candidates: 1737, untestable: 488, bhSurvivors: 10, replicated: 4 });
    registryMock.mockReturnValue([discoveredLawFixture()]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/screened for a false-discovery rate of at most 10% across the whole 1737-candidate family/)).toBeInTheDocument();
    expect(screen.getByText(/488 could not be matched on enough training seasons \(fewer than 20 matched pairs\)/)).toBeInTheDocument();
    expect(screen.getByText(/10 survived the false-discovery screen/)).toBeInTheDocument();
    expect(screen.getByText(/4 of those also replicated on 2022 or 2023/)).toBeInTheDocument();
  });

  it("NEW-1 — never claims the untestable candidates matched zero pairs", async () => {
    registryMock.mockReturnValue([discoveredLawFixture()]);
    render(await PlayerLawsPage());
    expect(screen.queryByText(/zero matched pairs/)).not.toBeInTheDocument();
  });

  it("NEW-2 — never references a candidate listing 'above' that the page does not render", async () => {
    registryMock.mockReturnValue([discoveredLawFixture()]);
    render(await PlayerLawsPage());
    expect(screen.queryByText(/candidates above/)).not.toBeInTheDocument();
  });

  it("NEW-4 — the card shows only the short (pre-comma) seasons window; the full replication-provenance record is never rendered", async () => {
    const longSeasons =
      "2013-2023, direction discovered on predictor seasons 2013-2021, replicated on predictor seasons 2021-2023 " +
      "(2021 sits inside the discovery train window; only seasons after it are genuinely out-of-sample for a discovered law)";
    registryMock.mockReturnValue([discoveredLawFixture({ measured: { effect: 1.5, ci: [0.5, 2.5], sample: 200, seasons: longSeasons } })]);
    render(await PlayerLawsPage());
    // The record itself (the fixture object passed to registry()) still carries the full string —
    // shortSeasonsLabel is a presentation-only transform, never a mutation of the underlying Law.
    expect(longSeasons).toContain("direction discovered on predictor seasons");
    // The card renders only the short window.
    expect(screen.getByText("2013-2023")).toBeInTheDocument();
    expect(screen.queryByText(longSeasons)).not.toBeInTheDocument();
    expect(screen.queryByText(/direction discovered on predictor seasons/)).not.toBeInTheDocument();
  });

  it("shows an honest empty state when zero discovered laws have confirmed yet", async () => {
    registryMock.mockReturnValue([lawFixture()]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/No discovered candidate has replicated yet/)).toBeInTheDocument();
  });

  it("boardConsequenceSentence names confirmed discovered laws as not yet chip- or model-eligible", async () => {
    registryMock.mockReturnValue([lawFixture({ modelPath: "src/x.ts#y" }), discoveredLawFixture()]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/The 1 confirmed discovered law does not show up as a reason chip or feed the board's rankings yet\./)).toBeInTheDocument();
  });

  it("NESTING RULING — collapses two confirmed discovered laws sharing a quantity set into one card, with the larger-sample one as representative", async () => {
    const big = discoveredLawFixture({ id: WR_AGE_ID, measured: { effect: -1.1, ci: [-1.5, -0.7], sample: 483, seasons: "2013-2023" } });
    const small = discoveredLawFixture({
      id: "threshold:WR:age:q90",
      measured: { effect: -2.0, ci: [-3.0, -1.0], sample: 20, seasons: "2013-2023" },
      claim: "Wide receiver age (30.00): A wide receiver whose age at that season's opener is 30.00 or more loses points per game the following season.",
    });
    registryMock.mockReturnValue([small, big]); // input order should not matter — sample decides representative
    render(await PlayerLawsPage());
    expect(document.getElementById(WR_AGE_ID)).not.toBeNull(); // the larger-sample law is the representative's own card
    expect(document.getElementById("threshold:WR:age:q90")).toBeNull(); // the smaller-sample one is nested, not its own card
    expect(screen.getByText(/Also holds, at a different threshold:/)).toBeInTheDocument();
  });

  it("NESTING RULING — a lone confirmed discovered law with no family gets no 'Also holds' line", async () => {
    registryMock.mockReturnValue([discoveredLawFixture()]);
    render(await PlayerLawsPage());
    expect(screen.queryByText(/Also holds, at a different threshold:/)).not.toBeInTheDocument();
  });

  it("NESTING RULING — a discovered family sharing a quantity with a tribal law gets the mechanical overlap note", async () => {
    registryMock.mockReturnValue([
      { ...lawFixture(), id: "td_regression", claim: "Touchdown regression: a player whose touchdown points make up a lot loses points." },
      discoveredLawFixture({ id: WR_TD_SHARE_ID }),
    ]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/This finding shares its own quantity with the tribal law "Touchdown regression"/)).toBeInTheDocument();
  });

  it("NESTING RULING — a discovered family with no tribal overlap gets no overlap note", async () => {
    registryMock.mockReturnValue([discoveredLawFixture({ id: WR_AGE_ID })]); // age/WR — no tribal law maps to it (rb_age_curve is RB-only)
    render(await PlayerLawsPage());
    expect(screen.queryByText(/shares its own quantity with the tribal law/)).not.toBeInTheDocument();
  });
});

describe("PlayerLawsPage — boardConsequenceSentence", () => {
  it("says every confirmed law feeds the rankings when every confirmed law is wired", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", modelPath: "src/x.ts#y" }), lawFixture({ id: "b", modelPath: "src/x.ts#z" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/Every confirmed law here feeds the board's own rankings/)).toBeInTheDocument();
  });

  it("says none are wired yet when every confirmed law lacks a modelPath", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", modelPath: null }), lawFixture({ id: "b", modelPath: null })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/None of the confirmed laws here are wired into the board's rankings yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Every confirmed law here feeds/)).not.toBeInTheDocument();
  });

  it("counts a partial wiring rather than defaulting to the all-or-nothing sentence", async () => {
    registryMock.mockReturnValue([
      lawFixture({ id: "a", modelPath: "src/x.ts#y" }),
      lawFixture({ id: "b", modelPath: null }),
      lawFixture({ id: "c", modelPath: null }),
    ]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/1 of 3 confirmed laws here feed the board's own rankings/)).toBeInTheDocument();
  });

  it("falls back to the chip-only sentence when nothing is confirmed", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", verdict: "weak" }), lawFixture({ id: "b", verdict: "debunked" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/^A reason chip beside a player's name states a confirmed law's measured effect/)).toBeInTheDocument();
  });

  it("always states the chip consequence, regardless of wiring", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", modelPath: "src/x.ts#y" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/a reason chip beside a player's name states/)).toBeInTheDocument();
  });
});

/**
 * `verdictElaboration`'s two fold-driven `weak` paths (fix round, MINOR): a full-window CI that
 * already excludes zero gets capped at `weak` either because a replication fold disagreed
 * (`hasFoldEvidence: true`) or because zero folds matched any pairs at all
 * (`hasFoldEvidence: false`) — two different facts, two different sentences, both driven by the
 * one boolean `Law` exposes rather than by anything typed per law.
 */
describe("PlayerLawsPage — verdictElaboration's weak paths", () => {
  const capsAtWeak = { measured: { effect: -1, ci: [-2, -0.5] as const, sample: 100, seasons: "2013-2023" }, verdict: "weak" as const };

  it("says a fold disagreed when hasFoldEvidence is true and the CI already excludes zero", async () => {
    registryMock.mockReturnValue([lawFixture({ ...capsAtWeak, hasFoldEvidence: true })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/at least one season checked separately pointed the other way/)).toBeInTheDocument();
  });

  it("says no fold had evidence when hasFoldEvidence is false and the CI already excludes zero", async () => {
    registryMock.mockReturnValue([lawFixture({ ...capsAtWeak, hasFoldEvidence: false })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/none of the seasons checked separately had enough matched pairs/)).toBeInTheDocument();
  });

  it("reports the CI-spans-zero path regardless of hasFoldEvidence", async () => {
    registryMock.mockReturnValue([lawFixture({ measured: { effect: -1, ci: [-1, 1], sample: 100, seasons: "2013-2023" }, verdict: "weak", hasFoldEvidence: false })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/the 95% interval spans zero/)).toBeInTheDocument();
  });
});
