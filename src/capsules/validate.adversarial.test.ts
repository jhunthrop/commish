import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { validateCapsule } from "./validate";

/**
 * ADVERSARIAL REGRESSION SUITE (fix round 1, code review 2026-09-05) — pins the exact bypasses an
 * independent review's own probe scripts (`probe.js`/`probe2.js`/`probe3.js`) demonstrated against
 * the pre-fix `validate.ts`: bidirectional-substring name grounding (CRITICAL 1), the spelled-out/
 * ordinal number blind spot (HIGH), the range/year regex minting spurious negatives (MEDIUM d),
 * a banned-vocabulary inflection escaping a bare `\bword\b` match (LOW), and the mandated-tension
 * check's sign-dropping shape (LOW, confirmed still closed after adding the cost-cue allowance).
 * Every case here failed the OLD implementation; every one must pass the CURRENT one.
 */

function pad(sentence: string, target = 65): string {
  const words = sentence.trim().replace(/\.$/, "").split(/\s+/);
  const filler = ["truly", "clearly", "frankly", "simply", "plainly", "further", "notably", "steadily", "really", "overall"];
  let i = 0;
  while (words.length < target) { words.push(filler[i % filler.length]); i += 1; }
  return `${words.join(" ")}.`;
}

const RASHAD_LONG: PlayerFactsInput = {
  identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
  productSeason: 2026,
  reasons: [],
  laws: [],
  market: { adp: 12.5, positionAdp: "RB6", boardRank: 14 },
  projection: { projectedPoints: 248, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 },
  byeWeek: 9,
  season: null,
  injury: { state: "unknown" },
  news: [],
  lastSeasonStory: null,
  booksNumbers: { propsLines: [], teamVegasWinTotal: null },
  usage: null,
    trend: null,
};

