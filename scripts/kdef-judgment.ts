// The SINGLE judgment of the kicker and team defence model, against the gates preregistered in
// `docs/research/2026-09-05-kicker-defense-preregistration.md`.
// Run: npm run projections:kdef:judgment -- --isolation-before <path>
//      npm run projections:kdef:judgment -- --season 2024 --dry-run       (development check)
//      npm run projections:kdef:judgment -- --isolation-emit <path>       (the G4 "before" file)
//
// THIS RUNS ONCE, ON 2025, AND ITS OUTPUT IS COMMITTED VERBATIM AS THE RESULTS DOCUMENT, pass or
// fail. If a gate fails, the failure is the result: the position ships in market order, labelled,
// and the model is NOT retuned and rerun. Iteration happens on 2013-2024 (holding 2024 out with
// `--season 2024 --dry-run`) and every iteration is recorded in the build ledger BEFORE this is
// taken.
//
// 2026 IS REFUSED OUTRIGHT. It is the held-out data year and no fit or judgment in this round reads
// it.
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createDb, type ReadonlyDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { nflPlayers } from "@/db/schema";
import type { LeagueShape } from "@/projections/decide/replacement";
import { shippedPreseasonCandidates } from "@/projections/market/blend";
import { FITTED_MODEL } from "@/projections/model/source";
import { kickingWeekRowsForSeasons } from "@/projections/nflverse/kicking-weeks";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import { preseasonBoard, type BoardEntry } from "@/projections/preseason/board";
import { SHIPPED_GAME_VARIANCE } from "@/projections/preseason/fitted-variance";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { seasonPointsInterval, Z75 } from "@/projections/preseason/game-variance";
import { kdefCandidates } from "@/projections/preseason/kdef-candidates";
import { FITTED_DEFENSE_PRIORS, FITTED_KICKER_PRIORS } from "@/projections/preseason/kdef-fitted";
import { kdefHistorySeasonsFor, loadKdefHistory } from "@/projections/preseason/kdef-history";
import {
  decisionFor,
  gateCalibration,
  gateIsolation,
  gateMarket,
  gateOrdering,
  type GateResult,
} from "@/projections/preseason/kdef-scorecard";
import { kickerWeeklyPoints } from "@/projections/preseason/kicker";
import { loadPreseason, type PreseasonPriors } from "@/projections/preseason/source";
import { preseasonRankingsAsOf, preseasonRostersAsOf } from "@/projections/preseason/store";
import { defenseWeeklyPoints } from "@/projections/preseason/team-defense";
import { computeFantasyPoints } from "@/scoring/compute";

/** The preregistered judgment season. Everything else needs `--dry-run` and is a development check. */
const JUDGMENT_SEASON = 2025;
/** The held-out data year. Never read, under any flag. */
const NEVER_READ_SEASON = 2026;

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const DRY_RUN = process.argv.includes("--dry-run");
const SEASON = Number(flag("season") ?? JUDGMENT_SEASON);
const ISOLATION_BEFORE = flag("isolation-before");
const ISOLATION_EMIT = flag("isolation-emit");

/** Far past any correction: outcomes and benchmarks alike are scored against, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

/** The same twelve-team PPR shape `preseason-report.ts` measures on, widened to start both new
 *  positions. Kickers and defences had guaranteed-blank slots there before this round. */
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };

const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
  career: FITTED_CAREER_PRIORS,
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:kdef:judgment\`, which loads .env.local.`);
  }
  return value;
}

/**
 * The four skill positions' rows, rendered one per line for gate G4's byte-identical comparison.
 *
 * RENDERED RATHER THAN COMPARED STRUCTURALLY, because "byte-identical" is the spec's own word and a
 * structural comparison would forgive a floating-point difference in a decimal place a real row
 * shows. Six decimals on both the points and the value, because that is more precision than any
 * surface renders and therefore a stricter test than any surface could fail.
 */
function skillRows(board: readonly BoardEntry[]): readonly string[] {
  return board
    .filter((entry) => entry.position === "QB" || entry.position === "RB" || entry.position === "WR" || entry.position === "TE")
    .map(
      (entry) =>
        `${entry.rank} ${entry.position} ${entry.playerId} ${entry.projectedPoints.toFixed(6)} ` +
        `${entry.tier} ${entry.valueOverReplacement.toFixed(6)}`,
    );
}

