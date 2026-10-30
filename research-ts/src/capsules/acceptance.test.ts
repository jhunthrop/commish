import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { EMPTY_DEPTH, type PlayerFactsDepth } from "./facts/types";
import { CAPSULE_CONFIG } from "./config";
import { NARRATIVE_WORD_CAPS } from "./narrative-slots";
import { depthNumbers } from "./facts/ledger";
import { renderFactsForModel } from "./render";
import { renderDepthSection } from "./render-depth";
import { groundingOf, softCorrectionFor, UNFRAMED_FLOOR_VIOLATION, validateCapsule, validateNarrativeSlot } from "./validate";

/**
 * THE ACCEPTANCE ROUND'S OWN FIXTURES (2026-09-07) — every rejection the coordinator's live
 * diagnostic actually measured, one test each, against the exact examples it recorded.
 *
 * 446 of 659 board players sat on the template, and the cause was the VALIDATOR, not the gateway:
 * roughly one in ten generations passed. The categories, most common first, were an ungrounded
 * number (nearly all of them honest readings of supplied facts), the word band, and two name
 * false positives. Each of those examples is a test below that PASSES now, paired with a test
 * proving the thing the check exists to catch still fails.
 *
 * The suite deliberately reads as a before-and-after ledger of that measurement, so the next
 * person to loosen a check can see exactly which failure each loosening was bought for.
 */

function baseInput(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "NYG" },
    productSeason: 2026,
    reasons: [{ code: "scarcity", positionRank: 4, replacementLevel: 228 }],
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
    trend: {
      pointsPerGame: { priorSeason: 2024, priorValue: 2.55, recentSeason: 2025, recentValue: 7.94, delta: 5.39, material: true },
      yardsPerOpportunity: null,
      targetShare: null,
    },
    ...overrides,
  };
}

const FACTS = buildPlayerFacts(baseInput());

/** One short, grounded sentence — the shape of a narrative slot, which is where a single written
 *  number is easiest to test without a seventy-word band getting in the way. */
function slotResult(text: string, facts = FACTS) {
  return validateNarrativeSlot(text, groundingOf(facts), NARRATIVE_WORD_CAPS.module);
}

