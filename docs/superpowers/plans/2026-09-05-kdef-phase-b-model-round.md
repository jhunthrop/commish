# Kicker and Team Defense, Phase B — The Model Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kicker's and a team defense's season is composed through the league's own scoring from measured per-game components fit on 2013 through 2024, and 2025 is judged exactly once against four preregistered gates whose result decides, per position, whether the position ships as projected rows or in market order.

**Architecture:** Two pure composition modules (`kicker.ts`, `team-defense.ts`) under `src/projections/preseason/`, each with a shrinkage component fit, a candidate builder that produces a `BoardCandidate`, and a committed fitted-priors file. They deliberately do not extend the skill positions' opportunity/efficiency/availability machinery: a kicker has no target share and a defense is not a person, and leaving that machinery untouched is also the strongest available guarantee for gate G4. One new field on `BoardCandidate` carries the expected points-allowed and yards-allowed tier points, because the tier tables are nonlinear step functions and the expectation of a step function is not the step function of the expectation.

**Tech Stack:** TypeScript strict, Drizzle/Postgres reads only (no new tables), vitest, the existing `computeFantasyPoints`, `seasonPointsBand` and `preseasonBoard`.

**Spec:** `docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md` §5 Phase B, §6, §8. Depends on Phase A (`2026-09-05-kdef-phase-a-data-identity.md`) being merged and the backfill run.

## Global Constraints

- **Held-out discipline is absolute.** Every fit in this plan reads 2013 through 2024 only and THROWS if handed a later season, the same way `fitGameVariance` and `fitAvailabilityPriors` already do. 2025 is read exactly once, by the judgment script, after the preregistration document is committed. 2026 is never read by any fit or judgment in this plan.
- **The preregistration document is committed BEFORE the judgment run.** Its gates are copied verbatim from the spec. The judgment run's own output is committed verbatim as the results document, pass or fail.
- **While developing, hold 2024 out too.** Any iteration on the model is measured on 2024 with a 2013 through 2023 fit, and every iteration is recorded in the ledger before the single 2025 run.
- Honest data is absolute. Never synthesize a stat, a score or an outcome. A component with no observations produces the league mean and says so, never a fabricated zero.
- No change to any QB, RB, WR or TE number. Gate G4 is a byte-identical comparison of the four skill positions' rows of the 2025 board before and after; the two board changes in this plan (`scaleStatLine`'s present-only optional fields, `BoardCandidate.perGameTierPoints`) are both no-ops when the field is absent, and every skill candidate's line carries only `STAT_FIELDS` (`composeStatLine`, `src/projections/model/compose.ts`).
- No em-dashes, no semicolons, no competitor names and no tips in any user-facing string. The research documents and script output are operator-facing.
- Functions under 50 lines, files under 800 lines, immutability, explicit errors, no `any`.
- Gates after every task: `npx tsc --noEmit -p .`, `npx eslint <touched dirs>`, `npx vitest run <touched dirs>`.
- Commit messages carry a conventional type prefix and end with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS`.

## Plan-level rulings

- **R-1: K and DEF do NOT join `FITTED_POSITIONS` in `src/projections/preseason/fit.ts`.** The spec's Phase C bullet names it, and the honest implementation refuses. That table is the availability fit, whose label is `gamesPlayedBySeason` off `player_week_observations` and whose features are the projected snap share and the role bracket. `player_week_observations` has never held a kicker row and can never hold a team-defense row, so adding either position there would fit a cell against a label that is structurally zero, and neither feature exists for either position. Expected games for both is estimated inside this plan's own modules, from the tables Phase A ingested. Cost if wrong: the two positions' games estimates do not share the beta-binomial shape the skill positions use, so a later round that wants one prior for all six has a merge to do.
- **R-2: `VARIANCE_POSITIONS` gains K and DEF, and `fitGameVariance` gains an explicit `positions` option.** The band needs a per-game variance for both positions or it understates the two most volatile positions in the game, which is exactly what the spec calls out. `fitGameVariance`'s own observation loader reads `player_week_observations` and would emit a fabricated 0 for a K or DEF cell; the `positions` option (defaulting to the four skill positions) keeps it from ever writing a cell it has no observations for, and this plan's own fit writes the two new cells. Cost if wrong: a K or DEF band that is too wide or too narrow, which gate G3 measures directly.
- **R-3: the expected tier points ride on the candidate, not inside the stat line.** `pointsAllowed` and `yardsAllowed` are not in `STAT_FIELDS`, so `scaleStatLine` does not scale them, and scaling them would be wrong anyway: seventeen games of points allowed run through a step table designed for one game is meaningless. Putting the already-averaged per-game tier points on the candidate is the only composition that computes the mean of the tier function rather than the tier of the mean, which is what the spec requires. Cost if wrong: nothing downstream, the field is absent for every other position.
- **R-4: `scaleStatLine` scales the optional scored fields that are PRESENT.** A kicker's misses and a defense's fumble recoveries and safeties are scored fields that are not in `STAT_FIELDS`, so a season line built today drops them. Scaling only what is present leaves every skill candidate byte-identical, because `composeStatLine` emits `STAT_FIELDS` and nothing else. Cost if wrong: G4 catches it in the same run.

## File map

- Create: `docs/research/2026-09-05-kicker-defense-preregistration.md`
- Create: `src/projections/preseason/kicker.ts` (+ test) — kicker observations, component fit, candidate builder
- Create: `src/projections/preseason/team-defense.ts` (+ test) — defense observations, component fit, tier expectation, candidate builder
- Create: `src/projections/preseason/kdef-fitted.ts` — the committed fitted priors
- Create: `src/projections/preseason/kdef-scorecard.ts` (+ test) — the four gates as pure functions
- Create: `scripts/kdef-fit.ts` — fits on 2013-2024 (or a dev window) and prints the priors file
- Create: `scripts/kdef-judgment.ts` — the single judgment run
- Create: `docs/research/2026-09-05-kicker-defense-preregistration-results.md` (the judgment's verbatim output)
- Modify: `src/projections/preseason/board.ts` — `scaleStatLine` present-only optionals, `BoardCandidate.perGameTierPoints`
- Modify: `src/projections/preseason/game-variance.ts` — `VARIANCE_POSITIONS`, `fitGameVariance` positions option
- Modify: `src/projections/preseason/game-variance-fitted.ts` — the two new cells
- Modify: `package.json` — `projections:kdef:fit`, `projections:kdef:judgment`

---

### Task 1: The board can carry a nonlinear component and can scale an optional scored field

**Files:**
- Modify: `src/projections/preseason/board.ts`
- Modify: `src/projections/preseason/board.test.ts`

**Interfaces:**
- Produces: `BoardCandidate.perGameTierPoints?: number`; `scaleStatLine` scales the optional scored fields it finds present.

- [ ] **Step 1: Write the failing test**

Append to `src/projections/preseason/board.test.ts`:

```typescript
describe("the nonlinear component and the optional scored fields", () => {
  it("leaves an absent optional field absent when a line is scaled", () => {
    const line = scaleStatLine(emptyLine("p1"), 17);
    expect(line.fieldGoalsMissed).toBeUndefined();
    expect(line.safeties).toBeUndefined();
    expect(line.pointsAllowed).toBeUndefined();
  });

  it("scales an optional scored field that is present", () => {
    const line = scaleStatLine(
      { ...emptyLine("p1"), fieldGoalsMissed: 0.4, extraPointsMissed: 0.1, defensiveFumblesRecovered: 0.6, safeties: 0.05 },
      10,
    );
    expect(line.fieldGoalsMissed).toBeCloseTo(4, 10);
    expect(line.extraPointsMissed).toBeCloseTo(1, 10);
    expect(line.defensiveFumblesRecovered).toBeCloseTo(6, 10);
    expect(line.safeties).toBeCloseTo(0.5, 10);
  });

  it("never scales points or yards allowed, which are not linear in games", () => {
    const line = scaleStatLine({ ...emptyLine("p1"), pointsAllowed: 21, yardsAllowed: 330 }, 17);
    expect(line.pointsAllowed).toBe(21);
    expect(line.yardsAllowed).toBe(330);
  });

  it("adds a candidate's per-game tier points to both its per-game and its season total", () => {
    const [entry] = preseasonBoard(
      [{
        playerId: "DST-SF",
        position: "DEF",
        team: "SF",
        perGame: { ...emptyLine("DST-SF"), sacks: 3 },
        perGameTierPoints: 2.5,
        games: outlookOf(17),
        reasons: [],
      }],
      { season: 2025, asOf: new Date(0), rules: PPR_SCORING, shape: SHAPE_WITH_DEF },
    );
    // 3 sacks x 1 point + 2.5 tier points = 5.5 a game, seventeen games.
    expect(entry?.projectedPoints).toBeCloseTo(5.5 * 17, 6);
  });

  it("is byte-identical for a candidate with no per-game tier points", () => {
    const candidate = {
      playerId: "p1", position: "WR" as const, team: "SF",
      perGame: { ...emptyLine("p1"), receivingYards: 60, receptions: 5 },
      games: outlookOf(17), reasons: [],
    };
    const withField = preseasonBoard([{ ...candidate, perGameTierPoints: undefined }], BOARD_OPTIONS);
    const without = preseasonBoard([candidate], BOARD_OPTIONS);
    expect(withField).toEqual(without);
  });
});
```

`emptyLine`, `outlookOf`, `SHAPE_WITH_DEF` and `BOARD_OPTIONS` are local helpers in the existing
test file; add whichever of them the file does not already have, built from `STAT_FIELDS` and a
degenerate `GamesPlayedOutlook` (`{ expected: n, rate: 1, distribution: { floor: n, median: n,
ceiling: n }, probabilities: [...zeros, 1] }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/board.test.ts`
Expected: FAIL, `perGameTierPoints` is not a known property and the optional fields are not scaled.

- [ ] **Step 3: Change `src/projections/preseason/board.ts`**

Add above `scaleStatLine`:

```typescript
/**
 * THE SCORED FIELDS THAT ARE NOT IN `STAT_FIELDS`, and scale linearly anyway.
 *
 * `STAT_FIELDS` is the canonical list two OTHER readers walk (the per-tick digest and the provider
 * contract suite, see `domain/player.ts`), and widening it would make every stats provider owe
 * numbers it may not have. But `computeFantasyPoints` scores all of these, and a kicker's misses and
 * a defense's fumble recoveries and safeties are per-game quantities that multiply by games exactly
 * the way a reception does. Left out, a kicker's season line would carry his makes and not his
 * misses, and a defense would forfeit every takeaway that was not an interception.
 *
 * SCALED ONLY WHERE PRESENT, which is what makes this change invisible to every existing board row:
 * `composeStatLine` (`model/compose.ts`) emits `STAT_FIELDS` and nothing else, so every QB, RB, WR
 * and TE candidate carries `undefined` for all of these, and `undefined` stays `undefined`.
 *
 * `pointsAllowed` and `yardsAllowed` are DELIBERATELY ABSENT from this list. They are scored through
 * nonlinear tier tables, so seventeen games of points allowed is not a quantity the tables can read.
 * A defense's expected tier points ride on `BoardCandidate.perGameTierPoints` instead.
 */
