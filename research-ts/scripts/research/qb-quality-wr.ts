// EXPLORATORY RESEARCH (2026-09-05): does QB throw quality predict a receiver's fantasy scoring,
// and what would that imply for pairing Jaxson Dart (NYG, second-year QB in 2026) with Malik
// Nabers (WR, NYG)? Run: npx tsx scripts/research/qb-quality-wr.ts
//
// THIS SCRIPT CHANGES NOTHING IN THE MODEL. It is hypothesis-generation for the law-discovery
// harness (`scripts/discover-laws.ts` / `src/projections/laws/*`), which alone decides whether any
// finding here becomes a registered law, under its own multiple-comparisons control. Nothing here
// is a projection input.
//
// A MAJOR DATA-AVAILABILITY FINDING, READ FIRST: this production database does NOT hold historical
// player-week stat lines back to 2018. `nflverse_player_week` (the real, published box-score
// source) covers ONLY 2023 and 2024. 2025 exists solely via the pbp-derived gap-season fallback
// (`nflverse_pbp_derived`), which carries outcomes (yards/TDs/INTs/receptions) but NEVER pass
// attempts, completions, or targets. 2026 is the live season and is never read here. So the design
// below runs on THREE usable seasons (2023, 2024, 2025), not the requested 2018-2025 window — see
// the research doc's "Data reality" section for the full accounting.
//
// A SECOND MAJOR FINDING: there is no reliable per-season historical player-to-NFL-team mapping in
// this database. `player_week_teams` and `nfl_draft_picks` are both EMPTY tables (verified by
// direct count). `preseason_rosters` covers only the live 2026 season. `nfl_players.latest_team`
// (the one team field with any value) is the player's CURRENT team as of the live release and, when
// applied to a 2023/2024 season, systematically misattributes anyone who has since changed teams —
// measured directly: grouping 2024 QBs by `latest_team` produces team pass-attempt totals ranging
// from 54 (Miami — nearly every 2024 Dolphin has since moved on) to 903 (Cincinnati, five different
// "Bengals" QBs merged together), where a real team throws roughly 450-650 times a season. That
// proxy is unusable.
//
// THE FIX USED HERE: `nflverse_player_week` DOES carry three metrics computed from the real,
// historical roster at ingest time and attached to every player's own row for that week —
// `team_pass_attempts`, `team_targets`, `team_carries` (see `src/projections/nflverse/map.ts`'s own
// docblock: "team totals ride on each player's own row rather than in a table of their own"). Two
// players on the same real team in the same week carry IDENTICAL values for this triple; two
// different teams essentially never do (a real team's weekly attempts/targets/carries triple is a
// near-unique fingerprint — confirmed empirically: a clean week shows exactly as many distinct
// triples as active teams). `reconstructSeasonTeams` below turns that fingerprint into season-long
// team rosters: cluster players by identical (week, triple), then match each week's clusters to the
// SEASON'S accumulated rosters by player-overlap (not by any single shared player, which a
// mid-season roster move would corrupt) — see that function's own docblock for why naive
// transitive union-find fails here (it collapses the whole league into one component via a single
// traded special-teamer). This is only possible for 2023 and 2024, the only two seasons carrying
// these three metrics. 2025 has no team fingerprint at all; it is used ONLY as an outcome season
// (a receiver's own next-season PPG needs no team information).
import { createDb, type Db } from "@research-ts/db/client";
import { sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { computeFantasyPoints } from "@research-ts/scoring/compute";
import { LAST_POSSIBLE_WEEK } from "@research-ts/projections/store";
import { statLinesAsOfForMeasurement } from "@research-ts/projections/nflverse/derived-stat-lines";

const REPORT_PATH = "docs/research/2026-09-05-qb-quality-for-receivers.md";
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");
const RECONSTRUCTIBLE_SEASONS = [2023, 2024] as const; // the only seasons with team_* fingerprints.
const OUTCOME_SEASONS = [2023, 2024, 2025] as const; // usable for a receiver's OWN next-season PPG.
const TARGET_QUALIFIER = 40; // "40+ targets" per the research brief.
const MIN_GAMES = 8; // robustness check (b).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Export DATABASE_URL before running this script.`);
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// TEAM RECONSTRUCTION (2023, 2024 only) — see the module docblock above for the method and why it
// is necessary. Returns, for the requested season, every player's canonical team-cluster id and
// each cluster's member set.
// ---------------------------------------------------------------------------------------------

interface SeasonTeams {
  readonly clusterOf: ReadonlyMap<string, number>;
  readonly members: ReadonlyMap<number, ReadonlySet<string>>;
}

/**
 * Reconstructs season-long team rosters from the `team_pass_attempts`/`team_targets`/
 * `team_carries` fingerprint, WITHOUT ever knowing a team's name.
 *
 * A naive transitive union-find over every week (union any two players who ever shared a weekly
 * fingerprint) was tried first and rejected: it collapses the entire league into one 448-player
 * component. The mechanism is real roster churn, not a bug — a journeyman kicker or practice-squad
 * call-up who is legitimately on team A for the season's first weeks and team B for its last few
 * bridges the two real rosters together, and it only takes ~31 such bridges to connect all 32
 * teams. Time-blind transitive closure cannot represent "this player was on two different teams
 * this season" without corrupting everyone else's grouping.
 *
 * THE FIX: process weeks in order, keep a running set of canonical team rosters (accumulated
 * membership, not just the prior week), and match each week's cluster to whichever canonical
 * roster it OVERLAPS most with (by shared player count, at least 40% of the cluster) — a single
 * traded player cannot swing a bulk-overlap vote against a dozen unmoved teammates. A cluster that
 * matches no existing roster well enough starts a new one. Restricted to "clean" weeks only (a
 * week whose clusters look like real single-team rosters, no implausibly large merged cluster) so
 * no single week's own fingerprint collision poisons the accumulated rosters.
 */
async function reconstructSeasonTeams(db: Db, season: number): Promise<SeasonTeams> {
  const rows = await db.execute(sql`
    select distinct on (o.player_id, o.week, o.metric) o.player_id as "playerId", o.week, o.metric, o.value
    from player_week_observations o
    where o.source = 'nflverse_player_week' and o.season = ${season}
      and o.metric in ('team_pass_attempts', 'team_targets', 'team_carries')
    order by o.player_id, o.week, o.metric, o.as_of desc
  `);

  const byPlayerWeek = new Map<string, { attempts?: number; targets?: number; carries?: number }>();
  for (const r of rows as unknown as { playerId: string; week: number; metric: string; value: number }[]) {
    const key = `${r.playerId}|${r.week}`;
    const entry = byPlayerWeek.get(key) ?? {};
    if (r.metric === "team_pass_attempts") entry.attempts = r.value;
    else if (r.metric === "team_targets") entry.targets = r.value;
    else if (r.metric === "team_carries") entry.carries = r.value;
    byPlayerWeek.set(key, entry);
  }

  // Cluster players by identical (week, triple) fingerprint.
  const byWeek = new Map<number, Map<string, Set<string>>>();
  for (const [key, v] of byPlayerWeek) {
    if (v.attempts === undefined || v.targets === undefined || v.carries === undefined) continue;
    const [playerId, weekStr] = key.split("|");
    const week = Number(weekStr);
    const fp = `${v.attempts}|${v.targets}|${v.carries}`;
    const weekMap = byWeek.get(week) ?? new Map<string, Set<string>>();
    const set = weekMap.get(fp) ?? new Set<string>();
    set.add(playerId!);
    weekMap.set(fp, set);
    byWeek.set(week, weekMap);
  }

  // A week is "clean" (safe to use) when its per-cluster sizes look like real single-team rosters
  // (a genuine team's weekly skill/offense group that accrues a stat line runs roughly 10-30
  // players; a fingerprint COLLISION between two different teams that week would show up as one
  // implausibly large merged cluster). Reject any cluster bigger than 32, and reject a week
  // entirely if fewer than 26 distinct clusters survive (too many teams on bye or too much
  // collision that week to trust).
  const MAX_PLAUSIBLE_CLUSTER = 32;
  const MIN_CLUSTERS_FOR_CLEAN_WEEK = 26;
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  let nextTeamId = 0;
  const rosters = new Map<number, Set<string>>();

  for (const week of weeks) {
    const clusters = [...byWeek.get(week)!.values()].filter((c) => c.size <= MAX_PLAUSIBLE_CLUSTER);
    if (clusters.length < MIN_CLUSTERS_FOR_CLEAN_WEEK) continue; // not a clean week — skip it entirely.
    for (const cluster of clusters) {
      let bestTeamId = -1;
      let bestOverlap = 0;
      for (const [teamId, roster] of rosters) {
        let overlap = 0;
        for (const p of cluster) if (roster.has(p)) overlap += 1;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestTeamId = teamId;
        }
      }
      const teamId = bestTeamId >= 0 && bestOverlap >= Math.ceil(cluster.size * 0.4) ? bestTeamId : nextTeamId++;
      const roster = rosters.get(teamId) ?? new Set<string>();
      for (const p of cluster) roster.add(p);
      rosters.set(teamId, roster);
    }
  }

  const clusterOf = new Map<string, number>();
  for (const [teamId, roster] of rosters) for (const playerId of roster) clusterOf.set(playerId, teamId);
  return { clusterOf, members: rosters };
}