describe("cause 1: an ungrounded NUMBER that was never ungrounded", () => {
  it("grounds a season year the fact sheet names, which is how 'back in 2024' was failing", () => {
    expect(slotResult("Back in 2024 he was barely playing, and the last year turned that around.").ok).toBe(true);
  });

  it("grounds the rounded form of a ledger value: 2.6 from a ledgered 2.55, 7.9 from 7.94", () => {
    expect(slotResult("He went from 2.6 a game to 7.9 a game, which is the whole story here.").ok).toBe(true);
  });

  it("grounds a subtraction of two supplied facts: our number over the replacement level", () => {
    // 248 projected, 228 replacement level, so "20 points clear" is arithmetic the page itself
    // performs, not a number the model invented.
    expect(slotResult("He is 20 points clear of the man you would otherwise be starting.").ok).toBe(true);
  });

  it("grounds every percent form of a ledgered share", () => {
    const facts = buildPlayerFacts(
      baseInput({
        usage: {
          season: 2025,
          snapShare: null,
          snapShareRank: null,
          targetShare: 0.2476,
          targetShareRank: null,
          redZoneShare: null,
          redZoneShareRank: null,
        },
      }),
    );
    for (const written of ["24.8%", "25%", "24.76%"]) {
      expect(slotResult(`He took ${written} of that team's targets last season, which leads the backfield.`, facts).ok).toBe(true);
    }
  });

  /**
   * A LARGE TOTAL STATED TO THE HUNDRED (written rate round, 2026-09-08). "1400-plus yards" against
   * a ledgered 1429 was the one rejection of eleven in a 40-player dev run that was a rounding the
   * tolerance missed: a person states a yardage total to the hundred, down ("1400-plus") or to the
   * nearest. Bounded to entries of a thousand or more, so a small number never gets a loose reading.
   */
  it("grounds a four-figure total stated to the hundred, down or nearest, and nothing smaller", () => {
    const totals = { carries: 12, rushingYards: 143, targets: 114, receptions: 78, receivingYards: 1429, passingYards: 0, touchdowns: 8, fantasyPoints: 245.9 };
    const facts = buildPlayerFacts(baseInput({ season: { season: 2026, gamesPlayed: 13, pointsPerGame: 18.9, totals } }));
    expect(slotResult("He put up 1400-plus receiving yards last year and the role has not changed.", facts).ok).toBe(true);
    expect(slotResult("He put up 1,400 receiving yards last year and the role has not changed.", facts).ok).toBe(true);
    expect(slotResult("He put up 1500 receiving yards last year and the role has not changed.", facts).ok).toBe(false);
    // 143 rush yards is never "100 rush yards": the loose reading is for four figures only.
    expect(slotResult("He added 100 rush yards on the ground, which is the whole story.", facts).ok).toBe(false);
  });

  /**
   * THE DERIVATIONS THE SECOND DEV RUN SHOWED (written rate round, 2026-09-08), on the ledger by
   * construction the way the replacement-level gap already is: a per-game rate times a games figure
   * the sheet prints ("21.7 a game over a 13-game season clears 282"), the sum of two law effects
   * ("worth a combined 5.6 a game"), a difference between two headline points figures, and a season
   * total as the sum of its listed parts. Each is arithmetic on two printed facts, never a third
   * quantity out of one.
   */
  describe("derived by construction from two printed facts", () => {
    // 258.1, not 264.3: 20.3 a game times the 13 games played is 263.9, and a season total that
    // rounds to the same 264 would ground the cross-season product below as a printed fact.
    const totals = { carries: 215, rushingYards: 1081, targets: 70, receptions: 56, receivingYards: 602, passingYards: 0, touchdowns: 7, fantasyPoints: 258.1 };
    const law = (id: string, effect: number) => ({
      id,
      position: "RB" as const,
      claim: "A claim.",
      measured: { effect, ci: [effect - 0.5, effect + 0.5] as [number, number], sample: 120, seasons: "2018-2024" },
      trainEffect: effect,
      verdict: "confirmed" as const,
      modelPath: null,
      hasFoldEvidence: true,
      origin: "tribal" as const,
      primaryQuantityId: null,
      primaryQuantityNoun: null,
      primaryQuantityUnit: null,
    });
    const facts = buildPlayerFacts(
      baseInput({
        season: { season: 2026, gamesPlayed: 13, pointsPerGame: 20.3, totals },
        reasons: [
          { code: "availability", expectedGames: 16, floorGames: 12, ceilingGames: 17 },
          { code: "law", lawId: "snap_share", effect: 2.9, magnitude: 78 },
          { code: "law", lawId: "air_yards", effect: 2.7, magnitude: 36 },
          { code: "law", lawId: "age", effect: 2.1, magnitude: 22 },
        ],
        laws: [law("snap_share", 2.9), law("air_yards", 2.7), law("age", 2.1)],
      }),
    );

    /**
     * SAME-SEASON PAIRINGS ONLY (fix round, 2026-09-08, HIGH): this season's rate times this
     * season's expected games, last season's rate times last season's games played. A rate times
     * a full season, a tail of the games range, or the other season's games is coincidence space,
     * and the raw product is pushed once (the validator already reads it at three roundings).
     */
    it("grounds this season's per-game rate times this season's expected games", () => {
      // 20.3 a game times the 16 games expected is 324.8.
      expect(slotResult("At 20.3 a game, the 16 games we expect come to 325 points, and that is the case.", facts).ok).toBe(true);
    });

    it("no longer grounds a cross-season product, a rate times a tail of the games range, or the product stated to the ten", () => {
      // 20.3 times the 13 games played (263.9), times the 12-game low (243.6), and 324.8 to the ten.
      expect(slotResult("At 20.3 a game, a 13-game season is 264 points, and that is the whole case.", facts).ok).toBe(false);
      expect(slotResult("At 20.3 a game, even the 12-game low is 244 points, and that is the whole case.", facts).ok).toBe(false);
      expect(slotResult("At 20.3 a game a 16-game season is roughly 320 points, and that is the whole case.", facts).ok).toBe(false);
    });

    it("grounds the total of all the law effects, never a pairwise sum", () => {
      expect(slotResult("The three factors are worth a combined 7.7 a game to our number, and that is the case.", facts).ok).toBe(true);
      expect(slotResult("The snap share and the air yards are worth a combined 5.6 a game to our number.", facts).ok).toBe(false);
    });

    it("grounds a difference between two headline points figures", () => {
      // 248 projected against a 228 replacement level was already grounded; 275 ceiling minus 248 is new.
      expect(slotResult("The ceiling sits 27 points above our number, which is the whole upside case.", facts).ok).toBe(true);
    });

    it("grounds a season total as the sum of its listed parts", () => {
      // 1081 rush plus 602 receiving is 1683 total yards; 215 carries plus 56 catches is 271 touches.
      expect(slotResult("That is 1683 yards from scrimmage on 271 touches, and the split is the point.", facts).ok).toBe(true);
    });

    it("still fails a number that is arithmetic on nothing the sheet prints", () => {
      expect(slotResult("He is a 300-touch back and the legs are the story.", facts).ok).toBe(false);
    });
  });

  /**
   * A THREE-FIGURE TOTAL STATED TO THE TEN (written rate round, 2026-09-08): "360-point seasons"
   * from a ledgered 362.9, "clears 280" from a derived 282.1, "near 300" from 302.4. The same
   * reading the hundred rule gives four figures, one order down, and nothing under a hundred.
   */
  it("grounds a three-figure entry stated to the ten, down or nearest, and nothing under a hundred", () => {
    const facts = buildPlayerFacts(baseInput({ projection: { projectedPoints: 362.9, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 } }));
    expect(slotResult("A 360-point season is what our number has him at, and that is the pick.", facts).ok).toBe(true);
    expect(slotResult("A 370-point season is a stretch but our number is not far off it.", facts).ok).toBe(false);
    // 12.5 ADP is never "pick 10": the loose reading starts at a hundred.
    expect(slotResult("Drafters are taking him around pick 10, which is a round too early.", facts).ok).toBe(false);
  });

  /** "Twenty-eight is the front edge of receiver decline" was read as the number 20 (written rate
   *  round, 2026-09-08): a compound cardinal is one number, never its first word. */
  it("reads a compound cardinal as one number, and grounds it against the sheet", () => {
    const facts = buildPlayerFacts(baseInput({ market: { adp: 12.5, positionAdp: "RB6", boardRank: 28 } }));
    expect(slotResult("Twenty-eight overall on our board is where he sits, and that is fair.", facts).ok).toBe(true);
    const wrong = slotResult("Thirty-one overall on our board is where he sits, and that is fair.", facts);
    expect(wrong.ok).toBe(false);
    expect(wrong.violations[0]).toContain("Thirty-one");
  });

  it("still fails a number that traces to nothing at all", () => {
    const result = slotResult("He caught 137 passes last season and nobody could cover him.");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("137");
  });

  it("still fails a number near a ledger value but past any honest rounding of it", () => {
    // 2.55 rounds to 2.6 and to 3, never to 3.4.
    const result = slotResult("He averaged 3.4 a game that year, which is the number to hang on to.");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("3.4");
  });
});