const SCALED_OPTIONAL_FIELDS = [
  "twoPointConversions",
  "fieldGoalsMissed",
  "extraPointsMissed",
  "kickReturnTouchdowns",
  "puntReturnTouchdowns",
  "defensiveFumblesRecovered",
  "safeties",
] as const satisfies readonly (keyof StatLine)[];
```

Change `scaleStatLine`'s body to append the present optionals:

```typescript
export function scaleStatLine(line: StatLine, games: number): StatLine {
  if (!(games >= 0) || !Number.isFinite(games)) {
    throw new Error(`A season line is a per-game line times a finite number of games; got ${games}.`);
  }
  const optional = Object.fromEntries(
    SCALED_OPTIONAL_FIELDS.flatMap((field) => {
      const value = line[field];
      return value === undefined ? [] : [[field, value * games] as const];
    }),
  );
  return {
    ...line,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, line[field] * games])) as Omit<StatLine, "playerId" | "week">),
    ...optional,
  };
}
```

Add the field to `BoardCandidate`:

```typescript
  /**
   * THE NONLINEAR PART OF A TEAM DEFENSE'S SCORE, already averaged, in points per game.
   *
   * Points allowed and yards allowed are scored through step tables (`scoring/compute.ts`'s
   * `POINTS_ALLOWED_TIERS` and `YARDS_ALLOWED_TIERS`), and the expectation of a step function is not
   * the step function of the expectation: a defense that allows 13 one week and 27 the next averages
   * 20 and scores 1 point on the average, while the two real weeks score 3 and 0 for an average of
   * 1.5. So `team-defense.ts` averages the tier function over the team's own shrunk per-game
   * distribution and hands the result here, and its `perGame` line carries NO `pointsAllowed` or
   * `yardsAllowed` at all — which `computeFantasyPoints` already reads, correctly, as "not recorded".
   *
   * ABSENT for every other position and for every skill candidate, which is why adding it changed no
   * existing board row. `perGamePoints` and `projectedPoints` both add it (times games, for the
   * season figure) and both are unchanged when it is absent.
   */
  readonly perGameTierPoints?: number;
