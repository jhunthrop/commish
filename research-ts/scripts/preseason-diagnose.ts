// Diagnoses WHY the preseason board loses a band, before anything is changed to fix it.
// Run: npm run projections:preseason:diagnose [season ...]   (defaults to every ingested season)
//
// THE SCRIPT THAT COMES BEFORE A MODEL CHANGE. `docs/research/2026-08-28-beating-consensus.md`
// named the starter band (ranks 51-150) as the only band the board loses on BOTH held-out seasons,
// and named the market as the one scoreboard that went backwards. Both are single numbers, and a
// single number is not a diagnosis. This script decomposes them four ways, and every one of the
// four is a question that can be answered wrong:
//
//   1. IS THE BAND REAL, OR IS IT THE BANDING? A band cut by the benchmark's OWN rank selects on
//      the benchmark's predictor, which is textbook range restriction — and it does not restrict
//      both arms equally. Section A re-cuts the identical population four ways (by the benchmark's
//      rank, by ours, by the symmetric mean of the two, and by a third party) and reports the
//      within-band spread of the outcome itself. If the loss survives every cut it is real; if it
//      only exists under one cut, the number was an artifact and chasing it would be chasing noise.
//   2. WHICH HALF OF THE PRODUCT IS WRONG? A board's projection is expected games times per-game
//      points. Section B replaces each half in turn with the truth. That bounds the whole problem:
//      whichever oracle arm moves the band is the half worth working on, and whichever does not
//      cannot be the explanation no matter how plausible it sounds.
//   3. WHO, SPECIFICALLY? Section C cuts the band by position and by the four situations the board
//      already knows about, and prints the players the benchmark ranked well and we did not.
//   4. WHERE IS THE MARKET WRONG? Section D is the only section about ADP, and it asks the market
//      question the right way round. Beating a price is not beating a ranker: the market aggregates
//      information we do not have, so "be better everywhere" is not available. What IS available is
//      a segment where the price is systematically biased. Every segment here is one a board could
//      know in August without reading a market.
//
// Reads the store only, and every board is taken at the same gated preseason moment the report
// uses. Nothing here writes anything.
import { createDb, type ReadonlyDb } from "@research-ts/db/client";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import type { Position } from "@research-ts/domain/player";
import { computeFantasyPoints } from "@research-ts/scoring/compute";
import { allPositions } from "@research-ts/projections/backtest";
import { nflPlayers } from "@research-ts/db/schema";
import { statLinesAsOf } from "@research-ts/projections/lines";
import { FITTED_MODEL } from "@research-ts/projections/model/source";
import { RANK_BANDS, spearman, type Observation, type RankBandName } from "@research-ts/projections/metrics";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";
import { BENCHMARK_SOURCES } from "@research-ts/projections/preseason/benchmarks";
import { preseasonBoard, type BoardEntry } from "@research-ts/projections/preseason/board";
import { loadShippedGameVariance } from "@research-ts/projections/preseason/game-variance-artifacts";
import type { GameVariancePriors } from "@research-ts/projections/preseason/game-variance";
import { gradableInputs } from "@research-ts/projections/preseason/scorecard";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@research-ts/projections/preseason/fitted";
import {
  SHIPPED_PRESEASON_FEATURES,
  loadPreseason,
  preseasonCandidates,
  type PreseasonInputs,
  type PreseasonPriors,
} from "@research-ts/projections/preseason/source";
import { preseasonRankingsAsOf } from "@research-ts/projections/preseason/store";
import { usageAsOf } from "@research-ts/projections/usage";
import { LAST_POSSIBLE_WEEK } from "@research-ts/projections/store";
import { ageAtSeason, teamGamesIn } from "@research-ts/projections/preseason/availability";

const SEASONS = process.argv.slice(2).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2021, 2022, 2023, 2024];
const LAST_REGULAR_WEEK = 18;
const FINAL = new Date("9999-12-31T00:00:00.000Z");

const SCORED: readonly Position[] = ["QB", "RB", "WR", "TE"];
const SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot === BENCH_SLOT || slot.eligiblePositions.every((position) => SCORED.includes(position)),
).map((slot) => ({ ...slot, eligiblePositions: slot.eligiblePositions.filter((position) => SCORED.includes(position)) }));
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: SLOTS };

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
    throw new Error(`${name} is not set. Run this through \`npm run projections:preseason:diagnose\`, which loads .env.local.`);
  }
  return value;
}