describe("probe check — CRITICAL 1 name grounding", () => {
  const facts = buildPlayerFacts(RASHAD_LONG);

  it("Justin Herbert fails closed (was a false pass via RB substring in 'heRBert')", () => {
    const r = validateCapsule(pad("Rashad Long plays like Justin Herbert for the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes("Justin Herbert"))).toBe(true);
  });

  it("Marcus Long fails closed (was a false pass via decomposed 'Long')", () => {
    const r = validateCapsule(pad("Marcus Long anchors the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes("Marcus Long"))).toBe(true);
  });

  it("the subject's own full name still passes", () => {
    const r = validateCapsule(pad("Rashad Long anchors the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.toLowerCase().includes("name"))).toBe(false);
  });
});

describe("probe check — HIGH spelled/ordinal numbers", () => {
  it("catches a spelled-out cardinal not in the ledger", () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(pad("Rashad Long caught seventeen passes for the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes("seventeen"))).toBe(true);
  });

  it("catches an ordinal not in the ledger", () => {
    // 5 traces to nothing in RASHAD_LONG's own ledger (unlike 9 — his bye week — or 12/14, both
    // reachable by rounding his 12.5 ADP or his own board rank).
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(pad("Rashad Long is in his 5th season for the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes("5th"))).toBe(true);
  });

  it("passes an ordinal that is in the ledger", () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(pad("Rashad Long has the 14th overall board rank for the SF offense, our number of 248 season points this season, a real anchor."), facts, "compact");
    expect(r.violations.some((v) => v.includes("14th"))).toBe(false);
  });
});

describe("probe check — MEDIUM d range/year regex", () => {
  it("a touches range mints two positive numbers, never a spurious negative", () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    // Neither 20 nor 25 traces to any fact — expect exactly those two flagged, never "-25".
    const r = validateCapsule(pad("Rashad Long sees 20-25 touches a week for the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes('"-25"'))).toBe(false);
    expect(r.violations.some((v) => v.includes('"25"'))).toBe(true);
    expect(r.violations.some((v) => v.includes('"20"'))).toBe(true);
  });

  it("a year span mints two positive years, never a spurious negative", () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(pad("Rashad Long broke out across 2023-2024 for the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes('"-2024"'))).toBe(false);
  });
});

describe("probe check — LOW banned-vocab inflection and tension cue", () => {
  it("catches GOATed", () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(pad("Rashad Long is a GOATed talent for the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes('"goat"'))).toBe(true);
  });

  it("probe3: dropping the sign with NO cost-cue word nearby still fails closed (the bypass probe3.js checks)", () => {
    const withLaw: PlayerFactsInput = {
      ...RASHAD_LONG,
      reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }],
      laws: [
        {
          id: "rb_age_curve", position: "RB", claim: "Running backs decline sharply after 28.",
          measured: { effect: -1.8, ci: [-2.4, -1.2], sample: 120, seasons: "2018-2024" }, trainEffect: -1.8,
          verdict: "confirmed", modelPath: null, hasFoldEvidence: true, origin: "tribal",
          primaryQuantityId: null, primaryQuantityNoun: null, primaryQuantityUnit: null,
        },
      ],
    };
    const facts = buildPlayerFacts(withLaw);
    // "1.8" appears with no cost-cue word (costs/minus/down/shaves) anywhere near it — this must
    // NOT satisfy the tension mandate, or a rave could cite the bare magnitude of its own downside
    // as if it were an unrelated positive stat.
    const r = validateCapsule(pad("Rashad Long is a lock at board rank 14, our number of 248 season points, he is worth 1.8 more than typical backs this season, a clear buy."), facts, "compact");
    expect(r.violations.some((v) => v.includes("Mixed evidence"))).toBe(true);
  });

  it("accepts an unsigned tension magnitude alongside a cost-cue word in the same sentence", () => {
    const withLaw: PlayerFactsInput = {
      ...RASHAD_LONG,
      reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }],
      laws: [
        {
          id: "rb_age_curve", position: "RB", claim: "Running backs decline sharply after 28.",
          measured: { effect: -1.8, ci: [-2.4, -1.2], sample: 120, seasons: "2018-2024" }, trainEffect: -1.8,
          verdict: "confirmed", modelPath: null, hasFoldEvidence: true, origin: "tribal",
          primaryQuantityId: null, primaryQuantityNoun: null, primaryQuantityUnit: null,
        },
      ],
    };
    const facts = buildPlayerFacts(withLaw);
    const r = validateCapsule(pad("Rashad Long anchors the SF offense at board rank 14, our number of 248 season points, though the age curve costs him 1.8 a game, still a buy this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes("Mixed evidence"))).toBe(false);
  });
});

describe("re-review round 2: honest shorthand passes, fabrication still fails", () => {
  const facts = buildPlayerFacts({
    ...RASHAD_LONG,
    identity: { id: "p2", name: "Amon-Ra St. Brown", position: "WR", team: "DET" },
  });

  it("accepts the subject's own possessive and his surname shorthand", () => {
    expect(validateCapsule(pad("Amon-Ra St. Brown's role is safe in the DET offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact").ok).toBe(true);
    expect(validateCapsule(pad("St. Brown owns the slot for DET, our number of 248 season points and board rank 14 overall this season."), facts, "compact").ok).toBe(true);
  });

  it("sheds a sentence-initial verb from the subject's name, and only from the subject's", () => {
    // First live sweep, 2026-09-05: "Buy Jahmyr Gibbs" extracted as one capitalized run.
    expect(validateCapsule(pad("Buy Amon-Ra St. Brown for the DET offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact").ok).toBe(true);
    expect(validateCapsule(pad("Buy Justin Herbert for the DET offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact").ok).toBe(false);
  });

  it("still rejects a fabricated name, possessive or shorthand alike", () => {
    expect(validateCapsule(pad("Justin Herbert's arm shows up for DET, our number of 248 season points and board rank 14 overall this season."), facts, "compact").ok).toBe(false);
    expect(validateCapsule(pad("Marcus Brown had a day for DET, our number of 248 season points and board rank 14 overall this season."), facts, "compact").ok).toBe(false);
  });
});

/**
 * PRECISION FIX ROUND 2 (live full-board regeneration, 2026-09-05: 454/659 template fallbacks,
 * a large share from FALSE rejections of honest prose) — pins the two live false-rejection
 * classes and the safety properties that must survive fixing them. See `validate.ts`'s own
 * docblocks on `extractProperNamePhrases` (PART A, sentence-boundary tokenization) and
 * `isNameGroundedWithShedding` (PART B, verb+lastname shorthand) for the mechanism.
 */
describe("precision fix round 2 — PART A: sentence-boundary tokenization", () => {
  it('a ledgered name followed by the next sentence\'s capitalized first word still grounds ("Tre Tucker. The")', () => {
    const facts = buildPlayerFacts({ ...RASHAD_LONG, identity: { id: "p3", name: "Tre Tucker", position: "WR", team: "LV" } });
    const r = validateCapsule(
      pad("Tre Tucker. The board loves him plenty for the LV offense, our number of 248 season points and board rank 14 overall this season."),
      facts,
      "compact",
    );
    expect(r.violations.some((v) => v.includes("does not trace"))).toBe(false);
  });

  it('a ledgered named neighbor followed by the next sentence\'s capitalized first word still grounds ("Bijan Robinson. He")', () => {
    const lastSeasonStory = {
      season: 2025,
      pointsRank: { value: 264, positionRank: 2, qualifierCount: 42, namedNeighbor: "Bijan Robinson" },
      pointsPerGame: 18.2,
      gamesPlayed: 16,
      bestWeek: { week: 9, points: 32.4 },
      weeksAboveMedian: 9,
      touchesRank: null,
      receivingYardsRank: { value: 612, positionRank: 3, qualifierCount: 42, namedNeighbor: null },
    };
    const facts = buildPlayerFacts({ ...RASHAD_LONG, lastSeasonStory });
    const r = validateCapsule(
      pad("Rashad Long trails Bijan Robinson. He still profiles well for the SF offense, our number of 248 season points and board rank 14 overall this season."),
      facts,
      "compact",
    );
    expect(r.violations.some((v) => v.includes("does not trace"))).toBe(false);
  });

  it('a genuinely unledgered name at the very same sentence-boundary shape still fails ("Marcus Fakename. The")', () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(
      pad("Rashad Long splits time with Marcus Fakename. The rest of the backfield rounds out the SF offense, our number of 248 season points and board rank 14 overall this season."),
      facts,
      "compact",
    );
    expect(r.violations.some((v) => v.includes("Marcus Fakename"))).toBe(true);
  });

  it("keeps the pinned in-name abbreviations matching: St. Brown, T.J. Hockenson, Tyrone Tracy Jr.", () => {
    const stBrownFacts = buildPlayerFacts({ ...RASHAD_LONG, identity: { id: "p4", name: "Amon-Ra St. Brown", position: "WR", team: "DET" } });
    expect(
      validateCapsule(pad("Amon-Ra St. Brown anchors the DET offense, our number of 248 season points and board rank 14 overall this season."), stBrownFacts, "compact").violations.some((v) =>
        v.includes("does not trace"),
      ),
    ).toBe(false);

    const hockensonFacts = buildPlayerFacts({ ...RASHAD_LONG, identity: { id: "p5", name: "T.J. Hockenson", position: "TE", team: "MIN" } });
    expect(
      validateCapsule(pad("T.J. Hockenson anchors the MIN offense, our number of 248 season points and board rank 14 overall this season."), hockensonFacts, "compact").violations.some((v) =>
        v.includes("does not trace"),
      ),
    ).toBe(false);

    const tracyFacts = buildPlayerFacts({ ...RASHAD_LONG, identity: { id: "p6", name: "Tyrone Tracy Jr.", position: "RB", team: "NYG" } });
    expect(
      validateCapsule(pad("Tyrone Tracy Jr. anchors the NYG offense, our number of 248 season points and board rank 14 overall this season."), tracyFacts, "compact").violations.some((v) =>
        v.includes("does not trace"),
      ),
    ).toBe(false);
  });

  describe("a name suffix ('Jr.') immediately before a new sentence (review round 2, Important)", () => {
    const tracyFacts = buildPlayerFacts({ ...RASHAD_LONG, identity: { id: "p8", name: "Tyrone Tracy Jr.", position: "RB", team: "NYG" } });

    it('grounds when the suffix is followed by the next sentence\'s capitalized first word ("Tyrone Tracy Jr. He is a stud")', () => {
      const r = validateCapsule(
        pad("Tyrone Tracy Jr. He is a stud for the NYG offense, our number of 248 season points and board rank 14 overall this season."),
        tracyFacts,
        "compact",
      );
      expect(r.violations.some((v) => v.includes("does not trace"))).toBe(false);
    });

    it("still grounds the ordinary mid-name form (no following sentence break)", () => {
      const r = validateCapsule(pad("Tyrone Tracy Jr. leads the NYG backfield, our number of 248 season points and board rank 14 overall this season."), tracyFacts, "compact");
      expect(r.violations.some((v) => v.includes("does not trace"))).toBe(false);
    });

    it('a fabricated name with the same suffix-then-sentence-break shape still fails ("Fake Name Jr. He")', () => {
      const r = validateCapsule(
        pad("Fake Name Jr. He is a stud for the NYG offense, our number of 248 season points and board rank 14 overall this season."),
        tracyFacts,
        "compact",
      );
      expect(r.violations.some((v) => v.includes("Fake Name Jr"))).toBe(true);
    });
  });
});

describe("precision fix round 2 — PART B: verb + lastname shorthand", () => {
  const mccaffreyFacts = buildPlayerFacts({ ...RASHAD_LONG, identity: { id: "p7", name: "Christian McCaffrey", position: "RB", team: "SF" } });

  it('a verb + lastname pair grounds via the surname suffix rule ("Buy McCaffrey")', () => {
    const r = validateCapsule(pad("Buy McCaffrey for the SF offense, our number of 248 season points and board rank 14 overall this season."), mccaffreyFacts, "compact");
    expect(r.violations.some((v) => v.includes("does not trace"))).toBe(false);
  });

  it("an unledgered surname after the same verb still fails closed", () => {
    const r = validateCapsule(pad("Buy Fakename for the SF offense, our number of 248 season points and board rank 14 overall this season."), mccaffreyFacts, "compact");
    expect(r.violations.some((v) => v.includes("Buy Fakename"))).toBe(true);
  });

  it("a plausible given name in that slot (not a sentence verb) still fails, even though the surname matches (Marcus McCaffrey)", () => {
    const r = validateCapsule(pad("Marcus McCaffrey had a day for the SF offense, our number of 248 season points and board rank 14 overall this season."), mccaffreyFacts, "compact");
    expect(r.violations.some((v) => v.includes("Marcus McCaffrey"))).toBe(true);
  });

  it('review round 2, CRITICAL (executed probe): a real NFL given name in that slot ("Chase McCaffrey") still fails, even though the surname matches', () => {
    // "Chase" was removed from SENTENCE_VERB_WORDS after the reviewer's own executed probe showed
    // it false-passing here (Chase Brown, Chase Claypool, Chase Edmonds are all real given names).
    const r = validateCapsule(pad("Chase McCaffrey had a huge day for the SF offense, our number of 248 season points and board rank 14 overall this season."), mccaffreyFacts, "compact");
    expect(r.violations.some((v) => v.includes("Chase McCaffrey"))).toBe(true);
  });

  it("the ledgered decomposed single-word floor still holds: a ledgered 'Rashad Long' never lets bare 'Long' pass under a real first name", () => {
    const facts = buildPlayerFacts(RASHAD_LONG);
    const r = validateCapsule(pad("Marcus Long anchors the SF offense, our number of 248 season points and board rank 14 overall this season."), facts, "compact");
    expect(r.violations.some((v) => v.includes("Marcus Long"))).toBe(true);
  });
});