```

And in `preseasonBoard`, inside the candidate loop:

```typescript
    const tierPoints = candidate.perGameTierPoints ?? 0;
    const seasonLine = scaleStatLine(candidate.perGame, candidate.games.expected);
    const perGamePoints = computeFantasyPoints(candidate.perGame, candidate.position, rules) + tierPoints;
    const projectedPoints = computeFantasyPoints(seasonLine, candidate.position, rules) + tierPoints * candidate.games.expected;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/preseason/board.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/preseason`,
`npx vitest run src/projections`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/preseason/board.ts src/projections/preseason/board.test.ts
git commit -m "$(cat <<'EOF'
feat(projections): the board can carry a nonlinear per-game component

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 2: The kicker model

**Files:**
- Create: `src/projections/preseason/kicker.ts`
- Test: `src/projections/preseason/kicker.test.ts`

**Interfaces:**
- Consumes: `KickingWeekRow`, `kickingWeekRowsForSeasons` (`../nflverse/kicking-weeks`); `productTeamCode` (`../nflverse/team-codes`); `finalWeekOf` (`../nflverse/team-eras`); `BoardCandidate` (`./board`); `StatLine`, `STAT_FIELDS` (`@/domain/player`); `GamesPlayedOutlook` (`./availability`).
- Produces:

```typescript
export interface KickerSeason {
  readonly season: number; readonly playerId: string; readonly team: string;
  readonly games: number; readonly teamGames: number;
  readonly fieldGoalsAttempted: number; readonly fieldGoalsMade: number;
  readonly extraPointsAttempted: number; readonly extraPointsMade: number;
}
export function kickerSeasonsFrom(rows: readonly KickingWeekRow[]): readonly KickerSeason[];
export interface KickerPriors {
  readonly leagueFieldGoalAttemptsPerGame: number;
  readonly leagueExtraPointAttemptsPerGame: number;
  readonly leagueFieldGoalMakeRate: number;
  readonly leagueExtraPointMakeRate: number;
  readonly leagueGamesRate: number;
  readonly teamPriorGames: number;
  readonly kickerPriorFieldGoalAttempts: number;
  readonly kickerPriorExtraPointAttempts: number;
  readonly kickerPriorGames: number;
  readonly recencyDecay: number;
}
export interface KickerFitOptions { readonly heldOutSeasons: readonly number[]; readonly recencyDecayGrid?: readonly number[]; }
export function fitKickerPriors(seasons: readonly KickerSeason[], options: KickerFitOptions): KickerPriors;
export interface KickerCandidateInput {
  readonly playerId: string; readonly team: string; readonly season: number;
  readonly ownHistory: readonly KickerSeason[]; readonly teamHistory: readonly KickerSeason[];
}
export function kickerCandidate(input: KickerCandidateInput, priors: KickerPriors): BoardCandidate;
export function kickerWeeklyPoints(rows: readonly KickingWeekRow[], rules: ScoringRules): ReadonlyMap<string, readonly number[]>;
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import type { KickingWeekRow } from "../nflverse/kicking-weeks";
import { fitKickerPriors, kickerCandidate, kickerSeasonsFrom, type KickerSeason } from "./kicker";

function week(overrides: Partial<KickingWeekRow>): KickingWeekRow {
  return {
    season: 2020, week: 1, playerId: "k1", team: "SF",
    fieldGoalsMade: 0, fieldGoalsAttempted: 0, fieldGoalsMissed: 0, fieldGoalsBlocked: 0,
    fieldGoalsMade0To19: 0, fieldGoalsMade20To29: 0, fieldGoalsMade30To39: 0,
    fieldGoalsMade40To49: 0, fieldGoalsMade50To59: 0, fieldGoalsMade60Plus: 0,
    fieldGoalsMissed0To19: 0, fieldGoalsMissed20To29: 0, fieldGoalsMissed30To39: 0,
    fieldGoalsMissed40To49: 0, fieldGoalsMissed50To59: 0, fieldGoalsMissed60Plus: 0,
    extraPointsMade: 0, extraPointsAttempted: 0, extraPointsMissed: 0, extraPointsBlocked: 0,
    ...overrides,
  };
}

function season(overrides: Partial<KickerSeason>): KickerSeason {
  return {
    season: 2020, playerId: "k1", team: "SF", games: 16, teamGames: 16,
    fieldGoalsAttempted: 32, fieldGoalsMade: 28, extraPointsAttempted: 40, extraPointsMade: 39,
    ...overrides,
  };
}

describe("kickerSeasonsFrom", () => {
  it("counts one game per week the kicker has a row and sums his components", () => {
    const seasons = kickerSeasonsFrom([
      week({ week: 1, fieldGoalsAttempted: 3, fieldGoalsMade: 2, extraPointsAttempted: 2, extraPointsMade: 2 }),
      week({ week: 2, fieldGoalsAttempted: 1, fieldGoalsMade: 1, extraPointsAttempted: 4, extraPointsMade: 3 }),
    ]);
    expect(seasons).toEqual([
      {
        season: 2020, playerId: "k1", team: "SF", games: 2, teamGames: 17,
        fieldGoalsAttempted: 4, fieldGoalsMade: 3, extraPointsAttempted: 6, extraPointsMade: 5,
      },
    ]);
  });

  it("attributes the season to the club he kicked the most weeks for", () => {
    const seasons = kickerSeasonsFrom([
      week({ week: 1, team: "SF" }), week({ week: 2, team: "DEN" }), week({ week: 3, team: "DEN" }),
    ]);
    expect(seasons[0]?.team).toBe("DEN");
  });
});

describe("fitKickerPriors", () => {
  const fitSeasons = [
    season({ season: 2013 }), season({ season: 2014 }), season({ season: 2015, playerId: "k2", team: "DEN" }),
  ];

  it("refuses a held-out season rather than filtering it out quietly", () => {
    expect(() => fitKickerPriors([...fitSeasons, season({ season: 2025 })], { heldOutSeasons: [2025] }))
      .toThrow(/2025/);
  });

  it("measures the league means directly off the fit seasons", () => {
    const priors = fitKickerPriors(fitSeasons, { heldOutSeasons: [2025] });
    expect(priors.leagueFieldGoalMakeRate).toBeCloseTo(28 / 32, 10);
    expect(priors.leagueExtraPointMakeRate).toBeCloseTo(39 / 40, 10);
    expect(priors.leagueFieldGoalAttemptsPerGame).toBeCloseTo(2, 10);
    expect(priors.leagueGamesRate).toBeCloseTo(1, 10);
  });

  it("returns a recency decay from its own grid and positive prior counts", () => {
    const priors = fitKickerPriors(fitSeasons, { heldOutSeasons: [2025], recencyDecayGrid: [0.7] });
    expect(priors.recencyDecay).toBe(0.7);
    expect(priors.kickerPriorFieldGoalAttempts).toBeGreaterThan(0);
    expect(priors.teamPriorGames).toBeGreaterThan(0);
  });
});