/** Every kicker's actual season points, from the archived weekly kicking lines. */
async function kickerActuals(db: ReadonlyDb, season: number): Promise<ReadonlyMap<string, number>> {
  const weekly = kickerWeeklyPoints(await kickingWeekRowsForSeasons(db, [season]), PPR_SCORING);
  return new Map(
    [...weekly].map(([key, points]) => [key.split("|")[1]!, points.reduce((total, value) => total + value, 0)] as const),
  );
}

/** Every team defence's actual season points, from the archived defence games. */
async function defenceActuals(db: ReadonlyDb, season: number): Promise<ReadonlyMap<string, number>> {
  const history = await loadKdefHistory(db, [season], FINAL);
  const weekly = defenseWeeklyPoints(history.defenseGames, PPR_SCORING);
  return new Map(
    [...weekly].map(
      ([key, points]) => [`team-def:${key.split("|")[1]!}`, points.reduce((total, value) => total + value, 0)] as const,
    ),
  );
}

/** Last season's own points, as an ordering. The baseline gate G1 has to beat. */
async function lastSeasonPoints(db: ReadonlyDb, season: number): Promise<ReadonlyMap<string, number>> {
  const kickers = await kickerActuals(db, season - 1);
  const defences = await defenceActuals(db, season - 1);
  return new Map([...kickers, ...defences]);
}

/** The market's own order, negated so higher is better in every column of this report. */
async function marketOrder(db: ReadonlyDb, season: number): Promise<ReadonlyMap<string, number>> {
  const published = await preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.adp, asOf: FINAL });
  return new Map(published.map((row) => [row.playerId, -row.rank] as const));
}

interface PositionJudgment {
  readonly position: "K" | "DEF";
  readonly gates: readonly GateResult[];
  readonly candidates: number;
  readonly scored: number;
}

function judgePosition(
  position: "K" | "DEF",
  board: readonly BoardEntry[],
  candidateBands: ReadonlyMap<string, { readonly floor: number; readonly ceiling: number }>,
  actual: ReadonlyMap<string, number>,
  last: ReadonlyMap<string, number>,
  market: ReadonlyMap<string, number>,
  isolation: GateResult,
): PositionJudgment {
  const rows = board.filter((entry) => entry.position === position);
  const model = new Map(rows.map((entry) => [entry.playerId, entry.projectedPoints] as const));
  const eligible = new Set([...model.keys()].filter((playerId) => actual.has(playerId)));
  const bands = [...candidateBands]
    .filter(([playerId]) => eligible.has(playerId))
    .map(([playerId, band]) => ({ playerId, floor: band.floor, ceiling: band.ceiling }));

  return {
    position,
    candidates: rows.length,
    scored: eligible.size,
    gates: [
      gateOrdering({ model, baseline: last, actual, eligible }),
      gateMarket({
        model,
        baseline: market,
        actual,
        eligible: new Set([...eligible].filter((playerId) => market.has(playerId))),
      }),
      gateCalibration(bands, actual),
      isolation,
    ],
  };
}