describe("cause 2: the word band is graded first, and alone", () => {
  it("returns the band violation by itself, so the retry can be a length correction", () => {
    const tooShort = "He is a buy at this price and nothing else needs saying about him today.";
    const result = validateCapsule(tooShort, FACTS, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("outside the required");
    expect(result.bandFailure).toEqual({ words: 15, minWords: 75, maxWords: 120 });
  });

  it("does not report a grounding failure on a text it has already refused for its length", () => {
    // The same too-short text with a fabricated number in it: the length is the only thing said,
    // because the corrected text is what will actually be graded for grounding.
    const result = validateCapsule("He caught 137 passes and that is that.", FACTS, "compact");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("outside the required");
  });

  it("reports no band failure once the length is right", () => {
    const result = validateCapsule("He caught 137 passes and that is that.", FACTS, "compact");
    expect(result.bandFailure).not.toBeNull();
    expect(slotResult("He is a buy at this price, and the market has not caught up yet.").bandFailure).toBeNull();
  });

  it("still fails a call of thirty-one words", () => {
    const thirtyOne = Array.from({ length: 31 }, (_, index) => (index === 0 ? "He" : "runs")).join(" ");
    const result = validateNarrativeSlot(thirtyOne, groundingOf(FACTS), NARRATIVE_WORD_CAPS.call);
    expect(result.ok).toBe(false);
    expect(result.bandFailure).toEqual({ words: 31, minWords: 3, maxWords: 30 });
  });
});

describe("cause 3: name false positives", () => {
  it("reads a contraction plus a position code as words, not as the name 'He QB'", () => {
    expect(slotResult("He's QB proof that the ADP and the production have come apart.").ok).toBe(true);
  });

  /** Lane 303 (B306): a pronoun and his designation, and the call's imperative before his surname, are
   *  words, never the people "He Questionable", "His Questionable" or "Keep Long". */
  it("reads a pronoun plus a designation as words, not as the name 'He Questionable'", () => {
    expect(slotResult("He's Questionable for now, and the ADP has not caught up yet.").ok).toBe(true);
    expect(slotResult("His Questionable tag is the only worry, and the ADP has not caught up.").ok).toBe(true);
    expect(slotResult("He's Out this week, so the ADP has nothing to catch up to.").ok).toBe(true);
    expect(slotResult("The ADP has not caught up, and for now He's Doubtful.").ok).toBe(true);
  });

  it("grounds the call's imperative before a ledgered surname, and still fails an unledgered one", () => {
    for (const verb of ["Keep", "Leave", "Bench", "Play"]) {
      expect(slotResult(`${verb} Long in mind, because the ADP has not caught up yet.`).ok).toBe(true);
    }
    expect(slotResult("Keep Fakename in mind, because the ADP has not caught up yet.").ok).toBe(false);
  });

  it("grounds the city of a team the facts name", () => {
    expect(slotResult("New York leans on him every single week, and that is the case for him.").ok).toBe(true);
  });

  it("grounds the nickname and the full name of that team too", () => {
    expect(slotResult("The Giants lean on him, and the New York Giants have nobody else to lean on.").ok).toBe(true);
  });

  it("grounds a possessive of the subject's own name", () => {
    expect(slotResult("Rashad Long's role is the whole case, and the ADP has not caught up.").ok).toBe(true);
  });

  /**
   * THE FIRST PERSON AND A DETERMINER (written rate round, 2026-09-08): "What I", "If I" and
   * "Every Walker" were three of the 40-player dev run's rejections, a sentence-initial word
   * merging into the pronoun "I" or into the subject's own ledgered surname. "I" is never half a
   * name, in any contraction, and "Every" is a determiner like "The".
   */
  it("reads the first-person pronoun as a word, never as half a name, in any contraction", () => {
    expect(slotResult("What I want to see is the early-down work, and the sheet says it is his.").ok).toBe(true);
    expect(slotResult("If I had to pick a back in this range, it is him.").ok).toBe(true);
    expect(slotResult("What I'd need first is a healthy August, and then he is the pick.").ok).toBe(true);
  });

  it("grounds a verb before the surname of a name that ends in a suffix (\"Take Cook\" failed against James Cook III)", () => {
    const facts = buildPlayerFacts(baseInput({ identity: { id: "p2", name: "James Cook III", position: "RB", team: "BUF" } }));
    expect(slotResult("Take Cook at his ADP and never think about it again.", facts).ok).toBe(true);
    // The exit is still gated on the verb: a given name in that slot is a person the sheet never named.
    expect(slotResult("Marcus Cook is the man to take, and never think about it again.", facts).ok).toBe(false);
  });

  it("reads a plural position code as a word, never as half a name (\"Past WRs\" failed as a person)", () => {
    expect(slotResult("Past WRs drafted around his pick have busted often, and the sheet says so.").ok).toBe(true);
    expect(slotResult("Most RBs in this range are committee backs, and he is not.").ok).toBe(true);
  });

  it("grounds a sentence-initial determiner before the subject's own surname", () => {
    expect(slotResult("Every Long season has started the same way, and this year should too.").ok).toBe(true);
  });

  it("still fails a fabricated two-word name", () => {
    const result = slotResult("Justin Herbert throws him the ball on every third down these days.");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("Justin Herbert");
  });

  it("still fails another team's city, which the facts never named", () => {
    const result = slotResult("Kansas City would give plenty for a back with this kind of role.");
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toContain("Kansas City");
  });
});

describe("cause 4: the mixed-evidence violation reads like a number a person wrote", () => {
  it("states the downside to one decimal, never as a raw float", () => {
    const facts = buildPlayerFacts(
      // Above the one-point line the mandate starts at (production follow-up, 2026-09-08); the
      // test is about the decimals, not the threshold.
      baseInput({ reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.9372183908045988, magnitude: 29 }] }),
    );
    const filler = Array.from({ length: 45 }, () => "plainly").join(" ");
    const body = validateCapsule(
      `Rashad Long is our number at 248 season points with a range from 178 to 275, and board rank 14 overall says the same about him, so the case is a plain one this season. ${filler}.`,
      facts,
      "compact",
    );
    expect(body.bandFailure).toBeNull();
    const tension = body.violations.find((violation) => violation.startsWith("Mixed evidence"));
    expect(tension).toContain("-1.9 pts/game");
    expect(tension).not.toContain("1.9372183908045988");
  });
});