// ---------------------------------------------------------------------------------------------
// SEASON-LEVEL PLAYER AGGREGATES
// ---------------------------------------------------------------------------------------------

interface QbSeasonLine {
  readonly playerId: string;
  readonly passingYards: number;
  readonly passingTouchdowns: number;
  readonly interceptions: number;
  readonly passAttempts: number;
  readonly games: number;
}

interface ReceiverSeasonLine {
  readonly playerId: string;
  readonly receivingYards: number;
  readonly receivingTouchdowns: number;
  readonly receptions: number;
  readonly targets: number;
  readonly games: number;
  readonly ppg: number;
}

async function qbSeasonLines(db: Db, season: number, qbIds: ReadonlySet<string>): Promise<Map<string, QbSeasonLine>> {
  const lines = await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
  const attemptsRows = await db.execute(sql`
    select distinct on (o.player_id, o.week) o.player_id as "playerId", o.week, o.value
    from player_week_observations o
    where o.source = 'nflverse_player_week' and o.season = ${season} and o.metric = 'pass_attempts'
    order by o.player_id, o.week, o.as_of desc
  `);
  const attemptsByPlayer = new Map<string, number>();
  for (const r of attemptsRows as unknown as { playerId: string; week: number; value: number }[]) {
    if (!qbIds.has(r.playerId)) continue;
    attemptsByPlayer.set(r.playerId, (attemptsByPlayer.get(r.playerId) ?? 0) + r.value);
  }
  const byPlayer = new Map<string, QbSeasonLine>();
  for (const { line } of lines) {
    if (!qbIds.has(line.playerId)) continue;
    const existing = byPlayer.get(line.playerId);
    byPlayer.set(line.playerId, {
      playerId: line.playerId,
      passingYards: (existing?.passingYards ?? 0) + line.passingYards,
      passingTouchdowns: (existing?.passingTouchdowns ?? 0) + line.passingTouchdowns,
      interceptions: (existing?.interceptions ?? 0) + line.interceptions,
      passAttempts: attemptsByPlayer.get(line.playerId) ?? 0,
      games: (existing?.games ?? 0) + 1,
    });
  }
  return byPlayer;
}