async function main(): Promise<void> {
  if (SEASON === NEVER_READ_SEASON) {
    throw new Error(`${NEVER_READ_SEASON} is the held-out data year and is never read by any fit or judgment.`);
  }
  if (SEASON !== JUDGMENT_SEASON && !DRY_RUN) {
    throw new Error(
      `${SEASON} is not the preregistered judgment season (${JUDGMENT_SEASON}). Pass --dry-run to run it as a development check.`,
    );
  }

  const db = createDb(requireEnv("DATABASE_URL"));
  const inputs = await loadPreseason(db, SEASON);
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );

  // The four skill positions' board, exactly as `preseason-report.ts` builds the shipped one.
  const skill = preseasonBoard(await shippedPreseasonCandidates(db, inputs, PRIORS), {
    season: SEASON,
    asOf: inputs.moment,
    rules: PPR_SCORING,
    shape: SHAPE,
  });
  const rendered = skillRows(skill);

  if (ISOLATION_EMIT !== null) {
    writeFileSync(ISOLATION_EMIT, `${rendered.join("\n")}\n`);
    console.log(`wrote ${rendered.length} skill rows to ${ISOLATION_EMIT} for gate G4`);
    await db.$client.end();
    return;
  }

  const isolation =
    ISOLATION_BEFORE === null
      ? {
          name: "G4 isolation",
          passed: false,
          detail: "cannot answer: no --isolation-before rendering was supplied to compare against",
        }
      : gateIsolation(readFileSync(ISOLATION_BEFORE, "utf8").trimEnd().split("\n"), rendered);

  // The two new positions, built from their own candidate builders and run through the same board.
  const history = await loadKdefHistory(db, kdefHistorySeasonsFor(SEASON), inputs.moment);
  const roster = await preseasonRostersAsOf(db, { season: SEASON, asOf: inputs.moment });
  const candidates = kdefCandidates({
    season: SEASON,
    roster,
    history,
    kicker: FITTED_KICKER_PRIORS,
    defence: FITTED_DEFENSE_PRIORS,
    rules: PPR_SCORING,
  });
  const kdefBoard = preseasonBoard(candidates, { season: SEASON, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });

  // The p25/p75 interval gate G3 is measured on, composed from the same mean and variance the board
  // bands with. See `Z75`'s own docblock and the preregistration's amendment for why this differs
  // from the p10/p90 band the board renders.
  const bands = new Map(
    candidates.map((candidate) => {
      const perGamePoints =
        computeFantasyPoints(candidate.perGame, candidate.position, PPR_SCORING) + (candidate.perGameTierPoints ?? 0);
      const variance = SHIPPED_GAME_VARIANCE.veteran[candidate.position as "K" | "DEF"] ?? 0;
      const interval = seasonPointsInterval(
        perGamePoints,
        candidate.games,
        variance,
        Z75,
        candidate.seasonProjectionErrorVariance ?? 0,
      );
      return [candidate.playerId, { floor: interval.floor, ceiling: interval.ceiling }] as const;
    }),
  );

  const actual = new Map([...(await kickerActuals(db, SEASON)), ...(await defenceActuals(db, SEASON))]);
  const last = await lastSeasonPoints(db, SEASON);
  const market = await marketOrder(db, SEASON);
  await db.$client.end();

  console.log(`\n${"=".repeat(96)}`);
  console.log(
    `KICKER AND TEAM DEFENCE JUDGMENT, ${SEASON}${DRY_RUN ? " (DEVELOPMENT CHECK, not the judgment)" : ""}, ` +
      `12-team PPR, board taken at ${inputs.moment.toISOString()}`,
  );
  console.log(`${"=".repeat(96)}`);
  console.log(`\nhistory read                        ${kdefHistorySeasonsFor(SEASON).join(", ")}`);
  console.log(`defence games with no score         ${history.defenseGamesWithoutScore}`);
  console.log(`skill rows compared for G4          ${rendered.length}`);
  console.log(`positions the model rated           K ${candidates.filter((c) => c.position === "K").length}, DEF ${candidates.filter((c) => c.position === "DEF").length}`);

  for (const position of ["K", "DEF"] as const) {
    const judgment = judgePosition(position, kdefBoard, bands, actual, last, market, isolation);
    console.log(`\n${"-".repeat(96)}`);
    console.log(`${position}: ${judgment.candidates} candidates, ${judgment.scored} with a ${SEASON} outcome to be scored against`);
    console.log(`${"-".repeat(96)}`);
    for (const gate of judgment.gates) {
      console.log(`  ${gate.passed ? "PASS" : "FAIL"}  ${gate.name.padEnd(18)} ${gate.detail}`);
    }
    console.log(`  DECISION ${position}: ${decisionFor(judgment.gates) === "projected" ? "projected" : "market order"}`);

    console.log(`\n  TOP 10 by the model, with what actually happened`);
    for (const entry of kdefBoard.filter((row) => row.position === position).slice(0, 10)) {
      const scored = actual.get(entry.playerId);
      console.log(
        `    ${entry.team.padEnd(4)} ${(names.get(entry.playerId) ?? entry.playerId).padEnd(24)}` +
          `proj ${entry.projectedPoints.toFixed(1).padStart(6)}  tier ${entry.tier}  ` +
          `actual ${scored === undefined ? "   n/a" : scored.toFixed(1).padStart(6)}`,
      );
    }
  }

  // The flat-board baseline, reported for context and deliberately not gated: it is the floor any
  // ordering has to clear to be an ordering at all, and a Spearman against a constant is undefined.
  console.log(`\n${"-".repeat(96)}`);
  console.log("BASELINE FOR CONTEXT: the league mean is a flat board, whose rank correlation with any");
  console.log("outcome is undefined by construction. It is reported here as the thing an ordering beats");
  console.log("by existing, and it is not one of the four gates.");
  console.log(`positions unknown to the market     K ${[...actual.keys()].filter((id) => !id.startsWith("team-def:") && !market.has(id)).length}, DEF ${[...actual.keys()].filter((id) => id.startsWith("team-def:") && !market.has(id)).length}`);
  console.log(`${"=".repeat(96)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