/**
 * THE SECOND LIVE MEASUREMENT (2026-09-07, 100 players on dev: 42 written, $0.26). Its own
 * rejections, most common first: 125 ungrounded numbers, 71 unframed floor claims, 69 word bands,
 * 16 throttles, 8 ungrounded names, 7 uncited downsides. One fixture per cause.
 */
describe("grounded by construction: what the prompt shows is quotable", () => {
  const facts = buildPlayerFacts(
    baseInput({
      usage: {
        season: 2025,
        snapShare: 0.345,
        snapShareRank: { value: 0.345, positionRank: 8, qualifierCount: 41, namedNeighbor: null },
        targetShare: null,
        targetShareRank: null,
        redZoneShare: null,
        redZoneShareRank: null,
      },
    }),
  );

  it("grounds a percentage in exactly the form the fact sheet prints it", () => {
    // The live rejection was: The number "34.5%" does not trace to any supplied fact.
    expect(renderFactsForModel(facts)).toContain("34.5%");
    expect(slotResult("He was on the field for 34.5% of the snaps, which is the whole case here.", facts).ok).toBe(true);
  });

  it("grounds every number the fact sheet renders, whatever form it renders it in", () => {
    // The strongest possible statement of the rule, asserted against the sheet itself: nothing the
    // model can read back at us is a fabrication.
    const printed = renderFactsForModel(facts).match(/\d+(?:\.\d+)?/g) ?? [];
    expect(printed.length).toBeGreaterThan(5);
    for (const number of printed) {
      expect(slotResult(`The sheet says ${number} and that is what it says about him.`, facts).ok).toBe(true);
    }
  });

  it("still fails a number the prompt never showed and no rounding reaches", () => {
    const result = slotResult("He was on the field for 61.2% of the snaps last season, every week.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("61.2");
  });
});

describe("the injury designation is a word, not a person", () => {
  const facts = buildPlayerFacts(baseInput({ injury: { state: "designated", designation: "Q", asOf: "2026-09-01T00:00:00.000Z" } }));

  it("reads 'The Q' as the report code the sheet printed", () => {
    // The live rejection was: The name "The Q" does not trace to any supplied fact.
    expect(slotResult("The Q next to his name is the only thing standing between him and a start.", facts).ok).toBe(true);
  });

  it("still fails a real fabricated name in the same sentence shape", () => {
    expect(slotResult("The Marcus Long next to his name is the only thing standing there.", facts).ok).toBe(false);
  });
});

/**
 * THE TRADING REGISTER IS BANNED (founder ruling, 2026-09-07: "we say market everywhere like this
 * is a stock trading app, it's a fantasy football app"). The fact sheet now states an ADP as the
 * pick drafters take him around, and the rounded pick grounds by construction: the sheet prints
 * it, and it is a plain rounding of the ADP on the ledger either way.
 */
describe("the trading register is banned, the drafting register grounds", () => {
  const facts = buildPlayerFacts(baseInput({ market: { adp: 99.7, positionAdp: "RB34", boardRank: 90 } }));

  it("rejects a sentence that talks about the market", () => {
    const result = slotResult("The market has him at 99.7 and that is too low for this role.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('banned term "market"');
  });

  it("rejects every trading word the ruling named, in the inflections a writer reaches for", () => {
    for (const sentence of [
      "He is priced like a backup and plays like a starter.",
      "Buy him everywhere you can this August.",
      "I am selling at this ADP, the role is not there.",
      "Fade him until the depth chart settles.",
      "He trades at a discount to his role.",
      "You are paying a premium for last year.",
      "The return on a pick this early is thin.",
      "He is undervalued by a round.",
    ]) {
      expect({ sentence, ok: slotResult(sentence, facts).ok }).toEqual({ sentence, ok: false });
    }
  });

  it("passes the drafting words with the rounded pick, which the sheet itself prints", () => {
    expect(renderFactsForModel(facts)).toContain("ADP 99.7 (drafters take him around pick 100, RB34 by ADP)");
    expect(slotResult("Drafters take him around pick 100, and that is a round later than his role says.", facts).ok).toBe(true);
    expect(slotResult("Let him fall to the ninth and he is a steal there.", facts).ok).toBe(true);
  });

  it("leaves the words that only look like trading words alone", () => {
    // "Russell" carries "sell"; "upside" tied to an outcome is allowed; "fading" as a role verb
    // is not, and that is the price of a whole-word rule with inflections.
    expect(slotResult("Russell throws him the ball and the upside is a strong season.", buildPlayerFacts(baseInput({ identity: { id: "p1", name: "Russell Long", position: "RB", team: "NYG" } }))).ok).toBe(true);
  });
});

describe("the soft rules are corrected before they are refused", () => {
  it("hands the floor rule back as a correction that says what to fix, never a clause to paste", () => {
    const correction = softCorrectionFor(UNFRAMED_FLOOR_VIOLATION);
    expect(correction).toContain('"floor"');
    expect(correction).toContain("injury");
    expect(correction).toContain("in your own words");
    expect(correction).not.toContain("not a talent read");
    expect(correction).not.toContain("games missed, not talent");
  });

  it("hands the uncited downside back with the number it wants stated", () => {
    const correction = softCorrectionFor("Mixed evidence: the strongest downside (-1.8 pts/game) is never cited. It has to appear, with that number, before the call.");
    expect(correction).toContain("-1.8 pts/game");
    expect(correction).toContain("in your own words");
    expect(correction).not.toContain("honest hesitation");
  });

  it("does not soften a fabrication: an ungrounded number has no correction at all", () => {
    expect(softCorrectionFor('The number "137" does not trace to any supplied fact.')).toBeNull();
    expect(softCorrectionFor('The name "Justin Herbert" does not trace to any supplied fact.')).toBeNull();
  });

  it("still fails the floor claim itself, so the correction has something to correct", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = slotResult("His floor is 178 and that is the number to plan a season around.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(UNFRAMED_FLOOR_VIOLATION);
  });
});

/**
 * THE DEPTH SECTION IS GROUNDED TOO (fact-sheet depth merge, 2026-09-07). The sheet grew by about
 * sixty percent, and the rule this round turned on is "what the prompt shows is quotable". That
 * rule is only as good as the ledger behind the new lines, so this asserts the property directly
 * rather than trusting the merge: every number the depth section PRINTS is a number the depth
 * LEDGER carries, and every number the whole sheet prints grounds through the validator.
 */
describe("the depth section, grounded", () => {
  /** One typed depth, group by group over the honest empty one. Typed rather than cast (fix
   *  round): a double cast would have let a group's shape drift out from under this test, which is
   *  precisely the drift the test exists to catch now that the sheet has a second author. */
  function depthWith(groups: Partial<PlayerFactsDepth>): PlayerFactsDepth {
    return { ...EMPTY_DEPTH, ...groups };
  }

  const facts = buildPlayerFacts({
    ...baseInput(),
    depth: depthWith({
      // Only the groups that carry NUMBERS need to be here: a group with no number cannot break a
      // number rule, and every group's own rendering is pinned by `render-depth.test.ts`.
      gamesMissed: [{ season: 2025, teamGames: 17, gamesPlayed: 14, firstPlayedWeek: 1, unavailableWeeks: [4, 5, 9], suspendedWeeks: [], healthyDidNotPlay: 0 }],
      priorSeasons: [{ season: 2024, points: 289.6, gamesPlayed: 16, positionRank: 3, qualifierCount: 48 }],
    }),
  });

  it("prints no number the depth ledger does not carry", () => {
    const section = renderDepthSection(facts);
    if (section === null) return;
    const printed = (section.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const ledgered = new Set(depthNumbers(facts.depth).map((value) => Number(value)));
    for (const value of printed) {
      // Either the exact figure, or a figure the section rounded for readability, which the
      // validator's own rounding tolerance then accepts.
      const grounded = ledgered.has(value) || [...ledgered].some((entry) => Math.abs(entry - value) <= 0.5);
      expect({ value, grounded }).toEqual({ value, grounded: true });
    }
  });

  it("still grounds every number the whole rendered sheet shows, depth included", () => {
    for (const number of renderFactsForModel(facts).match(/\d+(?:\.\d+)?/g) ?? []) {
      expect(slotResult(`The sheet says ${number} and that is what it says about him.`, facts).ok).toBe(true);
    }
  });
});

/**
 * THE BAND'S OWN EDGES (fix round) — the bands were set from a measured distribution, so the one
 * thing a test must pin is that the numbers in `config.ts` ARE the numbers enforced, at the exact
 * word where each side turns over. Asserted against the constants rather than against literals, so
 * a future re-measure moves the band and these tests follow it.
 */
describe("the word bands are exactly the configured ones", () => {
  const facts = buildPlayerFacts(baseInput());

  /** `count` words with no digit and no capitalised token, so only the LENGTH is under test. */
  function words(count: number): string {
    return Array.from({ length: count }, (_, index) => (index === 0 ? "he" : "runs")).join(" ");
  }

  for (const size of ["compact", "full"] as const) {
    const { minWords, maxWords } = CAPSULE_CONFIG.sizes[size];

    it(`${size}: ${minWords - 1} words fails and ${minWords} passes`, () => {
      expect(validateCapsule(words(minWords - 1), facts, size).bandFailure).toEqual({ words: minWords - 1, minWords, maxWords });
      expect(validateCapsule(words(minWords), facts, size).bandFailure).toBeNull();
    });

    it(`${size}: ${maxWords} words passes and ${maxWords + 1} fails`, () => {
      expect(validateCapsule(words(maxWords), facts, size).bandFailure).toBeNull();
      expect(validateCapsule(words(maxWords + 1), facts, size).bandFailure).toEqual({ words: maxWords + 1, minWords, maxWords });
    });
  }

  it("holds the bands the acceptance round measured", () => {
    // Stated once, so a change to the constants is a deliberate act with a failing test beside it.
    expect(CAPSULE_CONFIG.sizes.compact).toMatchObject({ minWords: 75, maxWords: 120 });
    expect(CAPSULE_CONFIG.sizes.full).toMatchObject({ minWords: 240, maxWords: 300 });
  });
});

/**
 * THE NARROWED FLOOR RULE (fix round) — the founder's ruling is about a bare "floor of 91", a p10
 * restated as a talent claim. Two narrowings were measured into this rule and both need pinning:
 * a floor with no FIGURE beside it is an ordinary thing an analyst says, and the availability
 * language that satisfies the rule is the widened list rather than the original four phrasings.
 */
describe("the floor rule, narrowed", () => {
  const facts = buildPlayerFacts(baseInput());

  it("lets a floor with no number through, availability language or not", () => {
    const result = slotResult("He has a high floor and the role behind it is not going anywhere.", facts);
    expect(result.ok).toBe(true);
  });

  it("still refuses a floor with a number and no availability language", () => {
    const result = slotResult("His floor is 178 points and that is the number to plan a season around.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(UNFRAMED_FLOOR_VIOLATION);
  });

  it("accepts a floor with a number once availability is anywhere in the text", () => {
    for (const framing of [
      "the durability is the only question",
      "he was sidelined twice last year",
      "the games he misses are the whole risk",
    ]) {
      const result = slotResult(`His floor is 178 points, and ${framing} behind that number.`, facts);
      expect({ framing, ok: result.ok }).toEqual({ framing, ok: true });
    }
  });
});