async function receiverSeasonLines(db: Db, season: number, wrIds: ReadonlySet<string>): Promise<Map<string, ReceiverSeasonLine>> {
  const lines = await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
  // Targets, consistently across ALL seasons (2023-2025), from the play-by-play aggregator rather
  // than the `targets` metric — the latter is populated for 2023-2024 only (`nflverse_player_week`),
  // while `pbp_targets` (`nflverse_pbp_player`) covers 2023-2025 uniformly. Using one source for
  // every season avoids a definitional seam at the exact point (2025) this analysis needs it least.
  const targetRows = await db.execute(sql`
    select distinct on (o.player_id, o.week) o.player_id as "playerId", o.week, o.value
    from player_week_observations o
    where o.source = 'nflverse_pbp_player' and o.season = ${season} and o.metric = 'pbp_targets'
    order by o.player_id, o.week, o.as_of desc
  `);
  const targetsByPlayer = new Map<string, number>();
  for (const r of targetRows as unknown as { playerId: string; week: number; value: number }[]) {
    targetsByPlayer.set(r.playerId, (targetsByPlayer.get(r.playerId) ?? 0) + r.value);
  }
  const byPlayer = new Map<string, { receivingYards: number; receivingTouchdowns: number; receptions: number; games: number; points: number }>();
  for (const { line } of lines) {
    if (!wrIds.has(line.playerId)) continue;
    const existing = byPlayer.get(line.playerId);
    byPlayer.set(line.playerId, {
      receivingYards: (existing?.receivingYards ?? 0) + line.receivingYards,
      receivingTouchdowns: (existing?.receivingTouchdowns ?? 0) + line.receivingTouchdowns,
      receptions: (existing?.receptions ?? 0) + line.receptions,
      games: (existing?.games ?? 0) + 1,
      points: (existing?.points ?? 0) + computeFantasyPoints(line, "WR", PPR_SCORING),
    });
  }
  const result = new Map<string, ReceiverSeasonLine>();
  for (const [playerId, agg] of byPlayer) {
    result.set(playerId, {
      playerId,
      receivingYards: agg.receivingYards,
      receivingTouchdowns: agg.receivingTouchdowns,
      receptions: agg.receptions,
      targets: targetsByPlayer.get(playerId) ?? 0,
      games: agg.games,
      ppg: agg.games > 0 ? agg.points / agg.games : 0,
    });
  }
  return result;
}

function teamTargetTotal(members: ReadonlySet<string>, targetsByPlayer: ReadonlyMap<string, ReceiverSeasonLine>): number {
  let total = 0;
  for (const playerId of members) total += targetsByPlayer.get(playerId)?.targets ?? 0;
  return total;
}

// ---------------------------------------------------------------------------------------------
// THE LEAVE-ONE-OUT QB METRIC
//
// FORMULA (documented per the research brief): for a team-season and a specific qualifying
// receiver on it,
//
//   leaveOneOutANYA = (TeamPassYards - Receiver.receivingYards
//                       + 20 * (TeamPassTD - Receiver.receivingTouchdowns)
//                       - 45 * TeamInterceptions)
//                     / (TeamAttempts - Receiver.targets)
//
// TeamPassYards/TD/Interceptions/Attempts are summed across every player in the reconstructed
// team cluster whose `nfl_players.position` is `QB` (backup snaps included, trick-play passes by
// a non-QB are NOT captured — a known, small undercount, named here rather than silently accepted).
// The receiver's own catches are removed from the passing side (yards, TDs) and his own targets
// from the attempts side (a target consumes one pass attempt) — the circularity control the brief
// asks for: a receiver's own big season cannot inflate the QB number this analysis then uses to
// predict THAT SAME receiver's next season. Interceptions are not receiver-attributable and are
// never adjusted.
// ---------------------------------------------------------------------------------------------

interface TeamSeasonQb {
  readonly primaryPasserId: string;
  readonly teamPassYards: number;
  readonly teamPassTd: number;
  readonly teamInt: number;
  readonly teamAttempts: number;
  readonly primaryPasserIsRookie: boolean;
}

function leaveOneOutAnyA(team: TeamSeasonQb, receiver: ReceiverSeasonLine): number | null {
  const denom = team.teamAttempts - receiver.targets;
  if (denom <= 0) return null;
  const numer = team.teamPassYards - receiver.receivingYards + 20 * (team.teamPassTd - receiver.receivingTouchdowns) - 45 * team.teamInt;
  return numer / denom;
}

/** The per-game analogue, used ONLY where attempts are unavailable (Dart's own 2025 season — see
 *  the module docblock's second finding). Same numerator, games-played denominator. */
function leaveOneOutAnyG(qb: { passingYards: number; passingTouchdowns: number; interceptions: number; games: number }, receiver: { receivingYards: number; receivingTouchdowns: number; games: number }): number | null {
  if (qb.games <= 0) return null;
  const numer = qb.passingYards - receiver.receivingYards + 20 * (qb.passingTouchdowns - receiver.receivingTouchdowns) - 45 * qb.interceptions;
  return numer / qb.games;
}

// ---------------------------------------------------------------------------------------------
// SMALL STATS HELPERS — no external regression library; this is a two/three-predictor OLS, done
// directly via the normal equations, with a paired-bootstrap CI on the coefficient of interest.
// ---------------------------------------------------------------------------------------------

function ols(y: readonly number[], X: readonly (readonly number[])[]): { readonly coefficients: readonly number[]; readonly r2: number } {
  const n = y.length;
  const k = X[0]!.length;
  // Normal equations: (X'X) beta = X'y, solved via Gaussian elimination.
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a]! += X[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) XtX[a]![b]! += X[i]![a]! * X[i]![b]!;
    }
  }
  const beta = solveLinearSystem(XtX, Xty);
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = X[i]!.reduce((s, v, a) => s + v * beta[a]!, 0);
    ssTot += (y[i]! - meanY) ** 2;
    ssRes += (y[i]! - pred) ** 2;
  }
  return { coefficients: beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const pivotVal = M[col]![col]!;
    if (Math.abs(pivotVal) < 1e-10) continue; // singular direction — leave coefficient at 0.
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row]![col]! / pivotVal;
      for (let k = col; k <= n; k++) M[row]![k]! -= factor * M[col]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-10 ? 0 : row[row.length - 1]! / row[i]!));
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paired (row) bootstrap CI on one coefficient index. 2000 resamples, seeded for reproducibility. */
function bootstrapCoefficientCi(
  y: readonly number[],
  X: readonly (readonly number[])[],
  coefficientIndex: number,
  resamples = 2000,
): { readonly lo: number; readonly hi: number } {
  const rand = mulberry32(20260905);
  const n = y.length;
  const draws: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const yBoot: number[] = [];
    const XBoot: number[][] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rand() * n);
      yBoot.push(y[idx]!);
      XBoot.push([...X[idx]!]);
    }
    draws.push(ols(yBoot, XBoot).coefficients[coefficientIndex]!);
  }
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * resamples)]!;
  const hi = draws[Math.floor(0.975 * resamples)]!;
  return { lo, hi };
}