describe("kickerCandidate", () => {
  const priors = {
    leagueFieldGoalAttemptsPerGame: 2, leagueExtraPointAttemptsPerGame: 2.5,
    leagueFieldGoalMakeRate: 0.85, leagueExtraPointMakeRate: 0.95, leagueGamesRate: 0.95,
    teamPriorGames: 16, kickerPriorFieldGoalAttempts: 30, kickerPriorExtraPointAttempts: 30,
    kickerPriorGames: 16, recencyDecay: 0.8,
  } as const;

  it("gives a kicker with no history the league rates and the team's own opportunity", () => {
    const candidate = kickerCandidate(
      { playerId: "rookie", team: "SF", season: 2025, ownHistory: [], teamHistory: [] },
      priors,
    );
    expect(candidate.position).toBe("K");
    expect(candidate.perGame.fieldGoalsMade).toBeCloseTo(2 * 0.85, 10);
    expect(candidate.perGame.fieldGoalsMissed).toBeCloseTo(2 * 0.15, 10);
    expect(candidate.perGame.extraPointsMade).toBeCloseTo(2.5 * 0.95, 10);
    expect(candidate.games.expected).toBeCloseTo(17 * 0.95, 10);
    expect(candidate.reasons).toContainEqual({ code: "kicker_no_history" });
  });

  it("moves the make rate toward a kicker's own record as his sample grows", () => {
    const thin = kickerCandidate(
      { playerId: "k1", team: "SF", season: 2025, ownHistory: [season({ season: 2024, fieldGoalsAttempted: 5, fieldGoalsMade: 5 })], teamHistory: [] },
      priors,
    );
    const thick = kickerCandidate(
      { playerId: "k1", team: "SF", season: 2025, ownHistory: [season({ season: 2024, fieldGoalsAttempted: 300, fieldGoalsMade: 300 })], teamHistory: [] },
      priors,
    );
    const rateOf = (c: typeof thin): number => c.perGame.fieldGoalsMade / (c.perGame.fieldGoalsMade + (c.perGame.fieldGoalsMissed ?? 0));
    expect(rateOf(thin)).toBeGreaterThan(priors.leagueFieldGoalMakeRate);
    expect(rateOf(thick)).toBeGreaterThan(rateOf(thin));
    expect(rateOf(thick)).toBeLessThan(1);
  });

  it("takes attempts from the team and make rates from the kicker", () => {
    const busyTeam = kickerCandidate(
      {
        playerId: "k1", team: "SF", season: 2025, ownHistory: [],
        teamHistory: [season({ season: 2024, team: "SF", playerId: "other", games: 17, teamGames: 17, fieldGoalsAttempted: 68 })],
      },
      priors,
    );
    const attempts = busyTeam.perGame.fieldGoalsMade + (busyTeam.perGame.fieldGoalsMissed ?? 0);
    expect(attempts).toBeGreaterThan(priors.leagueFieldGoalAttemptsPerGame);
  });

  it("carries no points allowed, no yards allowed and no tier points", () => {
    const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory: [], teamHistory: [] }, priors);
    expect(candidate.perGame.pointsAllowed).toBeUndefined();
    expect(candidate.perGame.yardsAllowed).toBeUndefined();
    expect(candidate.perGameTierPoints).toBeUndefined();
  });

  it("scores under the league's own rules and nothing else", () => {
    const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory: [], teamHistory: [] }, priors);
    const points = computeFantasyPoints(candidate.perGame, "K", PPR_SCORING);
    const expected =
      2 * 0.85 * PPR_SCORING.pointsPerFieldGoal +
      2 * 0.15 * PPR_SCORING.pointsPerFieldGoalMissed +
      2.5 * 0.95 * PPR_SCORING.pointsPerExtraPoint +
      2.5 * 0.05 * PPR_SCORING.pointsPerExtraPointMissed;
    expect(points).toBeCloseTo(Math.round(expected * 100) / 100, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/kicker.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/projections/preseason/kicker.ts`**

The module docblock states, in full: what a kicker's season decomposes into, which component travels
with the club and which with the man, that the shrinkage weights are fit and not chosen, and that a
kicker with no history gets the team's opportunity and the league's make rates and says so on the row.

```typescript
import { STAT_FIELDS, type StatLine } from "@/domain/player";
import { finalWeekOf } from "../nflverse/team-eras";
import type { KickingWeekRow } from "../nflverse/kicking-weeks";
import type { GamesPlayedOutlook } from "./availability";
import type { BoardCandidate } from "./board";

/** One kicker's one season, folded out of his weekly rows. */
export interface KickerSeason { /* fields as in the Interfaces block above */ }

/**
 * ATTEMPTS TRAVEL WITH THE CLUB, MAKE RATES TRAVEL WITH THE MAN. A kicker attempts a field goal
 * because his offense stalled at the 30, which is a fact about the offense; he makes it because he
 * is a good kicker, which is a fact about him. Composing the two separately is the whole reason this
 * model beats last season's points: a good kicker who signs with a bad offense should fall, and a
 * mediocre one inheriting a great offense should rise, and a points-order board says neither.
 */
export function kickerSeasonsFrom(rows: readonly KickingWeekRow[]): readonly KickerSeason[] { /* … */ }
```

Implementation notes the code follows exactly:

- `kickerSeasonsFrom` groups by `(season, playerId)`, counts distinct weeks as `games`, sums the four
  component counts, sets `teamGames` from `finalWeekOf(season)` minus one bye (17 from 2021, 16
  before), and attributes the season to the club with the most weeks, ties broken by the alphabetically
  first code so the fold is deterministic.
- `fitKickerPriors` throws on any held-out season present in its input, exactly as `fitGameVariance`
  does, quoting the season in the message. It then measures five league means directly (attempts per
  game and make rate for both kinds, and the games rate) and searches only `recencyDecay` over the
  grid, scoring each candidate decay by the mean absolute error of a leave-one-season-out prediction
  of each kicker's next-season points per game. The four prior counts are documented floors, not
  searched: `teamPriorGames = 16`, `kickerPriorFieldGoalAttempts = 30`,
  `kickerPriorExtraPointAttempts = 30`, `kickerPriorGames = 16`. Each carries a one-paragraph
  justification in the file (roughly one season's worth of evidence before a club or a man outweighs
  the league).
- `recencyWeighted(values, decay)` weights the most recent season 1, the one before `decay`, and so on.
- `shrink(own, ownCount, league, priorCount)` returns `(own * ownCount + league * priorCount) / (ownCount + priorCount)`.
- `kickerCandidate` composes:
  - `fgAttPerGame = shrink(teamFgAttPerGame, teamGamesSeen, league, teamPriorGames)`
  - `patAttPerGame` likewise
  - `fgMakeRate = shrink(ownMakeRate, ownAttempts, leagueMakeRate, kickerPriorFieldGoalAttempts)`
  - `patMakeRate` likewise
  - `gamesRate = shrink(ownGamesRate, ownGamesSeen, leagueGamesRate, kickerPriorGames)`
  - `games`: a `GamesPlayedOutlook` whose `expected` is `gamesRate * teamGames`, whose `rate` is
    `gamesRate` and whose `probabilities` are a binomial over `teamGames` at `gamesRate`. The floor,
    median and ceiling come off that vector at the 10th, 50th and 90th percentiles. A binomial and
    not the beta-binomial the skill positions use, because there is no fitted concentration for this
    position and asserting one would be a number nothing measured.
  - `perGame`: `STAT_FIELDS` all zero, then `fieldGoalsMade`, `extraPointsMade`, and the optional
    `fieldGoalsMissed` and `extraPointsMissed` set from the attempts and the rates.
  - `reasons`: `{ code: "kicker_no_history" }` when `ownHistory` is empty, and always
    `{ code: "kicker_opportunity", fieldGoalAttemptsPerGame, extraPointAttemptsPerGame, fieldGoalMakeRate }`.
- `kickerWeeklyPoints` turns weekly rows into each kicker-season's own weekly points under a rules
  object, for the per-game variance fit in Task 5.

`BoardReason` gains the two codes in `board.ts` in this task, each with its own docblock:

```typescript
  /** A kicker with no kicking history at all (a rookie or a first-year starter). His attempts come
   *  from the club he signed with and his make rates are the league's own, and this reason is how
   *  the row says so rather than presenting a league mean as a measurement of him. */
  | { readonly code: "kicker_no_history" }
  /** What a kicker's projection is actually built from: the club's own field-goal and extra-point
   *  attempts per game (shrunk toward the league) and his own make rate (shrunk toward the league by
   *  his own attempt count). The three numbers a reader can argue with. */
  | { readonly code: "kicker_opportunity"; readonly fieldGoalAttemptsPerGame: number; readonly extraPointAttemptsPerGame: number; readonly fieldGoalMakeRate: number }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/preseason/kicker.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/preseason`,
`npx vitest run src/projections/preseason`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/preseason/kicker.ts src/projections/preseason/kicker.test.ts src/projections/preseason/board.ts
git commit -m "$(cat <<'EOF'
feat(projections): compose a kicker's season from measured components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 3: The team-defense model, including the tier expectation

**Files:**
- Create: `src/projections/preseason/team-defense.ts`
- Test: `src/projections/preseason/team-defense.test.ts`
- Modify: `src/projections/preseason/board.ts` (two more `BoardReason` codes)

**Interfaces:**
- Consumes: `TeamDefenseWeekRow`, `teamDefenseWeekRowsForSeasons` (`../nflverse/team-defense-weeks`); `teamDefenseUniverseId`, `sourceTeamCode` (`../nflverse/team-codes`); `POINTS_ALLOWED_TIERS`/`YARDS_ALLOWED_TIERS` through `computeFantasyPoints` only (the tables stay private to `scoring/compute.ts`; this module calls `computeFantasyPoints` on a one-game DEF line to get a tier value, so the tables have exactly one spelling).
- Produces:

```typescript
export interface DefenseGame {
  readonly season: number; readonly week: number; readonly team: string;
  readonly sacks: number; readonly interceptions: number; readonly fumbleRecoveries: number;
  readonly defensiveTouchdowns: number; readonly safeties: number;
  readonly pointsAllowed: number; readonly yardsAllowed: number;
}
export function defenseGamesFrom(rows: readonly TeamDefenseWeekRow[], pointsAllowed: ReadonlyMap<string, number>): readonly DefenseGame[];
export interface DefensePriors {
  readonly leaguePerGame: Readonly<Record<"sacks" | "interceptions" | "fumbleRecoveries" | "defensiveTouchdowns" | "safeties", number>>;
  readonly leaguePointsAllowed: readonly number[];
  readonly leagueYardsAllowed: readonly number[];
  readonly teamPriorGames: number;
  readonly tierPriorGames: number;
  readonly recencyDecay: number;
}
export interface DefenseFitOptions { readonly heldOutSeasons: readonly number[]; readonly recencyDecayGrid?: readonly number[]; }
export function fitDefensePriors(games: readonly DefenseGame[], options: DefenseFitOptions): DefensePriors;
export function expectedTierPoints(own: readonly DefenseGame[], priors: DefensePriors, rules: ScoringRules): number;
export interface DefenseCandidateInput { readonly team: string; readonly season: number; readonly history: readonly DefenseGame[]; }
export function defenseCandidate(input: DefenseCandidateInput, priors: DefensePriors, rules: ScoringRules): BoardCandidate;
export function defenseWeeklyPoints(games: readonly DefenseGame[], rules: ScoringRules): ReadonlyMap<string, readonly number[]>;
```

- [ ] **Step 1: Write the failing test**

The load-bearing case is the one the spec names: a fixture where the tier of the mean and the mean of
the tiers differ, asserting the latter.

```typescript
import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { defenseCandidate, expectedTierPoints, fitDefensePriors, type DefenseGame, type DefensePriors } from "./team-defense";

function game(overrides: Partial<DefenseGame>): DefenseGame {
  return {
    season: 2024, week: 1, team: "SF",
    sacks: 2, interceptions: 1, fumbleRecoveries: 0, defensiveTouchdowns: 0, safeties: 0,
    pointsAllowed: 20, yardsAllowed: 330,
    ...overrides,
  };
}

/** A one-game DEF line carrying only the tier inputs. What one game's tier points are worth. */
function tierValue(pointsAllowed: number, yardsAllowed: number): number {
  return computeFantasyPoints(
    {
      playerId: "d", week: 1, passingYards: 0, passingTouchdowns: 0, interceptions: 0,
      rushingYards: 0, rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0,
      receptions: 0, fumblesLost: 0, fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0,
      defensiveInterceptions: 0, defensiveTouchdowns: 0, pointsAllowed, yardsAllowed,
    },
    "DEF",
    PPR_SCORING,
  );
}

const PRIORS: DefensePriors = {
  leaguePerGame: { sacks: 2.3, interceptions: 0.7, fumbleRecoveries: 0.5, defensiveTouchdowns: 0.1, safeties: 0.03 },
  leaguePointsAllowed: [22, 22, 22, 22],
  leagueYardsAllowed: [340, 340, 340, 340],
  teamPriorGames: 16,
  tierPriorGames: 16,
  recencyDecay: 0.8,
};

describe("expectedTierPoints", () => {
  it("averages the tier function rather than tiering the average", () => {
    // 13 allowed scores 3, 27 allowed scores 0. The mean of the two is 1.5; the tier of the mean
    // (20 allowed) is 1. The distinction the spec names, asserted on the real tables.
    expect(tierValue(13, 300)).not.toBe(tierValue(27, 300));
    const own = [game({ pointsAllowed: 13, yardsAllowed: 300 }), game({ week: 2, pointsAllowed: 27, yardsAllowed: 300 })];
    const meanOfTiers = (tierValue(13, 300) + tierValue(27, 300)) / 2;
    const tierOfMean = tierValue(20, 300);
    expect(meanOfTiers).not.toBeCloseTo(tierOfMean, 6);
    // With no shrinkage at all (own count enormous relative to the prior) the answer is the mean of
    // the tiers.
    const noShrink = expectedTierPoints(own, { ...PRIORS, tierPriorGames: 0 }, PPR_SCORING);
    expect(noShrink).toBeCloseTo(meanOfTiers, 6);
  });

  it("shrinks a thin sample toward the league's own distribution", () => {
    const own = [game({ pointsAllowed: 0, yardsAllowed: 100 })];
    const shrunk = expectedTierPoints(own, PRIORS, PPR_SCORING);
    const unshrunk = expectedTierPoints(own, { ...PRIORS, tierPriorGames: 0 }, PPR_SCORING);
    const league = expectedTierPoints([], PRIORS, PPR_SCORING);
    expect(shrunk).toBeLessThan(unshrunk);
    expect(shrunk).toBeGreaterThan(league);
  });

  it("gives a team with no history the league's own expectation", () => {
    expect(expectedTierPoints([], PRIORS, PPR_SCORING)).toBeCloseTo(tierValue(22, 340), 6);
  });
});

describe("fitDefensePriors", () => {
  it("refuses a held-out season rather than filtering it out quietly", () => {
    expect(() => fitDefensePriors([game({ season: 2025 })], { heldOutSeasons: [2025] })).toThrow(/2025/);
  });

  it("measures the league per-game rates directly and keeps the whole allowed distributions", () => {
    const priors = fitDefensePriors(
      [game({ sacks: 1, pointsAllowed: 10 }), game({ week: 2, sacks: 3, pointsAllowed: 30 })],
      { heldOutSeasons: [2025] },
    );
    expect(priors.leaguePerGame.sacks).toBeCloseTo(2, 10);
    expect([...priors.leaguePointsAllowed].sort((a, b) => a - b)).toEqual([10, 30]);
  });
});

describe("defenseCandidate", () => {
  it("is a DEF candidate on the synthetic universe id, playing every game", () => {
    const candidate = defenseCandidate({ team: "SF", season: 2025, history: [] }, PRIORS, PPR_SCORING);
    expect(candidate.position).toBe("DEF");
    expect(candidate.playerId).toBe("team-def:SF");
    expect(candidate.games.expected).toBe(17);
    expect(candidate.games.probabilities[17]).toBe(1);
  });

  it("puts the linear components on the line and the nonlinear ones on the tier field", () => {
    const candidate = defenseCandidate({ team: "SF", season: 2025, history: [] }, PRIORS, PPR_SCORING);
    expect(candidate.perGame.sacks).toBeCloseTo(2.3, 10);
    expect(candidate.perGame.defensiveInterceptions).toBeCloseTo(0.7, 10);
    expect(candidate.perGame.defensiveFumblesRecovered).toBeCloseTo(0.5, 10);
    expect(candidate.perGame.safeties).toBeCloseTo(0.03, 10);
    expect(candidate.perGame.pointsAllowed).toBeUndefined();
    expect(candidate.perGame.yardsAllowed).toBeUndefined();
    expect(candidate.perGameTierPoints).toBeCloseTo(tierValue(22, 340), 6);
  });

  it("says on the row what the projection was built from", () => {
    const candidate = defenseCandidate({ team: "SF", season: 2025, history: [] }, PRIORS, PPR_SCORING);
    expect(candidate.reasons).toContainEqual({ code: "defense_no_history" });
    expect(candidate.reasons.some((reason) => reason.code === "defense_takeaways")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/team-defense.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/projections/preseason/team-defense.ts`**

Implementation notes the code follows exactly:

- `defenseGamesFrom` joins each archived team-defense row to the points its opponent scored, keyed
  `"<season>|<week>|<team>"` in the supplied map (built by the caller from the schedule observations
  the store already holds). A row whose points allowed is not in the map is DROPPED and the caller
  counts it, never defaulted to zero: an invented shutout is the single most valuable fabricated
  number on this board and it must be impossible. `yardsAllowed` is `passingYardsAllowed +
  rushingYardsAllowed`, both already in the defense's frame from Phase A.
- `fitDefensePriors` throws on a held-out season. It measures the five per-game league rates
  directly, keeps the full pooled `pointsAllowed` and `yardsAllowed` vectors (which is what a
  distribution shrinkage needs, not their means), and searches only `recencyDecay` on a
  leave-one-season-out next-season points-per-game error. `teamPriorGames = 16` and
  `tierPriorGames = 16` are documented floors with the same justification the kicker's carry.
- `expectedTierPoints(own, priors, rules)` computes
  `w * mean(tier over own games) + (1 - w) * mean(tier over the league vectors)` where
  `w = ownCount / (ownCount + tierPriorGames)`. `tier` for one game is `computeFantasyPoints` on a
  DEF line carrying only that game's `pointsAllowed` and `yardsAllowed`, so the tier tables have
  exactly one spelling in the codebase and a league that retunes them retunes this too. The own-games
  average is recency-weighted by season using `priors.recencyDecay`. The league vectors are paired by
  index; where the two have different lengths the shorter is cycled, which is documented as an
  arbitrary but deterministic pairing of two marginals we hold no joint for.
- `defenseCandidate` produces `playerId: teamDefenseUniverseId(sourceTeamCode(team))`, `position:
  "DEF"`, a degenerate `GamesPlayedOutlook` at `finalWeekOf(season) - 1` games (a defense plays every
  game its club plays, which is a fact about the schedule and not a fit, and the docblock says so),
  the five linear components shrunk toward the league by `teamPriorGames`, and
  `perGameTierPoints: expectedTierPoints(history, priors, rules)`.
- `defenseWeeklyPoints` produces each team-season's own weekly DEF points for the variance fit.

`BoardReason` gains, in `board.ts`:

```typescript
  /** A team defense with no history in the window this board reads. Every component is the league's
   *  own, and this reason is how the row says so. */
  | { readonly code: "defense_no_history" }
  /** What a team defense's projection is built from: sacks and takeaways a game (shrunk toward the
   *  league by the team's own game count) and the expected points the tier tables award, averaged
   *  over the team's own shrunk per-game distribution rather than read off its average. */
  | { readonly code: "defense_takeaways"; readonly sacksPerGame: number; readonly takeawaysPerGame: number; readonly tierPointsPerGame: number }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/preseason/team-defense.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/preseason`,
`npx vitest run src/projections/preseason`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/preseason/team-defense.ts src/projections/preseason/team-defense.test.ts src/projections/preseason/board.ts
git commit -m "$(cat <<'EOF'
feat(projections): compose a team defense's season, tiers averaged not tiered

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 4: The four gates, as pure functions

**Files:**
- Create: `src/projections/preseason/kdef-scorecard.ts`
- Test: `src/projections/preseason/kdef-scorecard.test.ts`

**Interfaces:**
- Consumes: `spearman` or the rank-correlation helper `src/projections/metrics.ts` already exports; `BoardEntry` (`./board`).
- Produces:

```typescript
export interface GateResult { readonly name: string; readonly passed: boolean; readonly detail: string; }
export interface OrderingGateInput {
  readonly model: ReadonlyMap<string, number>;
  readonly baseline: ReadonlyMap<string, number>;
  readonly actual: ReadonlyMap<string, number>;
  readonly eligible: ReadonlySet<string>;
}
export const GATE_THRESHOLDS: {
  readonly orderingBeatsLastSeasonBy: 0.05;
  readonly marketShortfallAllowed: 0.02;
  readonly coverage: { readonly min: 0.4; readonly max: 0.6 };
};
export function gateOrdering(input: OrderingGateInput): GateResult;
export function gateMarket(input: OrderingGateInput): GateResult;
export function gateCalibration(bands: readonly { readonly playerId: string; readonly floor: number; readonly ceiling: number }[], actual: ReadonlyMap<string, number>): GateResult;
export function gateIsolation(before: readonly string[], after: readonly string[]): GateResult;
export function decisionFor(gates: readonly GateResult[]): "projected" | "market_order";
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { GATE_THRESHOLDS, decisionFor, gateCalibration, gateIsolation, gateMarket, gateOrdering } from "./kdef-scorecard";

const actual = new Map([["a", 10], ["b", 20], ["c", 30], ["d", 40]]);
const eligible = new Set(["a", "b", "c", "d"]);

describe("the preregistered gates", () => {
  it("G1 passes only when the model beats last-season order by the stated margin", () => {
    const perfect = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
    const reversed = new Map([["a", 4], ["b", 3], ["c", 2], ["d", 1]]);
    expect(gateOrdering({ model: perfect, baseline: reversed, actual, eligible }).passed).toBe(true);
    expect(gateOrdering({ model: perfect, baseline: perfect, actual, eligible }).passed).toBe(false);
    expect(GATE_THRESHOLDS.orderingBeatsLastSeasonBy).toBe(0.05);
  });

  it("G2 passes when the model is no worse than the market by more than the stated shortfall", () => {
    const perfect = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
    const nearly = new Map([["a", 1], ["b", 2], ["c", 4], ["d", 3]]);
    expect(gateMarket({ model: perfect, baseline: nearly, actual, eligible }).passed).toBe(true);
    expect(gateMarket({ model: nearly, baseline: perfect, actual, eligible }).passed).toBe(false);
  });

  it("G2 reports that it could not answer when the covered subset is empty", () => {
    const result = gateMarket({ model: new Map(), baseline: new Map(), actual, eligible: new Set() });
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/no overlap/i);
  });

  it("G3 passes when between forty and sixty percent of outcomes fall inside the band", () => {
    const bands = [
      { playerId: "a", floor: 0, ceiling: 100 },
      { playerId: "b", floor: 0, ceiling: 100 },
      { playerId: "c", floor: 0, ceiling: 5 },
      { playerId: "d", floor: 0, ceiling: 5 },
    ];
    expect(gateCalibration(bands, actual).passed).toBe(true);
    expect(gateCalibration(bands.map((band) => ({ ...band, ceiling: 1000 })), actual).passed).toBe(false);
    expect(GATE_THRESHOLDS.coverage).toEqual({ min: 0.4, max: 0.6 });
  });

  it("G4 passes only on a byte-identical set of skill rows", () => {
    expect(gateIsolation(["QB Allen 400.12"], ["QB Allen 400.12"]).passed).toBe(true);
    expect(gateIsolation(["QB Allen 400.12"], ["QB Allen 400.13"]).passed).toBe(false);
    expect(gateIsolation(["QB Allen 400.12"], ["QB Allen 400.12", "RB Barkley 300.00"]).passed).toBe(false);
  });

  it("ships projected rows only when every gate passed", () => {
    const pass = { name: "g", passed: true, detail: "" };
    const fail = { name: "g", passed: false, detail: "" };
    expect(decisionFor([pass, pass, pass, pass])).toBe("projected");
    expect(decisionFor([pass, pass, fail, pass])).toBe("market_order");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/kdef-scorecard.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Thresholds are the spec's own, copied verbatim as named constants with the spec's wording in their
docblocks. `gateOrdering` and `gateMarket` both compute a Spearman rank correlation of the two
orderings against `actual` over `eligible` and compare the difference to the threshold; the detail
string reports both correlations, the difference and the sample size, so the results document can
quote it. `gateMarket` returns `passed: false` with a "no overlap" detail for an empty subset, never
`true`, following `metrics.ts`'s rule that a sample which cannot answer says so rather than passing.
`gateCalibration` counts the actuals inside `[floor, ceiling]` inclusive and compares the share to the
band. `gateIsolation` compares two arrays of already-rendered row strings element by element and
reports the first index that differs, or the length disagreement.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/preseason/kdef-scorecard.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/preseason`,
`npx vitest run src/projections/preseason`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/preseason/kdef-scorecard.ts src/projections/preseason/kdef-scorecard.test.ts
git commit -m "$(cat <<'EOF'
test(projections): the four K and DEF gates as pure functions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 5: The fit script, the per-game variance cells, and the committed priors

**Files:**
- Create: `scripts/kdef-fit.ts`
- Create: `src/projections/preseason/kdef-fitted.ts`
- Modify: `src/projections/preseason/game-variance.ts`
- Modify: `src/projections/preseason/game-variance.test.ts`
- Modify: `src/projections/preseason/game-variance-fitted.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `FITTED_KICKER_PRIORS`, `FITTED_DEFENSE_PRIORS` (`./kdef-fitted`); `VARIANCE_POSITIONS` includes `"K"` and `"DEF"`; `fitGameVariance(observations, { heldOutSeasons, positions? })`.

- [ ] **Step 1: Write the failing test for the variance change**

Append to `src/projections/preseason/game-variance.test.ts`:

```typescript
describe("the two new variance positions", () => {
  it("carries a cell for K and DEF", () => {
    expect(VARIANCE_POSITIONS).toContain("K");
    expect(VARIANCE_POSITIONS).toContain("DEF");
  });

  it("never writes a cell it has no observations for", () => {
    const priors = fitGameVariance(skillObservations, { heldOutSeasons: [2025] });
    expect(priors.veteran.K).toBeUndefined();
    expect(priors.veteran.DEF).toBeUndefined();
    expect(priors.veteran.WR).toBeGreaterThan(0);
  });

  it("fits only the positions it was asked for", () => {
    const priors = fitGameVariance(kickerObservations, { heldOutSeasons: [2025], positions: ["K"] });
    expect(priors.veteran.K).toBeGreaterThan(0);
    expect(priors.veteran.WR).toBeUndefined();
  });

  it("bands a candidate on its own position's cell", () => {
    const band = seasonPointsBand(8, degenerateOutlook(17), 25);
    expect(band.ceiling).toBeGreaterThan(band.median);
  });
});
```

`GameVariancePriors` becomes `Readonly<Record<PlayerClass, Partial<Readonly<Record<VariancePosition,
number>>>>>` and `board.ts`'s `gameVarianceFor` reads `priors[playerClass][position] ?? 0`, which is
the same games-only zero it already returns for an unfitted position. That keeps every existing skill
row identical and stops a K or DEF cell from ever holding a fabricated number.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/game-variance.test.ts`
Expected: FAIL, `VARIANCE_POSITIONS` does not contain `K`.

- [ ] **Step 3: Make the change**

`VARIANCE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const`. `GameVarianceFitOptions` gains
`readonly positions?: readonly VariancePosition[]`, defaulting to `["QB", "RB", "WR", "TE"]` with a
docblock saying why the default is the four and not all six: this function's observation loader reads
`player_week_observations`, which holds no kicker row and no team-defense row, so asking it for those
cells would produce a fabricated zero. `fitGameVariance` iterates the option rather than the constant,
and `board.ts`'s `gameVarianceFor` becomes:

```typescript
function gameVarianceFor(candidate: BoardCandidate, priors: GameVariancePriors): number {
  if (!(VARIANCE_POSITIONS as readonly Position[]).includes(candidate.position)) return 0;
  const position = candidate.position as VariancePosition;
  const playerClass: PlayerClass = isRookieCandidate(candidate) ? "rookie" : "veteran";
  // A position this round never fit a cell for bands on availability alone, exactly as every
  // position did before the variance round. `?? 0` and never a borrowed number from a population
  // it was never measured against.
  return priors[playerClass][position] ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/preseason` and `npx vitest run src/projections`
Expected: PASS.

- [ ] **Step 5: Write `scripts/kdef-fit.ts`**

The script:

1. Reads `FIT_SEASONS` from `process.argv`, defaulting to 2013 through 2024, and refuses any season
   past 2024 with an explicit message naming the held-out discipline.
2. Loads the kicking weeks and the team-defense weeks for the fit seasons, plus the schedule
   observations that supply points allowed, and reports how many defense games could not be joined to
   a score (which must be 0).
3. Calls `fitKickerPriors` and `fitDefensePriors` with `heldOutSeasons: [2025, 2026]`.
4. Calls `fitGameVariance` with `positions: ["K", "DEF"]` over the weekly points from
   `kickerWeeklyPoints` and `defenseWeeklyPoints`.
5. Prints the whole of `kdef-fitted.ts` to stdout, ready to paste, in the same shape
   `preseason-fit.ts` already prints `fitted.ts`, and prints the two new variance cells for
   `game-variance-fitted.ts`.
6. Prints, for the operator, every league mean it measured and the sample size behind it.

Register it: `"projections:kdef:fit": "dotenv -e .env.local -- tsx scripts/kdef-fit.ts",`.

- [ ] **Step 6: Run the DEVELOPMENT fit, holding 2024 out**

Run: `npm run projections:kdef:fit 2013 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023`
Then score the resulting priors on 2024 with `scripts/kdef-judgment.ts --season 2024 --dry-run`
(Task 6 builds it; do this step after Task 6 and return here). Record the four gate numbers per
position for 2024 in the ledger as iteration 1. If the model needs changing, change it, refit on
2013-2023, rescore 2024, and record iteration 2. **2025 is not touched during any of this.**

- [ ] **Step 7: Run the REAL fit on 2013 through 2024 and commit the priors**

Run: `npm run projections:kdef:fit`
Paste its output into `src/projections/preseason/kdef-fitted.ts` and the two variance cells into
`src/projections/preseason/game-variance-fitted.ts`. The header of `kdef-fitted.ts` records the fit
seasons, the held-out seasons, the sample sizes and the date, exactly as `fitted.ts` does.

- [ ] **Step 8: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections scripts`,
`npx vitest run src/projections`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add scripts/kdef-fit.ts src/projections/preseason/kdef-fitted.ts src/projections/preseason/game-variance.ts src/projections/preseason/game-variance.test.ts src/projections/preseason/game-variance-fitted.ts src/projections/preseason/board.ts package.json
git commit -m "$(cat <<'EOF'
feat(projections): fit the kicker and team defense components on 2013-2024

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 6: The preregistration document

**Files:**
- Create: `docs/research/2026-09-05-kicker-defense-preregistration.md`
- Create: `scripts/kdef-judgment.ts`
- Modify: `package.json`

This task commits the document BEFORE the judgment is run. The judgment script is written and
exercised on 2024 in the same commit, because a script whose first ever run is the one that decides
is a script nobody has debugged.

**Interfaces:**
- Produces: `npm run projections:kdef:judgment [-- --season 2024]`, defaulting to 2025.

- [ ] **Step 1: Write the preregistration document**

Structure taken from `docs/research/2026-09-05-availability-injury-type-preregistration.md`: blocked
on, hypothesis, features, fit and judgment, gates, decision rule, UX rider, amendments. The gates are
copied VERBATIM from the spec §5 Phase B:

> - G1 Ordering. Spearman of model rank against 2025 actual season points beats the last-season-order baseline by at least 0.05.
> - G2 Market. On the ADP-covered subset, the model's Spearman is no worse than the ADP baseline by more than 0.02.
> - G3 Calibration. The "most seasons" band (p25 to p75) covers between 40% and 60% of 2025 actuals.
> - G4 Isolation. The QB, RB, WR, TE rows of the 2025 judgment board are byte-identical before and after the change.

The document also records, as an amendment written before the run: the exact fit seasons (2013
through 2024), the exact judgment season (2025), the three baselines, that 2026 is never read, the
rulings R-1 through R-4 from this plan's header, and every development iteration the ledger recorded
against 2024.

Note on G3: the spec names the band "p25 to p75" while `seasonPointsBand` computes the tenth and
ninetieth percentiles. The document records this explicitly as a stated deviation with its own
justification, and the judgment computes the p25/p75 interval from the same composed mean and
variance (`z = ±0.6744897501960817`) so the gate is measured on the interval the spec names rather
than on the one the board happens to render. Record it in the ledger as a ruling.

- [ ] **Step 2: Write `scripts/kdef-judgment.ts`**

The script:

1. Refuses to run for any season other than 2025 unless `--dry-run` is passed, and refuses 2026
   outright with a message naming the held-out discipline.
2. Builds the four skill positions' 2025 board rows twice: once from `git stash`-free HEAD (the
   caller supplies the BEFORE rendering as a file through `--isolation-before <path>`, produced by
   running this same script on the pre-Phase-C commit), and once now. G4 compares them.
3. Builds the K and the DEF candidates for 2025 from `FITTED_KICKER_PRIORS` and
   `FITTED_DEFENSE_PRIORS` and the week-one roster, runs them through `preseasonBoard`, and scores
   G1, G2, G3 per position against the 2025 actuals.
4. The three baselines: last-season points order (each candidate's own 2024 season points under the
   league rules), the market's ADP order over the covered subset, and the league mean (a flat board,
   reported for context and not gated).
5. Prints one block per position with every gate's own numbers and the decision, and prints
   `DECISION K: projected` or `DECISION K: market order` on its own line so the results document and
   the register can be read by eye.
6. Writes nothing to the database.

Register it: `"projections:kdef:judgment": "dotenv -e .env.local -- tsx scripts/kdef-judgment.ts",`.

- [ ] **Step 3: Exercise it on 2024**

Run: `npm run projections:kdef:judgment -- --season 2024 --dry-run`
Expected: it completes and prints every gate's numbers. Record them in the ledger as the development
check. Fix any crash here, never on the 2025 run.

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint scripts`
Expected: clean.

- [ ] **Step 5: Commit the preregistration BEFORE the judgment run**

```bash
git add docs/research/2026-09-05-kicker-defense-preregistration.md scripts/kdef-judgment.ts package.json
git commit -m "$(cat <<'EOF'
docs(research): preregister the kicker and team defense judgment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 7: The single judgment run

**Files:**
- Create: `docs/research/2026-09-05-kicker-defense-preregistration-results.md`

This task runs once. If it fails, the failure is the result and it is committed as the result; the
model is not retuned and rerun.

- [ ] **Step 1: Produce the G4 "before" rendering**

From the commit immediately before Phase C's `projectedPosition` change (Phase C Task 2), run:

```bash
npm run projections:kdef:judgment -- --season 2025 --isolation-emit /tmp/kdef-g4-before.txt
```

This writes the QB, RB, WR and TE rows of the 2025 board, one per line, in the board's own order,
formatted `<position> <playerId> <projectedPoints to 6 decimals> <tier> <valueOverReplacement to 6 decimals>`.

- [ ] **Step 2: Run the judgment**

```bash
npm run projections:kdef:judgment -- --isolation-before /tmp/kdef-g4-before.txt | tee /tmp/kdef-judgment.txt
```

- [ ] **Step 3: Commit the output verbatim as the results document**

The document is a short header (what was run, when, from which commit, against which preregistration)
followed by the script's output in a fenced block, unedited, followed by the decision per position in
one sentence each. Nothing in the numbers is reworded.

- [ ] **Step 4: Record the decision in the ledger and in the register**

One ledger line per position: pass or fail on each gate with the number, and the decision.

- [ ] **Step 5: Commit**

```bash
git add docs/research/2026-09-05-kicker-defense-preregistration-results.md
git commit -m "$(cat <<'EOF'
docs(research): the single 2025 judgment for kicker and team defense

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

## Self-review

**Spec coverage.** §5 Phase B names composition (Tasks 2, 3), the kicker components (Task 2), the
defense components including the mean-of-tiers rule (Task 3), the per-game distribution for both
positions (Task 5), the fit and judgment window with the three baselines (Tasks 5, 6, 7), the four
gates (Tasks 4, 6, 7) and the decision rule (Task 4's `decisionFor`, applied in Task 7). §8's
"composition through the tier function on a known distribution (a fixture where the tier of the mean
and the mean of the tiers differ, asserting the latter)" is Task 3 Step 1's first case, written
exactly that way.

**No placeholders.** Tasks 2, 3 and 5 describe their implementations in prose beside the exact
interface signatures and exact test code rather than repeating a hundred lines of arithmetic; every
constant, every formula and every message is named. Tasks 1, 4, 6 and 7 carry the literal code or
command.

**Type consistency.** `KickerSeason`, `DefenseGame`, `KickerPriors` and `DefensePriors` are spelled
identically in the Interfaces blocks, the tests and the fit script's output shape.
`BoardCandidate.perGameTierPoints` is optional in Task 1 and read as `?? 0`, which is what makes Task
1's own byte-identity test true. `GameVariancePriors` becoming partial is matched by
`gameVarianceFor`'s `?? 0` in the same task.