function fixed(value: number | null, places = 4): string {
  return value === null ? "    n/a" : value.toFixed(places).padStart(places + 3);
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/** One player, everything this script needs to know about him, assembled once. */
interface Subject {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  /** Actual PPR points over the regular season. Zero for a man who never played. */
  readonly actual: number;
  readonly actualGames: number;
  /** What the shipped board said. */
  readonly projected: number;
  readonly expectedGames: number;
  /** Per-game points the board composed, before availability multiplied them. */
  readonly perGame: number;
  readonly rookie: boolean;
  /** Seasons in the league, counting this one as 1. Null where the release carries no entry year. */
  readonly experience: number | null;
  readonly changedTeam: boolean;
  /** The league's own cutdown status, coarsened as the store holds it. */
  readonly status: string;
  readonly age: number | null;
  /** Games played last season, or null where the store has no prior season for him. */
  readonly priorGames: number | null;
  /** PPR points last season, or null. The naive prior every benchmark also has. */
  readonly priorPoints: number | null;
}

type Cut = { readonly name: string; readonly rankOf: (subject: Subject) => number };

/** Spearman of one ordering against the outcome, over a subset. Higher `value` must mean better. */
function rhoOf(subjects: readonly Subject[], value: (subject: Subject) => number): number | null {
  const observations: Observation[] = subjects.map((subject) => ({ predicted: value(subject), actual: subject.actual }));
  return spearman(observations);
}

function bandsOf(subjects: readonly Subject[], cut: Cut): ReadonlyMap<RankBandName, readonly Subject[]> {
  const ordered = [...subjects].sort((a, b) => cut.rankOf(a) - cut.rankOf(b) || a.playerId.localeCompare(b.playerId));
  const bands = new Map<RankBandName, Subject[]>(RANK_BANDS.map((band) => [band.name, []] as const));
  ordered.forEach((subject, index) => {
    const rank = index + 1;
    const band = RANK_BANDS.find((candidate) => rank >= candidate.from && rank <= candidate.to)!;
    bands.get(band.name)!.push(subject);
  });
  return bands;
}

async function actualSeasonPoints(
  db: ReadonlyDb,
  season: number,
  positions: ReadonlyMap<string, Position>,
): Promise<{ points: ReadonlyMap<string, number>; games: ReadonlyMap<string, number> }> {
  const rows = await statLinesAsOf(db, { season, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: FINAL });
  const points = new Map<string, number>();
  const games = new Map<string, number>();
  for (const row of rows) {
    const position = positions.get(row.line.playerId);
    if (position === undefined) continue;
    points.set(row.line.playerId, (points.get(row.line.playerId) ?? 0) + computeFantasyPoints(row.line, position, PPR_SCORING));
    games.set(row.line.playerId, (games.get(row.line.playerId) ?? 0) + 1);
  }
  return { points, games };
}

function buildBoard(inputs: PreseasonInputs, gameVariance: GameVariancePriors): readonly BoardEntry[] {
  return preseasonBoard(preseasonCandidates(inputs, SHIPPED_PRESEASON_FEATURES, PRIORS), {
    season: inputs.season,
    asOf: inputs.moment,
    rules: PPR_SCORING,
    shape: SHAPE,
    gameVariance,
  });
}

async function subjectsFor(
  db: ReadonlyDb,
  season: number,
  names: ReadonlyMap<string, string>,
): Promise<{
  subjects: readonly Subject[];
  everyone: readonly Subject[];
  ranks: ReadonlyMap<string, ReadonlyMap<string, number>>;
}> {
  // Fix round I3: `gradableInputs` is the convergence point every grading script calls through,
  // immediately after `loadPreseason` — see its own docblock in `preseason/scorecard.ts`.
  const inputs = gradableInputs(await loadPreseason(db, season));
  const positions = await allPositions(db);
  const { points: actual, games: actualGames } = await actualSeasonPoints(db, season, positions);
  const board = buildBoard(inputs, await loadShippedGameVariance(db));
  const rosterByPlayer = new Map(inputs.roster.map((row) => [row.playerId, row] as const));

  // Last season's outcome, for the "the market is chasing last year" segments. Read through the
  // preseason gate like everything else: it is a fact about a completed season, so it passes.
  const priorLines = await statLinesAsOf(db, { season: season - 1, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: inputs.moment });
  const priorPoints = new Map<string, number>();
  for (const row of priorLines) {
    const position = positions.get(row.line.playerId);
    if (position === undefined) continue;
    priorPoints.set(row.line.playerId, (priorPoints.get(row.line.playerId) ?? 0) + computeFantasyPoints(row.line, position, PPR_SCORING));
  }
  const priorUsage = await usageAsOf(db, { season: season - 1, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: inputs.moment });
  const priorGames = new Map<string, number>();
  for (const row of priorUsage) priorGames.set(row.playerId, (priorGames.get(row.playerId) ?? 0) + 1);

  const priorTeams = new Map<string, { season: number; week: number; team: string }>();
  for (const row of inputs.priorPlayerTeams) {
    const known = priorTeams.get(row.playerId);
    if (known !== undefined && (known.season > row.season || (known.season === row.season && known.week >= row.week))) continue;
    priorTeams.set(row.playerId, { season: row.season, week: row.week, team: row.team });
  }

  const subjects: Subject[] = [];
  const everyone: Subject[] = [];
  for (const entry of board) {
    const scored = actual.get(entry.playerId);
    const roster = rosterByPlayer.get(entry.playerId);
    const previous = priorTeams.get(entry.playerId);
    const subject: Subject = {
      playerId: entry.playerId,
      name: names.get(entry.playerId) ?? entry.playerId,
      position: entry.position,
      // ZERO for a man who never dressed. `news/adjust.ts` makes the same choice for the same
      // reason: everywhere else in this engine an absent row means "no evidence" and is skipped,
      // but a calibration question asks how much football a group played and a man who played none
      // played none. Section A to D keep the report's own population — players with a stat line —
      // because that is the scoreboard those numbers are compared against; sections E and F use
      // this one, because a games model scored only on the men who played would be scored on the
      // subset whose games it got right.
      actual: scored ?? 0,
      actualGames: actualGames.get(entry.playerId) ?? 0,
      projected: entry.projectedPoints,
      expectedGames: entry.expectedGames,
      perGame: entry.expectedGames > 0 ? entry.projectedPoints / entry.expectedGames : 0,
      rookie: roster?.draftYear === season,
      experience: roster?.draftYear == null ? null : season - roster.draftYear + 1,
      status: roster?.status ?? "unknown",
      changedTeam: previous !== undefined && previous.team !== entry.team,
      age: roster === undefined ? null : ageAtSeason(roster.birthDate, season),
      priorGames: priorGames.get(entry.playerId) ?? null,
      priorPoints: priorPoints.get(entry.playerId) ?? null,
    };
    everyone.push(subject);
    if (scored !== undefined) subjects.push(subject);
  }

  const ranks = new Map<string, ReadonlyMap<string, number>>();
  for (const [label, source] of Object.entries(BENCHMARK_SOURCES)) {
    const published = await preseasonRankingsAsOf(db, { season, source, asOf: FINAL });
    ranks.set(label, new Map(published.map((row) => [row.playerId, row.rank] as const)));
  }
  return { subjects, everyone, ranks };
}

/**
 * SECTION A. The starter band, cut four ways, plus the spread of the outcome inside it.
 *
 * The four cuts are the whole point. Cutting by the benchmark's own rank selects on the
 * BENCHMARK'S predictor, which truncates the benchmark's variance inside the band and only
 * partially truncates ours — so it flatters us, and a loss that survives it is worse than it
 * looks, not better. Cutting by OUR rank does the mirror image. The symmetric cut, on the mean of
 * the two ranks, is the only one that treats the arms alike, and the third-party cut is the only
 * one that treats neither as authoritative.
 */
function sectionA(
  subjects: readonly Subject[],
  benchmark: ReadonlyMap<string, number>,
  label: string,
  third: ReadonlyMap<string, number> | null,
): void {
  const overlap = subjects.filter((subject) => benchmark.has(subject.playerId));
  if (overlap.length === 0) return;
  const ourRank = new Map(
    [...overlap].sort((a, b) => b.projected - a.projected).map((subject, index) => [subject.playerId, index + 1] as const),
  );
  const theirRank = new Map(
    [...overlap]
      .sort((a, b) => benchmark.get(a.playerId)! - benchmark.get(b.playerId)!)
      .map((subject, index) => [subject.playerId, index + 1] as const),
  );

  const cuts: Cut[] = [
    { name: `by ${label}'s own rank`, rankOf: (subject) => benchmark.get(subject.playerId)! },
    { name: "by our own rank", rankOf: (subject) => -subject.projected },
    {
      name: "symmetric (mean rank)",
      rankOf: (subject) => (ourRank.get(subject.playerId)! + theirRank.get(subject.playerId)!) / 2,
    },
  ];
  const overallSd = standardDeviation(overlap.map((subject) => subject.actual));
  console.log(`\n  A. THE BAND, CUT FOUR WAYS: ${label}, like for like on ${overlap.length} players`);
  console.log(`     outcome SD over the whole overlap: ${overallSd === null ? "n/a" : overallSd.toFixed(1)} points`);
  for (const cut of cuts) {
    const bands = bandsOf(overlap, cut);
    const parts = RANK_BANDS.map((band) => {
      const members = bands.get(band.name)!;
      if (members.length < 2) return `${band.name}: too few to report`;
      const ours = rhoOf(members, (subject) => subject.projected);
      const theirs = rhoOf(members, (subject) => -benchmark.get(subject.playerId)!);
      const difference = ours === null || theirs === null ? null : ours - theirs;
      return `${band.name} ${fixed(theirs)} /${fixed(ours)} =${difference === null ? "  n/a" : (difference >= 0 ? "+" : "") + difference.toFixed(4)}`;
    });
    console.log(`     ${cut.name.padEnd(24)} ${parts.join("  ")}`);
  }
  // The third-party cut is run on the PRICED population only. A market board stops at about two
  // hundred names, so cutting the whole overlap by it would tie every unpriced player at infinity
  // and sort the deep and fringe bands by nothing at all — a cut that reports a number for a band it
  // did not actually order. Restricted, it orders every man it holds, and the two bands it can fill
  // are exactly the two under argument.
  if (third !== null) {
    const priced = overlap.filter((subject) => third.has(subject.playerId));
    if (priced.length >= 60) {
      const bands = bandsOf(priced, { name: "third", rankOf: (subject) => third.get(subject.playerId)! });
      const parts = (["elite", "starter"] as const).map((name) => {
        const members = bands.get(name)!;
        const ours = rhoOf(members, (subject) => subject.projected);
        const theirs = rhoOf(members, (subject) => -benchmark.get(subject.playerId)!);
        const difference = ours === null || theirs === null ? null : ours - theirs;
        return `${name} ${fixed(theirs)} /${fixed(ours)} =${difference === null ? "  n/a" : (difference >= 0 ? "+" : "") + difference.toFixed(4)}`;
      });
      console.log(`     ${`by a third party (n=${priced.length})`.padEnd(24)} ${parts.join("  ")}`);
    }
  }
  console.log(`     (each cell reads: ${label} rho / our rho = our margin)`);

  const bands = bandsOf(overlap, cuts[0]!);
  const restriction = RANK_BANDS.map((band) => {
    const members = bands.get(band.name)!;
    const sd = standardDeviation(members.map((subject) => subject.actual));
    return `${band.name} n=${String(members.length).padStart(3)} sd=${sd === null ? "n/a" : sd.toFixed(1).padStart(5)}`;
  });
  console.log(`     outcome spread inside each band (cut 1): ${restriction.join("  ")}`);
}

/**
 * SECTION B. Which half of `games x per-game` is wrong, bounded by replacing each half with truth.
 *
 * The oracle arms are not proposals — nobody can know a player's games in August. They are the
 * ceiling each half of the product could contribute if it were solved perfectly, which is the only
 * honest way to decide which half is worth a season of work.
 */
function sectionB(subjects: readonly Subject[], benchmark: ReadonlyMap<string, number>, label: string): void {
  const overlap = subjects.filter((subject) => benchmark.has(subject.playerId));
  if (overlap.length === 0) return;
  const bands = bandsOf(overlap, { name: label, rankOf: (subject) => benchmark.get(subject.playerId)! });
  console.log(`\n  B. WHICH HALF OF (games x per-game) IS WRONG: bands cut by ${label}'s rank`);
  const rows: { readonly name: string; readonly value: (subject: Subject) => number }[] = [
    { name: `${label} (the arm to beat)`, value: (subject) => -benchmark.get(subject.playerId)! },
    { name: "the board, as shipped", value: (subject) => subject.projected },
    { name: "oracle games x our rate", value: (subject) => subject.perGame * subject.actualGames },
    { name: "our games x oracle rate", value: (subject) => subject.expectedGames * (subject.actualGames > 0 ? subject.actual / subject.actualGames : 0) },
    { name: "per-game rate alone", value: (subject) => subject.perGame },
    { name: "expected games alone", value: (subject) => subject.expectedGames },
    { name: "last season's points", value: (subject) => subject.priorPoints ?? -1 },
  ];
  for (const row of rows) {
    const parts = RANK_BANDS.map((band) => {
      const members = bands.get(band.name)!;
      return `${band.name} ${fixed(members.length < 2 ? null : rhoOf(members, row.value))}`;
    });
    console.log(`     ${row.name.padEnd(24)} overall ${fixed(rhoOf(overlap, row.value))}   ${parts.join("  ")}`);
  }
}

/** SECTION C. Who, inside the losing band. */
function sectionC(subjects: readonly Subject[], benchmark: ReadonlyMap<string, number>, label: string): void {
  const overlap = subjects.filter((subject) => benchmark.has(subject.playerId));
  if (overlap.length === 0) return;
  const bands = bandsOf(overlap, { name: label, rankOf: (subject) => benchmark.get(subject.playerId)! });
  const starters = bands.get("starter")!;
  if (starters.length < 4) return;

  console.log(`\n  C. INSIDE THE STARTER BAND (n=${starters.length}), cut by position and by situation`);
  const segments: { readonly name: string; readonly members: readonly Subject[] }[] = [
    ...SCORED.map((position) => ({ name: position as string, members: starters.filter((subject) => subject.position === position) })),
    { name: "rookies", members: starters.filter((subject) => subject.rookie) },
    { name: "changed team", members: starters.filter((subject) => subject.changedTeam && !subject.rookie) },
    { name: "missed 5+ games last yr", members: starters.filter((subject) => !subject.rookie && subject.priorGames !== null && subject.priorGames <= teamGamesIn(2024) - 5) },
    { name: "thin history (<8 games)", members: starters.filter((subject) => !subject.rookie && (subject.priorGames ?? 0) < 8) },
    { name: "steady (none of these)", members: starters.filter((subject) => !subject.rookie && !subject.changedTeam && (subject.priorGames ?? 0) >= 13) },
  ];
  for (const segment of segments) {
    if (segment.members.length < 3) {
      console.log(`     ${segment.name.padEnd(24)} n=${String(segment.members.length).padStart(3)}   (too few to score)`);
      continue;
    }
    const ours = rhoOf(segment.members, (subject) => subject.projected);
    const theirs = rhoOf(segment.members, (subject) => -benchmark.get(subject.playerId)!);
    const difference = ours === null || theirs === null ? null : ours - theirs;
    console.log(
      `     ${segment.name.padEnd(24)} n=${String(segment.members.length).padStart(3)}   ${label} ${fixed(theirs)}   ours ${fixed(ours)}   ` +
        `${difference === null ? "n/a" : (difference >= 0 ? "+" : "") + difference.toFixed(4)}`,
    );
  }

  // The individual misses: ordered by how much rank the benchmark got right that we did not.
  const withinOurs = new Map(
    [...starters].sort((a, b) => b.projected - a.projected).map((subject, index) => [subject.playerId, index + 1] as const),
  );
  const withinTheirs = new Map(
    [...starters]
      .sort((a, b) => benchmark.get(a.playerId)! - benchmark.get(b.playerId)!)
      .map((subject, index) => [subject.playerId, index + 1] as const),
  );
  const withinActual = new Map(
    [...starters].sort((a, b) => b.actual - a.actual).map((subject, index) => [subject.playerId, index + 1] as const),
  );
  const scored = starters
    .map((subject) => ({
      subject,
      cost:
        Math.abs(withinOurs.get(subject.playerId)! - withinActual.get(subject.playerId)!) -
        Math.abs(withinTheirs.get(subject.playerId)! - withinActual.get(subject.playerId)!),
    }))
    .sort((a, b) => b.cost - a.cost);
  console.log(`\n     the 15 players ${label} placed well and we did not (rank cost, inside the band)`);
  for (const { subject, cost } of scored.slice(0, 15)) {
    console.log(
      `       cost ${String(cost).padStart(3)}  ${subject.position} ${subject.name.padEnd(22)}` +
        `ours #${String(withinOurs.get(subject.playerId)).padStart(3)}  ${label} #${String(withinTheirs.get(subject.playerId)).padStart(3)}  ` +
        `actual #${String(withinActual.get(subject.playerId)).padStart(3)}  ` +
        `proj ${subject.projected.toFixed(0).padStart(3)} = ${subject.perGame.toFixed(1)}/g x ${subject.expectedGames.toFixed(1)}g   ` +
        `actual ${subject.actual.toFixed(0).padStart(3)} in ${String(subject.actualGames).padStart(2)}g` +
        `${subject.rookie ? "  [rookie]" : ""}${subject.changedTeam ? "  [moved]" : ""}`,
    );
  }
}

/**
 * SECTION D. Where the market is systematically wrong.
 *
 * Every segment here is knowable in August WITHOUT reading a market, because a segment defined by
 * the market's own error is a segment we could never act on. The quantity reported is the mean
 * signed rank residual: the market's rank minus the outcome's rank, inside the population the
 * market prices. A positive number means the market ranked the segment WORSE than it finished —
 * the market is systematically too low on it — and a negative number means the reverse.
 */
function sectionD(subjects: readonly Subject[], adp: ReadonlyMap<string, number>): void {
  const priced = subjects.filter((subject) => adp.has(subject.playerId));
  if (priced.length < 20) return;
  const marketRank = new Map(
    [...priced].sort((a, b) => adp.get(a.playerId)! - adp.get(b.playerId)!).map((subject, index) => [subject.playerId, index + 1] as const),
  );
  const ourRank = new Map(
    [...priced].sort((a, b) => b.projected - a.projected).map((subject, index) => [subject.playerId, index + 1] as const),
  );
  const actualRank = new Map(
    [...priced].sort((a, b) => b.actual - a.actual).map((subject, index) => [subject.playerId, index + 1] as const),
  );

  console.log(`\n  D. WHERE THE MARKET IS SYSTEMATICALLY WRONG: ${priced.length} priced players`);
  console.log(`     residual = mean(market rank - outcome rank); positive means the market was TOO LOW on the segment`);
  const segments: { readonly name: string; readonly members: readonly Subject[] }[] = [
    ...SCORED.map((position) => ({ name: position as string, members: priced.filter((subject) => subject.position === position) })),
    { name: "rookies", members: priced.filter((subject) => subject.rookie) },
    { name: "changed team", members: priced.filter((subject) => subject.changedTeam && !subject.rookie) },
    { name: "missed 5+ games last yr", members: priced.filter((subject) => !subject.rookie && subject.priorGames !== null && subject.priorGames <= 12) },
    { name: "played 16+ last yr", members: priced.filter((subject) => (subject.priorGames ?? 0) >= 16) },
    { name: "age <= 24", members: priced.filter((subject) => subject.age !== null && subject.age <= 24) },
    { name: "age 25-28", members: priced.filter((subject) => subject.age !== null && subject.age > 24 && subject.age <= 28) },
    { name: "age >= 29", members: priced.filter((subject) => subject.age !== null && subject.age >= 29) },
    { name: "no prior season", members: priced.filter((subject) => subject.priorPoints === null) },
  ];
  for (const segment of segments) {
    if (segment.members.length < 4) {
      console.log(`     ${segment.name.padEnd(24)} n=${String(segment.members.length).padStart(3)}   (too few)`);
      continue;
    }
    const residual =
      segment.members.reduce((sum, subject) => sum + (marketRank.get(subject.playerId)! - actualRank.get(subject.playerId)!), 0) /
      segment.members.length;
    const oursResidual =
      segment.members.reduce((sum, subject) => sum + (ourRank.get(subject.playerId)! - actualRank.get(subject.playerId)!), 0) /
      segment.members.length;
    console.log(
      `     ${segment.name.padEnd(24)} n=${String(segment.members.length).padStart(3)}   market ${(residual >= 0 ? "+" : "") + residual.toFixed(1).padStart(6)}   ` +
        `ours ${(oursResidual >= 0 ? "+" : "") + oursResidual.toFixed(1).padStart(6)}`,
    );
  }

  // Where we disagree with the price, who was right? The only test of a board's independent value.
  console.log(`\n     WHEN WE DISAGREE WITH THE PRICE, WHO IS RIGHT (mean |rank error| on each side)`);
  for (const threshold of [0, 20, 40, 60]) {
    const disagreements = priced.filter(
      (subject) => Math.abs(ourRank.get(subject.playerId)! - marketRank.get(subject.playerId)!) > threshold,
    );
    if (disagreements.length < 5) continue;
    const marketError =
      disagreements.reduce((sum, subject) => sum + Math.abs(marketRank.get(subject.playerId)! - actualRank.get(subject.playerId)!), 0) /
      disagreements.length;
    const ourError =
      disagreements.reduce((sum, subject) => sum + Math.abs(ourRank.get(subject.playerId)! - actualRank.get(subject.playerId)!), 0) /
      disagreements.length;
    const higher = disagreements.filter((subject) => ourRank.get(subject.playerId)! < marketRank.get(subject.playerId)!);
    const lower = disagreements.filter((subject) => ourRank.get(subject.playerId)! > marketRank.get(subject.playerId)!);
    const meanCost = (members: readonly Subject[], side: 1 | -1): string => {
      if (members.length === 0) return "n/a";
      const won =
        members.reduce(
          (sum, subject) =>
            sum +
            (Math.abs(marketRank.get(subject.playerId)! - actualRank.get(subject.playerId)!) -
              Math.abs(ourRank.get(subject.playerId)! - actualRank.get(subject.playerId)!)),
          0,
        ) / members.length;
      return `${side === 1 ? "we are higher" : "we are lower"} n=${members.length} we win by ${won.toFixed(1)} ranks`;
    };
    console.log(
      `       |disagreement| > ${String(threshold).padStart(2)}: n=${String(disagreements.length).padStart(3)}  ` +
        `market ${marketError.toFixed(1).padStart(5)}  ours ${ourError.toFixed(1).padStart(5)}   ${meanCost(higher, 1)} | ${meanCost(lower, -1)}`,
    );
  }
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * SECTION E. Is the games model CALIBRATED, cell by cell?
 *
 * A rank correlation cannot see a bias: a games model that is uniformly two games too low orders
 * players perfectly. What it cannot survive is a bias that differs BETWEEN cells, because that
 * reorders every player in one cell against every player in another. So each cell is asked the only
 * question that matters — did the men in it play as many games as the model said — and the answer
 * is a number of games, not a correlation.
 */
function sectionE(subjects: readonly Subject[], teamGames: number): void {
  console.log(`\n  E. IS THE GAMES MODEL CALIBRATED? mean expected against mean actual, by cell`);
  const groups: { readonly name: string; readonly members: readonly Subject[] }[] = [
    ...["active", "reserve", "practice_squad"].map((status) => ({
      name: `status ${status}`,
      members: subjects.filter((subject) => subject.status === status),
    })),
    { name: "prior 16+ games", members: subjects.filter((subject) => (subject.priorGames ?? 0) >= 16) },
    { name: "prior 13-15", members: subjects.filter((subject) => (subject.priorGames ?? 0) >= 13 && (subject.priorGames ?? 0) < 16) },
    { name: "prior 8-12", members: subjects.filter((subject) => (subject.priorGames ?? 0) >= 8 && (subject.priorGames ?? 0) < 13) },
    { name: "prior 1-7", members: subjects.filter((subject) => (subject.priorGames ?? 0) >= 1 && (subject.priorGames ?? 0) < 8) },
    { name: "age <= 24", members: subjects.filter((subject) => subject.age !== null && subject.age <= 24) },
    { name: "age 25-28", members: subjects.filter((subject) => subject.age !== null && subject.age > 24 && subject.age <= 28) },
    { name: "age >= 29", members: subjects.filter((subject) => subject.age !== null && subject.age >= 29) },
  ];
  for (const group of groups) {
    if (group.members.length < 5) {
      console.log(`     ${group.name.padEnd(20)} n=${String(group.members.length).padStart(4)}   (too few)`);
      continue;
    }
    const expected = mean(group.members.map((subject) => subject.expectedGames))!;
    const actual = mean(group.members.map((subject) => subject.actualGames))!;
    console.log(
      `     ${group.name.padEnd(20)} n=${String(group.members.length).padStart(4)}   expected ${expected.toFixed(1).padStart(5)}` +
        `   actual ${actual.toFixed(1).padStart(5)}   bias ${(expected - actual >= 0 ? "+" : "") + (expected - actual).toFixed(2)}` +
        `   (of ${teamGames})`,
    );
  }
}

/**
 * SECTION F. Is the PER-GAME rate calibrated, by how long a man has been in the league?
 *
 * The rate is the half section B says carries the larger error, and experience is the axis the
 * engine has no term on at all: every rate it emits is a shrunk average of a player's own past,
 * which by construction cannot know that a second-year receiver is a different player from the one
 * who played last September. Restricted to men who actually played, because a per-game rate over
 * two appearances is a number about an injury rather than about a player.
 */
function sectionF(subjects: readonly Subject[]): void {
  const played = subjects.filter((subject) => subject.actualGames >= 6);
  console.log(`\n  F. IS THE PER-GAME RATE CALIBRATED? by season in the league (n=${played.length} with 6+ games)`);
  const buckets: { readonly name: string; readonly test: (subject: Subject) => boolean }[] = [
    { name: "year 1 (rookie)", test: (subject) => subject.experience === 1 },
    { name: "year 2", test: (subject) => subject.experience === 2 },
    { name: "year 3", test: (subject) => subject.experience === 3 },
    { name: "year 4-6", test: (subject) => subject.experience !== null && subject.experience >= 4 && subject.experience <= 6 },
    { name: "year 7+", test: (subject) => subject.experience !== null && subject.experience >= 7 },
  ];
  for (const bucket of buckets) {
    const members = played.filter(bucket.test);
    if (members.length < 5) {
      console.log(`     ${bucket.name.padEnd(20)} n=${String(members.length).padStart(4)}   (too few)`);
      continue;
    }
    const projected = mean(members.map((subject) => subject.perGame))!;
    const actual = mean(members.map((subject) => subject.actual / subject.actualGames))!;
    console.log(
      `     ${bucket.name.padEnd(20)} n=${String(members.length).padStart(4)}   projected ${projected.toFixed(2).padStart(6)}/g` +
        `   actual ${actual.toFixed(2).padStart(6)}/g   ratio ${(projected / actual).toFixed(3)}`,
    );
  }
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );

  for (const season of TARGET_SEASONS) {
    const { subjects, everyone, ranks } = await subjectsFor(db, season, names);
    const ecr = ranks.get("ecr") ?? new Map<string, number>();
    const adp = ranks.get("adp") ?? new Map<string, number>();
    console.log(`\n${"=".repeat(112)}`);
    console.log(`${season} DIAGNOSIS: ${subjects.length} of ${everyone.length} board players with an outcome, ${ecr.size} ECR ranks, ${adp.size} ADP prices`);
    console.log(`${"=".repeat(112)}`);

    sectionA(subjects, ecr, "ECR", adp.size > 0 ? adp : null);
    sectionB(subjects, ecr, "ECR");
    sectionC(subjects, ecr, "ECR");
    sectionD(subjects, adp);
    sectionE(everyone, teamGamesIn(season));
    sectionF(everyone);
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