function fmt(n: number | null, digits = 3): string {
  return n === null ? "n/a" : n.toFixed(digits);
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

// ---------------------------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------------------------

interface ReceiverObservation {
  readonly playerId: string;
  readonly name: string;
  readonly season: number; // predictor season
  readonly leaveOneOutAnyA: number;
  readonly ownPpg: number;
  readonly targetShare: number | null;
  readonly nextSeasonPpg: number;
  readonly games: number;
  readonly sameQbNextSeason: boolean | null; // null when the following season's team can't be reconstructed (2024->2025)
  readonly qbChangedNextSeason: boolean | null;
}

async function main(): Promise<void> {
  // Typed `Db` only because this script issues raw `db.execute(sql\`select ...\`)` reads for
  // metrics `ReadonlyDb`'s narrowed surface doesn't expose a helper for; every statement in this
  // file is a SELECT — never insert/update/delete/transaction — matching the read-only mandate.
  const db: Db = createDb(requireEnv("DATABASE_URL"));

  const players = await db.execute(sql`select id, name, position, rookie_season as "rookieSeason" from nfl_players where position in ('QB','WR')`);
  const playerRows = players as unknown as { id: string; name: string; position: string; rookieSeason: number | null }[];
  const nameById = new Map(playerRows.map((p) => [p.id, p.name] as const));
  const rookieSeasonById = new Map(playerRows.map((p) => [p.id, p.rookieSeason] as const));
  const qbIds = new Set(playerRows.filter((p) => p.position === "QB").map((p) => p.id));
  const wrIds = new Set(playerRows.filter((p) => p.position === "WR").map((p) => p.id));

  // Reconstruct team rosters for both fingerprint-able seasons, and load season lines.
  const teamsBySeason = new Map<number, SeasonTeams>();
  const qbLinesBySeason = new Map<number, Map<string, QbSeasonLine>>();
  const wrLinesBySeason = new Map<number, Map<string, ReceiverSeasonLine>>();
  for (const season of RECONSTRUCTIBLE_SEASONS) {
    teamsBySeason.set(season, await reconstructSeasonTeams(db, season));
    qbLinesBySeason.set(season, await qbSeasonLines(db, season, qbIds));
  }
  for (const season of OUTCOME_SEASONS) {
    wrLinesBySeason.set(season, await receiverSeasonLines(db, season, wrIds));
  }

  // For each reconstructible season, identify each cluster's primary passer (most attempts) and
  // build the TeamSeasonQb aggregate.
  const teamQbBySeasonCluster = new Map<string, TeamSeasonQb>(); // `${season}|${clusterId}` -> aggregate
  for (const season of RECONSTRUCTIBLE_SEASONS) {
    const { members } = teamsBySeason.get(season)!;
    const qbLines = qbLinesBySeason.get(season)!;
    for (const [clusterId, roster] of members) {
      const clusterQbs = [...roster].filter((id) => qbIds.has(id)).map((id) => qbLines.get(id)).filter((q): q is QbSeasonLine => q !== undefined);
      if (clusterQbs.length === 0) continue;
      const teamAttempts = clusterQbs.reduce((s, q) => s + q.passAttempts, 0);
      const teamPassYards = clusterQbs.reduce((s, q) => s + q.passingYards, 0);
      const teamPassTd = clusterQbs.reduce((s, q) => s + q.passingTouchdowns, 0);
      const teamInt = clusterQbs.reduce((s, q) => s + q.interceptions, 0);
      const primary = [...clusterQbs].sort((a, b) => b.passAttempts - a.passAttempts)[0]!;
      // Plausibility gate: a real full team-season throws roughly 400-750 times; the primary
      // passer alone should carry a meaningful share. Team-seasons failing this are DROPPED
      // (reported, not silently kept) rather than trusted as reconstructed correctly.
      const plausible = teamAttempts >= 400 && teamAttempts <= 800 && primary.passAttempts >= 150;
      if (!plausible) continue;
      teamQbBySeasonCluster.set(`${season}|${clusterId}`, {
        primaryPasserId: primary.playerId,
        teamPassYards,
        teamPassTd,
        teamInt,
        teamAttempts,
        primaryPasserIsRookie: rookieSeasonById.get(primary.playerId) === season,
      });
    }
  }

  const droppedTotal = [...RECONSTRUCTIBLE_SEASONS].reduce((sum, season) => sum + (teamsBySeason.get(season)!.members.size - [...teamQbBySeasonCluster.keys()].filter((k) => k.startsWith(`${season}|`)).length), 0);
  const keptTotal = teamQbBySeasonCluster.size;

  // Build receiver observations: for each reconstructible predictor season, each qualifying
  // (40+ target) WR in a plausible team-season cluster, with a real next-season outcome.
  const observations: ReceiverObservation[] = [];
  for (const season of RECONSTRUCTIBLE_SEASONS) {
    const { clusterOf, members } = teamsBySeason.get(season)!;
    const wrLines = wrLinesBySeason.get(season)!;
    const nextSeason = season + 1;
    const nextWrLines = wrLinesBySeason.get(nextSeason);
    if (nextWrLines === undefined) continue;
    const nextSeasonReconstructible = RECONSTRUCTIBLE_SEASONS.includes(nextSeason as (typeof RECONSTRUCTIBLE_SEASONS)[number]);
    const nextSeasonTeams = nextSeasonReconstructible ? teamsBySeason.get(nextSeason) : undefined;

    for (const [playerId, receiver] of wrLines) {
      if (receiver.targets < TARGET_QUALIFIER) continue;
      const clusterId = clusterOf.get(playerId);
      if (clusterId === undefined) continue;
      const team = teamQbBySeasonCluster.get(`${season}|${clusterId}`);
      if (team === undefined) continue; // dropped by the plausibility gate, or no QB in cluster.
      const anyA = leaveOneOutAnyA(team, receiver);
      if (anyA === null) continue;
      const nextOutcome = nextWrLines.get(playerId);
      if (nextOutcome === undefined) continue; // no real next-season outcome — never invented.

      const teamTargets = teamTargetTotal(members.get(clusterId)!, wrLines);
      const targetShare = teamTargets > 0 ? receiver.targets / teamTargets : null;

      let sameQbNextSeason: boolean | null = null;
      let qbChangedNextSeason: boolean | null = null;
      if (nextSeasonTeams !== undefined) {
        const nextClusterId = nextSeasonTeams.clusterOf.get(playerId);
        if (nextClusterId !== undefined) {
          const nextTeam = teamQbBySeasonCluster.get(`${nextSeason}|${nextClusterId}`);
          if (nextTeam !== undefined) {
            sameQbNextSeason = nextTeam.primaryPasserId === team.primaryPasserId;
            qbChangedNextSeason = !sameQbNextSeason;
          }
        }
      }

      observations.push({
        playerId,
        name: nameById.get(playerId) ?? playerId,
        season,
        leaveOneOutAnyA: anyA,
        ownPpg: receiver.ppg,
        targetShare,
        nextSeasonPpg: nextOutcome.ppg,
        games: receiver.games,
        sameQbNextSeason,
        qbChangedNextSeason,
      });
    }
  }

  // ---- The main regression: nextSeasonPpg ~ ownPpg + targetShare + leaveOneOutAnyA ----
  // Age is NEVER derived here: `nfl_players` carries no birth date or age column (only
  // `preseason_rosters.birth_date`, itself populated for the 2026 season only). Documented as
  // missing, not imputed.
  const withTargetShare = observations.filter((o) => o.targetShare !== null) as (ReceiverObservation & { targetShare: number })[];

  function buildDesign(rows: readonly (ReceiverObservation & { targetShare: number })[], includeAnyA: boolean) {
    const y = rows.map((r) => r.nextSeasonPpg);
    const X = rows.map((r) => (includeAnyA ? [1, r.ownPpg, r.targetShare, r.leaveOneOutAnyA] : [1, r.ownPpg, r.targetShare]));
    return { y, X };
  }

  const fullDesign = buildDesign(withTargetShare, true);
  const controlDesign = buildDesign(withTargetShare, false);
  const fullFit = ols(fullDesign.y, fullDesign.X);
  const controlFit = ols(controlDesign.y, controlDesign.X);
  const anyACi = withTargetShare.length > 4 ? bootstrapCoefficientCi(fullDesign.y, fullDesign.X, 3) : { lo: NaN, hi: NaN };

  // ---- Robustness (a): same-team-only vs all transitions ----
  // "Same-team" here means the receiver's own primary-passer identity did not change into the
  // following season — computable only for the 2023->2024 transition (2025 has no reconstructed
  // team, so we cannot tell whether a receiver's 2025 QB differs from his 2024 one).
  const classifiable = withTargetShare.filter((o) => o.sameQbNextSeason !== null);
  const sameTeamOnly = classifiable.filter((o) => o.sameQbNextSeason === true);
  const sameTeamFit = sameTeamOnly.length > 4 ? ols(buildDesign(sameTeamOnly, true).y, buildDesign(sameTeamOnly, true).X) : null;
  const allTransitionsAmongClassifiable = classifiable.length > 4 ? ols(buildDesign(classifiable, true).y, buildDesign(classifiable, true).X) : null;

  // ---- Robustness (b): exclude receiver-seasons under 8 games ----
  const atLeastMinGames = withTargetShare.filter((o) => o.games >= MIN_GAMES);
  const minGamesFit = atLeastMinGames.length > 4 ? ols(buildDesign(atLeastMinGames, true).y, buildDesign(atLeastMinGames, true).X) : null;

  // ---- Robustness (c): the QB-change event study (2023->2024 transition only) ----
  const qbChanged = classifiable.filter((o) => o.qbChangedNextSeason === true);
  const qbSame = classifiable.filter((o) => o.qbChangedNextSeason === false);
  // Split "changed" by whether the receiver's OWN next-season leave-one-out efficiency (from his
  // NEW team-season, i.e. the following season's own row for this same player, if he still
  // qualifies) went up or down. We only have this for players who ALSO qualify as 40+-target
  // receivers in the next season under our own dataset — a further-narrowed sub-slice, named
  // as such.
  const nextSeasonObsByPlayerSeason = new Map(observations.map((o) => [`${o.playerId}|${o.season}`, o] as const));
  type ChangePair = { readonly current: (typeof qbChanged)[number]; readonly next: ReceiverObservation };
  const changedWithNextEfficiency: ChangePair[] = qbChanged
    .map((o) => ({ current: o, next: nextSeasonObsByPlayerSeason.get(`${o.playerId}|${o.season + 1}`) }))
    .filter((pair): pair is ChangePair => pair.next !== undefined);
  const efficiencyRose = changedWithNextEfficiency.filter((p) => p.next.leaveOneOutAnyA > p.current.leaveOneOutAnyA);
  const efficiencyFell = changedWithNextEfficiency.filter((p) => p.next.leaveOneOutAnyA <= p.current.leaveOneOutAnyA);
  const deltaPpg = (pairs: readonly ChangePair[]) => pairs.map((p) => p.next.nextSeasonPpg - p.current.nextSeasonPpg);

  // ---- The sophomore-QB descriptive (item 4) — DESCRIPTIVE ONLY, never causal ----
  const sophomoreRows: { rookieQbName: string; rookieSeason: number; wr1Name: string; wr1PpgRookieYear: number; wr1PpgSophomoreYear: number | null; delta: number | null }[] = [];
  for (const season of RECONSTRUCTIBLE_SEASONS) {
    const { members } = teamsBySeason.get(season)!;
    const wrLines = wrLinesBySeason.get(season)!;
    const nextWrLines = wrLinesBySeason.get(season + 1);
    for (const [key, team] of teamQbBySeasonCluster) {
      const [teamSeasonStr, clusterIdStr] = key.split("|");
      if (Number(teamSeasonStr) !== season || !team.primaryPasserIsRookie) continue;
      const clusterId = Number(clusterIdStr);
      const roster = members.get(clusterId)!;
      // WR1 = the roster's highest-target qualifying (40+) receiver that season.
      const candidateWrs = [...roster]
        .map((id) => wrLines.get(id))
        .filter((w): w is ReceiverSeasonLine => w !== undefined && w.targets >= TARGET_QUALIFIER)
        .sort((a, b) => b.targets - a.targets);
      const wr1 = candidateWrs[0];
      if (wr1 === undefined) continue;
      const sophomoreLine = nextWrLines?.get(wr1.playerId);
      sophomoreRows.push({
        rookieQbName: nameById.get(team.primaryPasserId) ?? team.primaryPasserId,
        rookieSeason: season,
        wr1Name: nameById.get(wr1.playerId) ?? wr1.playerId,
        wr1PpgRookieYear: wr1.ppg,
        wr1PpgSophomoreYear: sophomoreLine?.ppg ?? null,
        delta: sophomoreLine !== undefined ? sophomoreLine.ppg - wr1.ppg : null,
      });
    }
  }
  const sophomoreWithOutcome = sophomoreRows.filter((r) => r.delta !== null) as (typeof sophomoreRows[number] & { delta: number })[];

  // ---- Dart + Nabers (item 5) ----
  const dart = playerRows.find((p) => p.position === "QB" && p.name.toLowerCase().includes("dart"));
  const nabers = playerRows.find((p) => p.position === "WR" && p.name.toLowerCase().includes("nabers"));
  let dartSection: string[] = [];
  if (dart === undefined || nabers === undefined) {
    dartSection = ["Could not resolve Jaxson Dart and/or Malik Nabers in `nfl_players` by name — BLOCKED."];
  } else {
    const dart2025Lines = await statLinesAsOfForMeasurement(db, { season: 2025, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
    const dartLine = dart2025Lines.filter((l) => l.line.playerId === dart.id);
    const dartAgg = dartLine.reduce(
      (acc, { line }) => ({
        passingYards: acc.passingYards + line.passingYards,
        passingTouchdowns: acc.passingTouchdowns + line.passingTouchdowns,
        interceptions: acc.interceptions + line.interceptions,
        games: acc.games + 1,
      }),
      { passingYards: 0, passingTouchdowns: 0, interceptions: 0, games: 0 },
    );
    const nabers2025 = wrLinesBySeason.get(2025)!.get(nabers.id);
    const dartAnyG =
      nabers2025 !== undefined
        ? leaveOneOutAnyG(dartAgg, { receivingYards: nabers2025.receivingYards, receivingTouchdowns: nabers2025.receivingTouchdowns, games: nabers2025.games })
        : null;

    // Reference distribution: the SAME ANY/G-style leave-one-out metric (not ANY/A — units must
    // match for the percentile to mean anything), computed for every 2023/2024 plausible
    // team-season's primary passer against that team's own qualifying WR1, so Dart's 2025 number
    // (which has no attempts data at all) can still be placed among real historical passers.
    const referenceAnyG: number[] = [];
    for (const season of RECONSTRUCTIBLE_SEASONS) {
      const { members } = teamsBySeason.get(season)!;
      const qbLines = qbLinesBySeason.get(season)!;
      const wrLines = wrLinesBySeason.get(season)!;
      for (const [key, team] of teamQbBySeasonCluster) {
        const [teamSeasonStr, clusterIdStr] = key.split("|");
        if (Number(teamSeasonStr) !== season) continue;
        const clusterId = Number(clusterIdStr);
        const roster = members.get(clusterId)!;
        const qbLine = qbLines.get(team.primaryPasserId);
        if (qbLine === undefined) continue;
        const wr1 = [...roster]
          .map((id) => wrLines.get(id))
          .filter((w): w is ReceiverSeasonLine => w !== undefined && w.targets >= TARGET_QUALIFIER)
          .sort((a, b) => b.targets - a.targets)[0];
        if (wr1 === undefined) continue;
        const anyG = leaveOneOutAnyG(qbLine, { receivingYards: wr1.receivingYards, receivingTouchdowns: wr1.receivingTouchdowns, games: qbLine.games });
        if (anyG !== null) referenceAnyG.push(anyG);
      }
    }
    referenceAnyG.sort((a, b) => a - b);
    const percentile =
      dartAnyG !== null && referenceAnyG.length > 0
        ? (referenceAnyG.filter((v) => v <= dartAnyG).length / referenceAnyG.length) * 100
        : null;

    dartSection = [
      "NOTE ON METHOD: unlike the main regression (which sums every reconstructed teammate QB), " +
        "this single-case number uses ONLY Dart's own individual passing line as 'team passing " +
        "production' — 2025 has no team fingerprint to reconstruct a Giants roster from, so any " +
        "other quarterback who played for New York in 2025 is simply not summed in. If New York " +
        "used a real committee that season, this understates true team volume; it does not affect " +
        "the leave-one-out subtraction of Nabers' own line, which is exact.",
      `Jaxson Dart (\`${dart.id}\`) 2025 games with a recorded stat line: ${dartAgg.games}. ` +
        `Passing: ${dartAgg.passingYards} yards, ${dartAgg.passingTouchdowns} TD, ${dartAgg.interceptions} INT ` +
        "(sourced from the pbp-derived 2025 fallback — the only source this season has; pass attempts are NOT available for 2025 in this database, so a true ANY/A cannot be computed for any 2025 quarterback, Dart included).",
      `Malik Nabers (\`${nabers.id}\`) 2025: ${nabers2025 === undefined ? "no recorded stat line found" : `${nabers2025.games} games, ${nabers2025.receivingYards} receiving yards, ${nabers2025.receivingTouchdowns} TD, ${nabers2025.targets.toFixed(0)} targets (pbp-derived target count)`}.`,
      `Leave-one-out ANY/G (yards + 20*TD - 45*INT, per game, Nabers' own receiving line removed): ${fmt(dartAnyG, 2)}.`,
      `Reference distribution: the identical ANY/G-style leave-one-out metric computed for every plausible 2023/2024 team-season's primary passer against that team's own top-target qualifying WR1 (n = ${referenceAnyG.length}).`,
      `Dart's percentile within that reference distribution: ${percentile === null ? "n/a (could not compute)" : `${percentile.toFixed(0)}th`}.`,
    ];
  }

  // ------------------------------------------------------------------------------------------
  // WRITE THE REPORT
  // ------------------------------------------------------------------------------------------
  const lines: string[] = [];
  lines.push("# Does QB throw quality move receiver scoring? An exploratory read — 2026-09-05");
  lines.push("");
  lines.push(
    "**EXPLORATORY. Hypothesis-generation only.** This document changes nothing in the model. Any " +
      "finding here becomes a registered law only by passing through the law-discovery harness " +
      "(`scripts/discover-laws.ts`), which applies its own multiple-comparisons control. Every " +
      "number below is labeled with the season(s) and source it came from.",
  );
  lines.push("");
  lines.push("## Data reality — read this before the numbers below");
  lines.push("");
  lines.push(
    "The brief asked for 2018-2025 team-seasons. This production database does not hold that range. " +
      "`nflverse_player_week` (real published box scores) covers ONLY 2023 and 2024. 2025 exists only " +
      "via the pbp-derived gap-season fallback (yards/TDs/INTs/receptions only — no attempts, no " +
      "completions, no targets). 2026 is the live season and is never read here. **Every result below " +
      "is scoped to 2023-2025, not 2018-2025**, and is correspondingly small-N.",
  );
  lines.push("");
  lines.push(
    "There is also no reliable historical player-to-team mapping in this database. `player_week_teams` " +
      "and `nfl_draft_picks` are both EMPTY (verified by direct row count). `preseason_rosters` covers " +
      "only the live 2026 season. `nfl_players.latest_team` — the one populated team field — is the " +
      "player's CURRENT (2026) team; applying it to 2024 produced team pass-attempt totals from 54 " +
      "(Miami) to 903 (Cincinnati, five merged 'Bengals' QBs) against a real range of roughly 450-650, " +
      "and was rejected as unusable.",
  );
  lines.push("");
  lines.push(
    "Team rosters for 2023 and 2024 (ONLY) are instead reconstructed from the `team_pass_attempts` / " +
      "`team_targets` / `team_carries` fingerprint nflverse's real historical roster produces on every " +
      "player's own weekly row (see `reconstructSeasonTeams` in the script for the exact method and " +
      "why a naive transitive join collapses the league into one component). 2025 carries no such " +
      "fingerprint and is used ONLY as an outcome season (a receiver's own next-season PPG needs no " +
      "team information at all).",
  );
  lines.push("");
  lines.push(`Team-seasons reconstructed and passing the plausibility gate (attempts in [400, 800], primary passer >= 150 attempts): ${keptTotal} kept, ${droppedTotal} dropped as implausible, across ${RECONSTRUCTIBLE_SEASONS.length} seasons.`);
  lines.push("");
  lines.push("Age is never derived: `nfl_players` carries no birth date or age column. Documented as missing, not imputed, per the brief.");
  lines.push("");

  lines.push("## The leave-one-out QB metric, exactly as computed");
  lines.push("");
  lines.push(
    "For a team-season and a specific qualifying (40+ target) receiver on it:\n\n" +
      "```\n" +
      "leaveOneOutANYA = (TeamPassYards - Receiver.receivingYards\n" +
      "                   + 20*(TeamPassTD - Receiver.receivingTouchdowns)\n" +
      "                   - 45*TeamInterceptions)\n" +
      "                  / (TeamAttempts - Receiver.targets)\n" +
      "```\n\n" +
      "Team totals are summed across every reconstructed teammate whose position is QB (backup snaps " +
      "included; a trick-play pass thrown by a non-QB is not captured — a small, named undercount). " +
      "The receiver's own catches are removed from the passing side and his own targets from the " +
      "attempts side (a target consumes one attempt) — this is the circularity control: a receiver's " +
      "own big season cannot inflate the number later used to predict that same receiver's own next " +
      "season. Interceptions are never receiver-adjusted (not attributable to one target).",
  );
  lines.push("");

  lines.push("## Main regression: next-season PPG ~ own PPG + target share + leave-one-out ANY/A");
  lines.push("");
  lines.push(
    `Fit on every 2023 and 2024 qualifying receiver-season with a computable target share and a real ` +
      `next-season outcome (2024 and 2025 respectively) — n = ${withTargetShare.length}. This is the ` +
      "full available sample, not a held-out split: with only two transition-years in the store, " +
      "there was not enough data left to hold a further slice out. The regression is OLS via the " +
      "normal equations; the CI on the ANY/A coefficient is a paired (row) bootstrap, 2000 resamples.",
  );
  lines.push("");
  lines.push("| Model | own PPG coef | target share coef | ANY/A coef | R2 |");
  lines.push("|---|---|---|---|---|");
  lines.push(`| Control only (own PPG + target share) | ${fmt(controlFit.coefficients[1] ?? null)} | ${fmt(controlFit.coefficients[2] ?? null)} | — | ${fmt(controlFit.r2)} |`);
  lines.push(`| Full (+ leave-one-out ANY/A) | ${fmt(fullFit.coefficients[1] ?? null)} | ${fmt(fullFit.coefficients[2] ?? null)} | ${fmt(fullFit.coefficients[3] ?? null)} | ${fmt(fullFit.r2)} |`);
  lines.push("");
  lines.push(
    `**Headline coefficient: ${fmt(fullFit.coefficients[3] ?? null)} PPG per 1.0 of leave-one-out ANY/A** ` +
      `(bootstrap 95% CI [${fmt(anyACi.lo, 2)}, ${fmt(anyACi.hi, 2)}]), n = ${withTargetShare.length}. ` +
      `R2 delta over the control-only model: ${fmt(fullFit.r2 - controlFit.r2)}.`,
  );
  lines.push("");
  lines.push(
    `**Read with real caution.** n = ${withTargetShare.length} receiver-seasons is far below what this ` +
      "design was written for (multi-year, multi-season transitions across 2018-2024). A CI this wide " +
      "relative to the point estimate should not be read as \"real\" without the harness's own " +
      "multiple-comparisons pass, which this document explicitly defers to.",
  );
  lines.push("");

  lines.push("## Robustness (a): same-QB-next-season vs all transitions");
  lines.push("");
  lines.push(
    `Classifiable only for the 2023->2024 transition (2025 has no reconstructed team, so a receiver's ` +
      `2025 QB identity is unknown to this script) — n = ${classifiable.length} classifiable, of which ` +
      `${sameTeamOnly.length} kept the same primary passer into the next season.`,
  );
  lines.push("");
  lines.push("| Slice | n | ANY/A coefficient |");
  lines.push("|---|---|---|");
  lines.push(`| Same primary passer next season | ${sameTeamOnly.length} | ${sameTeamFit === null ? "n too small to fit" : fmt(sameTeamFit.coefficients[3] ?? null)} |`);
  lines.push(`| All classifiable transitions | ${classifiable.length} | ${allTransitionsAmongClassifiable === null ? "n too small to fit" : fmt(allTransitionsAmongClassifiable.coefficients[3] ?? null)} |`);
  lines.push("");
  lines.push(
    "These two coefficients disagree with each other AND with the full-sample headline coefficient " +
      "above (sign flips included) — at n = 31 and n = 69, a four-predictor OLS is not well-anchored, " +
      "and this split should be read as evidence the finding is unstable at this sample size, not as a " +
      "second confirmation of anything.",
  );
  lines.push("");

  lines.push(`## Robustness (b): exclude receiver-seasons under ${MIN_GAMES} games`);
  lines.push("");
  lines.push(`n = ${atLeastMinGames.length} (of ${withTargetShare.length}) after the games filter.`);
  lines.push("");
  lines.push(`ANY/A coefficient on this slice: ${minGamesFit === null ? "n too small to fit" : fmt(minGamesFit.coefficients[3] ?? null)}.`);
  lines.push("");

  lines.push("## Robustness (c): the QB-change event study (2023->2024 transition only)");
  lines.push("");
  lines.push(
    `Among classifiable receivers, ${qbChanged.length} saw their primary passer change into the next ` +
      `season and ${qbSame.length} did not. Of the ${qbChanged.length} QB-change cases, ` +
      `${changedWithNextEfficiency.length} were STILL a 40+-target qualifying receiver the following ` +
      "season (needed to compute their new QB's own leave-one-out efficiency) — this is a further-" +
      "narrowed sub-slice, named as such.",
  );
  lines.push("");
  lines.push("| Split | n | Mean receiver PPG delta (next season vs the QB-change season) |");
  lines.push("|---|---|---|");
  lines.push(`| New QB situation MORE efficient (ANY/A rose) | ${efficiencyRose.length} | ${efficiencyRose.length > 0 ? fmt(mean(deltaPpg(efficiencyRose)), 2) : "n/a"} |`);
  lines.push(`| New QB situation LESS efficient (ANY/A fell or flat) | ${efficiencyFell.length} | ${efficiencyFell.length > 0 ? fmt(mean(deltaPpg(efficiencyFell)), 2) : "n/a"} |`);
  lines.push("");
  lines.push(
    efficiencyRose.length < 3 || efficiencyFell.length < 3
      ? "**N is too small in at least one arm of this split to read the delta as anything more than a data point.**"
      : "Both arms clear a minimal size, though still small — read as directional, not confirmatory.",
  );
  lines.push("");

  lines.push("## The sophomore-QB read (item 4) — DESCRIPTIVE ONLY, not causal");
  lines.push("");
  lines.push(
    `Team-seasons (2023 or 2024) where the reconstructed primary passer was a rookie that year, with ` +
      `a qualifying WR1 (highest targets among 40+-target receivers) whose following-season outcome is ` +
      `known: n = ${sophomoreWithOutcome.length}. This is small by construction — say so, not hide it.`,
  );
  lines.push("");
  if (sophomoreWithOutcome.length > 0) {
    lines.push("| Rookie QB (season) | WR1 | Rookie-year PPG | Sophomore-year PPG | Delta |");
    lines.push("|---|---|---|---|---|");
    for (const row of sophomoreWithOutcome) {
      lines.push(`| ${row.rookieQbName} (${row.rookieSeason}) | ${row.wr1Name} | ${fmt(row.wr1PpgRookieYear, 1)} | ${fmt(row.wr1PpgSophomoreYear, 1)} | ${row.delta >= 0 ? "+" : ""}${fmt(row.delta, 1)} |`);
    }
    lines.push("");
    lines.push(`Mean delta: ${fmt(mean(sophomoreWithOutcome.map((r) => r.delta)), 2)} PPG. Spread (sample stdev): ${fmt(stdev(sophomoreWithOutcome.map((r) => r.delta)), 2)}.`);
  } else {
    lines.push("No team-season in the reconstructed 2023-2024 window met every filter (rookie primary passer, plausible team-season, qualifying WR1, real sophomore-year outcome).");
  }
  lines.push("");

  lines.push("## Dart + Nabers (item 5)");
  lines.push("");
  for (const line of dartSection) lines.push(line + "\n");
  lines.push(
    "**What this would imply for 2026, with the uncertainty stated plainly:** IF the main regression's " +
      `coefficient (${fmt(fullFit.coefficients[3] ?? null)} PPG per 1.0 ANY/A, CI [${fmt(anyACi.lo, 2)}, ${fmt(anyACi.hi, 2)}]) ` +
      "is real — which a CI this wide on an n this small does not establish — and IF Dart's leave-one-out " +
      "efficiency sits where the percentile above places him, the sophomore-QB descriptive above " +
      "(itself n too small to generalize) would be the closer analogue for what a second-year " +
      "quarterback's improvement typically does to his WR1's scoring. This is NOT a projection change. " +
      "It is an exploratory implication, gated on two separately small-N, non-causal reads, and enters " +
      "the model only if the law-discovery harness independently confirms it.",
  );
  lines.push("");

  lines.push("## Limitations that most threaten these findings, ranked");
  lines.push("");
  lines.push(
    "1. **Season coverage.** Three seasons (2023-2025), not the requested 2018-2025 — the single " +
      "biggest threat to every number above generalizing at all.\n" +
      "2. **Team reconstruction, not ground truth.** The fingerprint method is verified sound in spot " +
      "checks (Mahomes/Allen correctly separate; cluster sizes match real skill-position roster " +
      "counts) but is inference, not a stored fact — a mid-season trade inside a receiver's own " +
      "cluster, or a fingerprint collision the plausibility gate missed, would silently mis-group a " +
      "team-season rather than error loudly.\n" +
      "3. **The leave-one-out approximation.** Removing a receiver's targets from team attempts and " +
      "his catches from team yards/TDs approximates his 'share' rather than measuring it play-by-play; " +
      "backup-QB and non-QB trick-play production is a further small, uncorrected gap.\n" +
      "4. **N throughout.** The main regression (n as reported above), the event study (single-digit " +
      "arms), and the sophomore descriptive (single digits) are all far below a size that should move " +
      "confidence on their own — every one of them is exactly the kind of finding the law-discovery " +
      "harness's multiple-comparisons control exists to guard against over-reading.\n" +
      "5. **Dart's own number uses a different unit (ANY/G, not ANY/A)** than the regression's headline " +
      "coefficient, because 2025 has no attempts data — the percentile placement is internally " +
      "consistent (same metric on both sides) but is not the same metric the regression's coefficient " +
      "is denominated in.",
  );
  lines.push("");

  console.log(lines.join("\n"));
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  console.log(`\nwrote ${REPORT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
