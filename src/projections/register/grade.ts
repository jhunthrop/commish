import { inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { Position } from "@/domain/player";
import { computeFantasyPoints } from "@/scoring/compute";
import { LAST_POSSIBLE_WEEK } from "../store";
import { statLinesAsOf } from "../lines";
import { spearman } from "../metrics";
import { roleOf, SERVED_BOARD_SOURCE } from "./sources";
import {
  freezeBoardSourcesAt,
  freezeRowsAt,
  frozenWeeksFor,
  gradeRowsFor,
  latestFreezeFor,
  recordGradeRows,
  REGISTER_COLUMNS,
  REGISTER_SCORING,
  type RegisterColumn,
  type RegisterFreezeRow,
  type RegisterGradeRow,
} from "./store";

/**
 * GRADING A WEEK THE REGISTER ALREADY FROZE.
 *
 * This is the half that reads outcomes, and it is deliberately the smaller half. It takes the last
 * claim standing before kickoff, takes what the week actually produced, and appends one row per
 * player PER BOARD saying where each of the four columns had placed him. It writes nothing but
 * graded rows, and it reads nothing it did not need for that.
 *
 * EVERY BOARD THE FREEZE RECORDED (the dual-track ruling, Round D), scored independently and stored
 * under its own `boardSource`. One grading run, one `gradedAt`, one outcome read, N boards: the
 * whole point is that the served board and its shadow are answered by the SAME week, so anything
 * that could differ between them other than the boards themselves has to be shared.
 *
 * IT RUNS ONLY FOR A WEEK WITH OUTCOMES. A week the stats pipeline has not reached yet has no
 * observations at all, and grading it would score every column against an empty population — which
 * comes back as a null correlation, gets printed beside real weeks, and looks like a week nobody
 * could predict rather than a week nobody has ingested. It refuses instead.
 *
 * THE GRADED POPULATION IS THE INTERSECTION: frozen players who have a stat line for the week. A
 * frozen player with no line did not necessarily score zero — he may have been inactive, he may
 * have been cut, the file may not carry him — and this store's oldest rule is that an absence is not
 * a zero. Scoring the un-lined as zeros would also hand the benchmarks a large, easy, identically
 * tied population that flatters every column equally and tells a reader nothing. `population` is
 * reported so a week where that intersection is unexpectedly small is visible.
 *
 * EACH COLUMN IS RANKED OVER ITS OWN COVERED POPULATION, and scored against the outcome re-ranked
 * within that same population. A benchmark that only had an opinion about the top 200 is measured on
 * the top 200; comparing its rank against an outcome rank taken over a wider field would penalise it
 * for the players it was honest enough to say nothing about.
 *
 * THE METRICS ARE RANK METRICS, both of them, and that is not a shortcut. The board's points are a
 * SEASON total, an ADP is a draft slot, and a props line is one week's yardage — three different
 * units, none of them commensurable with a single week's fantasy score. The only question all four
 * columns can be asked in the same language is "did you put the right men above the right men",
 * which is what Spearman and mean absolute rank error each answer, from opposite directions:
 * correlation says whether the ordering was right in shape, rank error says how far a typical player
 * was from where he belonged.
 */

export interface GradeRequest {
  readonly season: number;
  readonly week: number;
}

/** One column's verdict on one week. */
export interface ColumnScore {
  readonly column: RegisterColumn;
  /** How many players this column actually had an opinion about, among the graded population. */
  readonly graded: number;
  /** Rank agreement with the outcome, or `null` where the sample cannot support one (fewer than
   *  two covered players, or no variance). Never zero — see `metrics.ts`. */
  readonly spearman: number | null;
  /** Mean |predicted rank - actual rank| over this column's covered population. */
  readonly meanAbsoluteRankError: number | null;
}

/** One BOARD's verdict on one week: its own graded rows and its own four column scores. */
export interface BoardGrade {
  readonly boardSource: string;
  /** Frozen players on THIS board who have an outcome for the week. */
  readonly population: number;
  readonly rows: readonly RegisterGradeRow[];
  readonly scores: readonly ColumnScore[];
}

/** A board the freeze recorded that this grading could not score, and why. Never silent: a shadow
 *  vanishing from a scoreboard reads as a shadow that agreed with everything. */
export interface SkippedBoard {
  readonly boardSource: string;
  readonly reason: string;
}

export interface WeekGrade {
  readonly season: number;
  readonly week: number;
  /** The exact freeze graded — the last claim standing before kickoff. */
  readonly frozenAt: Date;
  readonly gradedAt: Date;
  /** Every board the freeze recorded that could be scored, served first. */
  readonly boards: readonly BoardGrade[];
  readonly skipped: readonly SkippedBoard[];
  /** The SERVED board's population — "how many players did this week grade", in the sense every
   *  earlier caller of this field meant. A shadow's own population is on its `BoardGrade`. */
  readonly population: number;
  /** Every row written, across every board. */
  readonly rows: readonly RegisterGradeRow[];
}

/** One column of one board across every week graded so far. */
export interface CumulativeScore {
  readonly boardSource: string;
  readonly column: RegisterColumn;
  /** How many graded weeks this column could be scored on at all. */
  readonly weeks: number;
  /** The mean of the weeks' own agreements, or `null` where no week could support one. */
  readonly spearman: number | null;
  readonly meanAbsoluteRankError: number | null;
}

/**
 * A column's stance for one player, oriented so HIGHER IS ALWAYS BETTER.
 *
 * The board and the props consensus are point totals (higher is better); ADP and ECR are ranks
 * (lower is better). Negating the two rank columns here is what lets one ranking function and one
 * correlation serve all four, and it is done once, in one place, rather than at each of the four
 * call sites where a forgotten sign would silently report a benchmark as perfectly ANTI-correlated.
 */
function stanceOf(row: RegisterFreezeRow, column: RegisterColumn): number | null {
  switch (column) {
    case "board":
      return row.boardPoints;
    case "adp":
      return row.adpRank === null ? null : -row.adpRank;
    case "ecr":
      return row.ecrRank === null ? null : -row.ecrRank;
    case "props":
      return row.propsPoints;
  }
}

/**
 * Ordinal ranks, 1 = highest value, ties broken by the tiebreak key ascending.
 *
 * Ordinal rather than average-rank, deliberately, because these ranks are STORED: a row saying
 * "the board had him 4th" is a fact a reader can check against the board, and "3.5th" is not. The
 * tiebreak on player id is what makes the stored number reproducible run to run — two players the
 * board priced identically must not swap places because Postgres returned them in a different order.
 * The METRICS below do not lean on this: `spearman` re-ranks with the average-rank correction of its
 * own, which is the right choice for a correlation and the wrong one for a stored placement.
 */
function ordinalRanks(entries: readonly { readonly key: string; readonly value: number }[]): ReadonlyMap<string, number> {
  const sorted = [...entries].sort((a, b) => (b.value - a.value) || a.key.localeCompare(b.key));
  return new Map(sorted.map((entry, index) => [entry.key, index + 1]));
}

/** Average ranks over the outcome, 1 = highest points, ties sharing their mean — the comparison
 *  half of `meanAbsoluteRankError`. Average-rank here because a tie in the OUTCOME is a real tie
 *  and charging a column for guessing an order within it would be scoring it on noise. */
function averageOutcomeRanks(entries: readonly { readonly key: string; readonly value: number }[]): ReadonlyMap<string, number> {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const ranks = new Map<string, number>();
  let position = 0;
  while (position < sorted.length) {
    let end = position;
    while (end + 1 < sorted.length && sorted[end + 1]!.value === sorted[position]!.value) end += 1;
    const shared = (position + end) / 2 + 1;
    for (let i = position; i <= end; i += 1) ranks.set(sorted[i]!.key, shared);
    position = end + 1;
  }
  return ranks;
}

function rankOn(row: RegisterGradeRow, column: RegisterColumn): number | null {
  switch (column) {
    case "board":
      return row.boardRank;
    case "adp":
      return row.adpRank;
    case "ecr":
      return row.ecrRank;
    case "props":
      return row.propsRank;
  }
}

/**
 * Every column's verdict, derived from graded rows alone.
 *
 * Exported because it is the ONE definition of what a column's score means: `gradeWeek` calls it on
 * the week it just wrote and `runningScoreboard` calls it on each week it reads back, so a
 * scoreboard can never disagree with the week it is summarising.
 */
export function scoreColumns(rows: readonly RegisterGradeRow[]): readonly ColumnScore[] {
  return REGISTER_COLUMNS.map((column) => {
    const covered = rows.filter((row) => rankOn(row, column) !== null);
    if (covered.length === 0) return { column, graded: 0, spearman: null, meanAbsoluteRankError: null };
    const outcomeRanks = averageOutcomeRanks(covered.map((row) => ({ key: row.playerId, value: row.actualPoints })));
    const error =
      covered.reduce((sum, row) => sum + Math.abs(rankOn(row, column)! - outcomeRanks.get(row.playerId)!), 0) / covered.length;
    return {
      column,
      graded: covered.length,
      // A rank is "lower is better", so it is negated back into a higher-is-better prediction
      // before correlating — the same orientation `stanceOf` established when the ranks were built.
      spearman: spearman(covered.map((row) => ({ predicted: -rankOn(row, column)!, actual: row.actualPoints }))),
      meanAbsoluteRankError: error,
    };
  });
}

/**
 * nflverse's own position spelling narrowed to the one `computeFantasyPoints` asks for.
 *
 * ONLY TWO POSITIONS CHANGE THAT FUNCTION'S ANSWER, and this is not an assumption — it is what the
 * function does: `TE` adds `teReceptionBonus` per reception, `DEF` applies the points/yards-allowed
 * tier tables, and every other value takes the identical arithmetic. `QB`, `RB`, `WR`, `FB`, `HB`
 * and `K` are therefore all mapped to one arm, not because they are the same kind of player but
 * because the scoring sheet treats them identically, and inventing a per-position branch here would
 * imply a distinction the rules do not make. (`REGISTER_SCORING` is PPR, whose `teReceptionBonus` is
 * zero, so today even the TE arm is a no-op — the mapping is still written out, because a future
 * sheet with a real tight-end premium must not silently mis-score every tight end in the archive.)
 */
function scoringPositionFor(nflversePosition: string): Position {
  if (nflversePosition === "TE") return "TE";
  if (nflversePosition === "DEF" || nflversePosition === "DST") return "DEF";
  return "RB";
}

/** Positions for the graded players, so the outcome is scored under the same rules as everything
 *  else. Read from `nfl_players`, which is where identity lives and where it carries no `as_of`. */
async function positionsFor(db: ReadonlyDb, playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .select({ id: nflPlayers.id, position: nflPlayers.position })
    .from(nflPlayers)
    .where(inArray(nflPlayers.id, [...playerIds]));
  return new Map(rows.map((row) => [row.id, row.position]));
}

/**
 * Grades one week against the last freeze taken before it kicked off, appends the rows and returns
 * them with the week's own per-column scores.
 *
 * `gradedAt` is both the row's identity and the `as_of` bound the outcome read is taken at, so a
 * grading run cannot see a stat correction stamped after it started, and a re-grade after a
 * correction genuinely reads something different rather than merely being labelled later.
 */
export async function gradeWeek(db: Db, { season, week }: GradeRequest, clock: Clock): Promise<WeekGrade> {
  const frozenAt = await latestFreezeFor(db, season, week);
  if (frozenAt === null) {
    throw new Error(`The register holds no freeze for ${season} week ${week}, so there is nothing to grade.`);
  }
  const key = { season, week, frozenAt };
  const frozen = await freezeRowsAt(db, key);
  const gradedAt = new Date(clock.now());

  const lines = await statLinesAsOf(db, { season, week, asOf: gradedAt });
  if (lines.length === 0) {
    throw new Error(
      `The store holds no outcomes for ${season} week ${week} at or before ${gradedAt.toISOString()}, so it cannot be graded yet. Run \`npm run stats:ingest\` first.`,
    );
  }

  const positions = await positionsFor(db, frozen.map((row) => row.playerId));
  const lineByPlayer = new Map(lines.map((line) => [line.line.playerId, line.line]));

  // EVERY BOARD THE FREEZE ACTUALLY RECORDED, read from the rows rather than from the current source
  // list, and ordered served-first so a report can print them in the order that means something.
  const boardSources = [...(await freezeBoardSourcesAt(db, key))].sort(
    (a, b) => servedFirst(a) - servedFirst(b) || a.localeCompare(b),
  );

  const boards: BoardGrade[] = [];
  const skipped: SkippedBoard[] = [];
  for (const boardSource of boardSources) {
    const claim = frozen.filter((row) => row.boardSource === boardSource);
    const graded = claim.filter((row) => lineByPlayer.has(row.playerId));
    if (graded.length === 0) {
      const reason =
        `${season} week ${week} has outcomes, but none of them belong to a player the ${frozenAt.toISOString()} freeze carried under "${boardSource}". ` +
        "Refusing to grade an empty intersection.";
      // The SERVED board is load-bearing: an empty intersection there means the week cannot be
      // graded at all, and calling that a skipped board would leave a scoreboard quietly missing the
      // one column it exists to report. A shadow's empty intersection is a fact about a diagnostic
      // track and is recorded as one.
      if (boardSource === SERVED_BOARD_SOURCE) throw new Error(reason);
      skipped.push({ boardSource, reason });
      continue;
    }
    boards.push(gradeOneBoard({ season, week, frozenAt, gradedAt, boardSource, graded, positions, lineByPlayer }));
  }

  const rows = boards.flatMap((board) => board.rows);
  await db.transaction(async (tx) => {
    await recordGradeRows(tx, rows);
  });

  const servedBoard = boards.find((board) => board.boardSource === SERVED_BOARD_SOURCE);
  return { season, week, frozenAt, gradedAt, boards, skipped, population: servedBoard?.population ?? 0, rows };
}

/** Sort key that puts the currently served source first and leaves every other source alone. */
function servedFirst(source: string): number {
  return source === SERVED_BOARD_SOURCE ? 0 : 1;
}

interface OneBoardInput {
  readonly season: number;
  readonly week: number;
  readonly frozenAt: Date;
  readonly gradedAt: Date;
  readonly boardSource: string;
  /** This board's frozen rows that have an outcome. Non-empty — the caller checked. */
  readonly graded: readonly RegisterFreezeRow[];
  readonly positions: ReadonlyMap<string, string>;
  readonly lineByPlayer: ReadonlyMap<string, Parameters<typeof computeFantasyPoints>[0]>;
}

/**
 * One board's graded rows and scores.
 *
 * EACH BOARD IS SCORED OVER ITS OWN POPULATION, and the outcome is re-ranked inside it. Two boards
 * with different universes (a shadow persisted before a cutdown, say) must not be scored against
 * ranks taken over a field one of them never spoke about — that is the same rule this module already
 * applies per COLUMN, applied one level up, and it is what makes the shadow's number comparable to
 * the served board's rather than merely printed beside it.
 */
function gradeOneBoard({ season, week, frozenAt, gradedAt, boardSource, graded, positions, lineByPlayer }: OneBoardInput): BoardGrade {
  const actualPoints = new Map(
    graded.map((row) => {
      // `register_freeze_rows.player_id` is a foreign key into `nfl_players`, whose `position` is
      // NOT NULL, so a frozen player always has one. A missing entry here would mean the row was
      // read from a store that had lost referential integrity, which is a refusal, not a default.
      const position = positions.get(row.playerId);
      if (position === undefined) {
        throw new Error(`${row.playerId} is frozen for ${season} week ${week} but carries no nfl_players row, so his outcome cannot be scored.`);
      }
      return [row.playerId, computeFantasyPoints(lineByPlayer.get(row.playerId)!, scoringPositionFor(position), REGISTER_SCORING)];
    }),
  );
  const actualRanks = ordinalRanks(graded.map((row) => ({ key: row.playerId, value: actualPoints.get(row.playerId)! })));

  const ranksByColumn = new Map<RegisterColumn, ReadonlyMap<string, number>>(
    REGISTER_COLUMNS.map((column) => {
      const covered = graded
        .map((row) => ({ key: row.playerId, value: stanceOf(row, column) }))
        .filter((entry): entry is { key: string; value: number } => entry.value !== null);
      return [column, ordinalRanks(covered)];
    }),
  );
  const rankFor = (column: RegisterColumn, playerId: string): number | null => ranksByColumn.get(column)!.get(playerId) ?? null;

  const rows: readonly RegisterGradeRow[] = graded.map((row) => ({
    season,
    week,
    frozenAt,
    gradedAt,
    boardSource,
    playerId: row.playerId,
    actualPoints: actualPoints.get(row.playerId)!,
    actualRank: actualRanks.get(row.playerId)!,
    // The board defines the population, so every graded row has a board rank by construction.
    boardRank: rankFor("board", row.playerId)!,
    adpRank: rankFor("adp", row.playerId),
    ecrRank: rankFor("ecr", row.playerId),
    propsRank: rankFor("props", row.playerId),
  }));

  return { boardSource, population: rows.length, rows, scores: scoreColumns(rows) };
}

function meanOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * THE RUNNING SCOREBOARD: each column's mean weekly verdict across every week graded so far.
 *
 * ONE GRADING PER WEEK, THE LATEST. The store keeps every grading a week ever received (a re-grade
 * after a stat correction appends rather than replaces), and pooling all of them would count a
 * re-graded week twice and weight it double for no reason but that somebody re-ran it.
 *
 * A MEAN OF WEEKLY SCORES, NOT A SCORE OVER POOLED ROWS. Pooling every week's players into one
 * correlation would ask whether a column ranks the whole SEASON's player-weeks correctly, which is a
 * different and much easier question — most of the ordering there comes from good players being good
 * every week. Averaging the weeks asks the question the register was built for: week by week, did
 * this opinion order that week correctly. A week no column could be scored on contributes nothing
 * rather than a zero.
 */
/**
 * Every grade row belonging to the LATEST `gradedAt` its own week received, grouped by week. The
 * one dedup rule the register's grade rows ever need: a week's grading may be re-run after a stat
 * correction, and only the newest run should count toward anything downstream — the scoreboard's
 * cumulative columns and `src/jobs/season-week/steps.ts`'s printed per-week population both read
 * through this, so neither can drift from what the other considers "this week's grading".
 */
export function latestGradeRowsByWeek(rows: readonly RegisterGradeRow[]): ReadonlyMap<number, readonly RegisterGradeRow[]> {
  const latestByWeek = new Map<number, number>();
  for (const row of rows) {
    const held = latestByWeek.get(row.week);
    if (held === undefined || row.gradedAt.getTime() > held) latestByWeek.set(row.week, row.gradedAt.getTime());
  }
  const grouped = new Map<number, RegisterGradeRow[]>();
  for (const row of rows) {
    if (row.gradedAt.getTime() !== latestByWeek.get(row.week)) continue;
    grouped.set(row.week, [...(grouped.get(row.week) ?? []), row]);
  }
  return grouped;
}

/**
 * WHICH COLUMNS A BOARD CONTRIBUTES TO THE SCOREBOARD.
 *
 * The served board contributes all four: it is the product, and adp/ecr/props are the benchmarks the
 * product is being measured against. A SHADOW contributes only its `board` column. Its benchmark
 * columns are not wrong, they are REDUNDANT — the same three market opinions, scored over a
 * near-identical population — and printing them would put five near-duplicate benchmark rows on a
 * scoreboard whose whole job is to make two board columns comparable at a glance. The dual track is
 * a comparison of BOARDS; the benchmarks are the fixed backdrop both are compared against.
 */
function columnsFor(boardSource: string): readonly RegisterColumn[] {
  return boardSource === SERVED_BOARD_SOURCE ? REGISTER_COLUMNS : ["board"];
}

export async function runningScoreboard(db: ReadonlyDb, season: number): Promise<readonly CumulativeScore[]> {
  const all = await gradeRowsFor(db, season);
  const byWeek = latestGradeRowsByWeek(all);
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  // Every board any graded week holds, served first — read from the ROWS, so a board that stopped
  // being tracked mid-season still reports the weeks it was graded on rather than vanishing.
  const boardSources = [...new Set(all.map((row) => row.boardSource))].sort(
    (a, b) => servedFirst(a) - servedFirst(b) || a.localeCompare(b),
  );

  return boardSources.flatMap((boardSource) => {
    const perWeek = weeks
      .map((week) => byWeek.get(week)!.filter((row) => row.boardSource === boardSource))
      .filter((rows) => rows.length > 0)
      .map((rows) => scoreColumns(rows));

    return columnsFor(boardSource).map((column) => {
      const scores = perWeek.map((week) => week.find((score) => score.column === column)!).filter((score) => score.graded > 0);
      return {
        boardSource,
        column,
        weeks: scores.length,
        spearman: meanOf(scores.map((score) => score.spearman).filter((value): value is number => value !== null)),
        meanAbsoluteRankError: meanOf(
          scores.map((score) => score.meanAbsoluteRankError).filter((value): value is number => value !== null),
        ),
      };
    });
  });
}

function show(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

/**
 * The scoreboard as one printable block, naming EVERY row even where it has nothing to say — a
 * column missing from a report reads as a column nobody thought to check.
 *
 * The board source leads each line, and a shadow is marked as one, because two lines both saying
 * "board" with different numbers is exactly the ambiguity the dual track must not print.
 */
export function formatScoreboard(scores: readonly CumulativeScore[]): string {
  const label = (score: CumulativeScore): string =>
    `${score.boardSource}${roleOf(score.boardSource) === "shadow" ? " (shadow)" : ""}`;
  const width = Math.max(12, ...scores.map((score) => label(score).length));
  const header = `${"board source".padEnd(width)}  ${"column".padEnd(8)}${"weeks".padStart(7)}${"spearman".padStart(11)}${"rank err".padStart(11)}`;
  const lines = scores.map(
    (score) =>
      `${label(score).padEnd(width)}  ${score.column.padEnd(8)}${String(score.weeks).padStart(7)}` +
      `${show(score.spearman, 4).padStart(11)}${show(score.meanAbsoluteRankError, 2).padStart(11)}`,
  );
  return [header, ...lines].join("\n");
}

/**
 * Every week the register could grade right now: frozen, and not obviously beyond the season. The
 * caller still has to handle a week whose outcomes have not landed — `gradeWeek` refuses that one
 * by name, and knowing which weeks were skipped and why is the operator's report, not this
 * function's guess.
 */
export async function gradableWeeksFor(db: ReadonlyDb, season: number): Promise<readonly number[]> {
  const frozen = await frozenWeeksFor(db, season);
  return frozen.filter((week) => week >= 1 && week <= LAST_POSSIBLE_WEEK);
}
