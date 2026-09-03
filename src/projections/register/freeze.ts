import type { Db } from "@/db/client";
import type { Clock } from "@/domain/timing";
import type { JsonObject } from "@/domain/audit";
import { kickoffInstantsByWeek } from "../team-store";
import { StitchedGenerationsError, assertSingleGeneration, preseasonProjectionsAsOf } from "../preseason/board-store";
import { RegisterRefusalError } from "./errors";
import { BENCHMARK_SOURCES } from "../preseason/benchmarks";
import { preseasonRankingsAsOf } from "../preseason/store";
import { weekPropsConsensus, type WeekWindow } from "./props";
import { REGISTER_BOARD_SOURCES, SERVED_BOARD_SOURCE, type RegisterBoardRole } from "./sources";
import { recordFreezeRows, REGISTER_COLUMNS, type RegisterColumn, type RegisterFreezeRow } from "./store";

/**
 * TAKING A FREEZE — writing down what every tracked board and the three benchmarks said about a
 * week, before the week could say anything back.
 *
 * THE REFUSAL IS THE FEATURE. A freeze taken at or after this week's first kickoff is not a
 * prospective claim; it is a claim made by somebody who could already see a scoreboard, and the
 * register would have no way to tell the two apart afterwards. So the guard is STRICTLY BEFORE, to
 * the millisecond, and it is the same clock discipline `preseason/source.ts`'s `liveMomentFor`
 * carries for the same reason (`now >= kickoff` throws there too, naming the same fact).
 *
 * PER WEEK, NOT PER SEASON. `liveMomentFor` asks `firstKickoffFor`, which is pinned to week ONE by
 * construction — the right question for a preseason board, and the wrong one here: week 8's freeze
 * is taken in October, months after week 1 kicked off, and a week-one bound would refuse every
 * freeze after the season's opening night. `kickoffInstantsByWeek` is that same query generalised
 * across weeks, and this reads THIS week's own instant out of it.
 *
 * THE BOARD COLUMN IS A READ OF THE PRODUCT, NEVER A RECOMPUTE. `preseasonProjectionsAsOf` under a
 * board's own source is exactly the call the drafts-players route and the player screen make, so the
 * points and ranks this freezes are the ones a manager could actually have been shown. Rebuilding
 * the board here would freeze a number nobody was served, and for the SHADOW board it would freeze a
 * number nobody could serve: v7's stored rows are the last artefact of a configuration this tree
 * cannot reproduce. The register must record the claim, not reproduce the claimant.
 *
 * EVERY TRACKED BOARD, ONE INSTANT (the dual-track ruling, Round D). `register/sources.ts` names the
 * served board and each shadow; this freezes all of them at the same moment, off the same read path,
 * against the same three benchmarks. Taking them at DIFFERENT instants would make the comparison the
 * dual track exists for unfalsifiable — the later board would have seen a day more of injury news —
 * so the loop is inside one clock read and one transaction, never one call per board.
 *
 * THE SERVED BOARD IS LOAD-BEARING AND A SHADOW IS NOT. An empty served board is a refusal: there is
 * no claim to freeze and the product is broken. An empty shadow is REPORTED and the freeze proceeds,
 * because a shadow going quiet is a fact about a diagnostic track and must not cost the season its
 * week-1 claim.
 *
 * THE FREEZE INSTANT IS THE INJECTED CLOCK, and it is also the `as_of` bound every read below is
 * taken at. One instant, used for the refusal, for every board read, for both ranking reads, for the
 * props window and as the row's own identity: a freeze that read its benchmarks at a different
 * moment from its board would be a claim nobody ever actually held.
 */

export interface FreezeRequest {
  readonly season: number;
  readonly week: number;
}

/** How many rows carried a stance in each column — printed by the operator script, because a
 *  benchmark whose feed went quiet looks exactly like a benchmark nobody had an opinion in. */
export type FreezeCoverage = Readonly<Record<RegisterColumn, number>>;

/** What one tracked board contributed to one freeze. */
export interface FreezeBoard {
  readonly source: string;
  readonly role: RegisterBoardRole;
  /** The stamp THIS board carried, which is NOT the freeze instant and differs between boards: a
   *  shadow's stamp is however old its last persist was. `null` only when the board is empty. */
  readonly boardAsOf: Date | null;
  readonly rows: readonly RegisterFreezeRow[];
  readonly coverage: FreezeCoverage;
}

export interface FreezeResult {
  readonly season: number;
  readonly week: number;
  /** The instant the claim was written down — strictly before `kickoff`. */
  readonly frozenAt: Date;
  /** This week's own first kickoff, the bound the freeze had to beat. */
  readonly kickoff: Date;
  /** Every tracked board's contribution, served first, in `REGISTER_BOARD_SOURCES` order. */
  readonly boards: readonly FreezeBoard[];
  /** The served board's own entry, the one the product actually showed. Always present and always
   *  non-empty — `takeFreeze` refuses otherwise. */
  readonly served: FreezeBoard;
  /** Every row this freeze wrote, across every board. */
  readonly rows: readonly RegisterFreezeRow[];
}

/**
 * The half-open window of kickoffs a week owns: from its own first kickoff up to, and not
 * including, the next week's. A season's final week has no successor and therefore no upper bound.
 */
function windowFor(kickoffs: ReadonlyMap<number, Date>, week: number, from: Date): WeekWindow {
  return { from, to: kickoffs.get(week + 1) ?? null };
}

function rankMapFor(rows: readonly { readonly playerId: string; readonly rank: number }[]): ReadonlyMap<string, number> {
  return new Map(rows.map((row) => [row.playerId, row.rank]));
}

function coverageOf(rows: readonly RegisterFreezeRow[]): FreezeCoverage {
  return {
    board: rows.length,
    adp: rows.filter((row) => row.adpRank !== null).length,
    ecr: rows.filter((row) => row.ecrRank !== null).length,
    props: rows.filter((row) => row.propsPoints !== null).length,
  };
}

/**
 * Takes one freeze and returns what it wrote. Throws, without writing anything, when the week has
 * no ingested kickoff, when the freeze instant is not strictly before that kickoff, or when the
 * served board is empty.
 *
 * The write is one transaction: a freeze that landed for part of the board would be a claim about a
 * smaller universe than the product actually served, and nothing at the reader could tell that from
 * a board that genuinely ranked fewer people.
 */
export async function takeFreeze(db: Db, { season, week }: FreezeRequest, clock: Clock): Promise<FreezeResult> {
  const kickoffs = await kickoffInstantsByWeek(db, season);
  const kickoff = kickoffs.get(week);
  if (kickoff === undefined) {
    throw new RegisterRefusalError(
      "no_kickoff",
      `The store holds no ingested kickoff for ${season} week ${week}, so there is nothing to check a freeze against. Run \`npm run projections:context\` first.`,
    );
  }

  const frozenAt = new Date(clock.now());
  if (frozenAt.getTime() >= kickoff.getTime()) {
    throw new RegisterRefusalError(
      "past_kickoff",
      `${season} week ${week}'s first kickoff (${kickoff.toISOString()}) is not after ${frozenAt.toISOString()}. ` +
        "The week has already begun, so a freeze taken now would not be a prospective claim. Refusing.",
    );
  }

  // The three benchmarks are read ONCE and shared by every board. They are the same three opinions
  // whichever board is being compared against them, and reading them per board would be three
  // identical queries whose results could not differ.
  const [adp, ecr, props] = await Promise.all([
    preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.adp, asOf: frozenAt }),
    preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.ecr, asOf: frozenAt }),
    weekPropsConsensus(db, { season, window: windowFor(kickoffs, week, kickoff), asOf: frozenAt }),
  ]);
  const adpByPlayer = rankMapFor(adp);
  const ecrByPlayer = rankMapFor(ecr);

  const boards: readonly FreezeBoard[] = await Promise.all(
    REGISTER_BOARD_SOURCES.map(async ({ source, role }): Promise<FreezeBoard> => {
      // A stitched two-generation read anywhere else is a bad page render; here it becomes an
      // immutable weekly claim the whole season grades against. Fail loud before recording. ONLY
      // the integrity violation itself becomes a typed refusal (fix round 2, HIGH-A): board-store
      // now names it `StitchedGenerationsError`, and anything else this call throws — a dropped
      // connection, a restarting database — rethrows untouched, because wrapping the weather too
      // was dead-lettering a retryable freeze.
      try {
        await assertSingleGeneration(db, { season, source, asOf: frozenAt });
      } catch (error: unknown) {
        if (error instanceof StitchedGenerationsError) {
          throw new RegisterRefusalError("stitched_generations", error.message, { cause: error });
        }
        throw error;
      }
      const board = await preseasonProjectionsAsOf(db, { season, source, asOf: frozenAt });
      const rows: readonly RegisterFreezeRow[] = board.map((entry) => {
        const stance = props.get(entry.playerId);
        return {
          season,
          week,
          frozenAt,
          playerId: entry.playerId,
          boardSource: entry.source,
          boardAsOf: entry.asOf,
          boardPoints: entry.projectedPoints,
          boardRank: entry.rank,
          boardValueRank: entry.valueRank,
          adpRank: adpByPlayer.get(entry.playerId) ?? null,
          ecrRank: ecrByPlayer.get(entry.playerId) ?? null,
          propsPoints: stance?.points ?? null,
          propsMarkets: stance === undefined ? null : ({ ...stance.markets } as JsonObject),
        };
      });
      // Every row of one `preseasonProjectionsAsOf` read carries the same board stamp.
      return { source, role, boardAsOf: rows[0]?.boardAsOf ?? null, rows, coverage: coverageOf(rows) };
    }),
  );

  const served = boards.find((board) => board.role === "served");
  if (served === undefined) {
    throw new RegisterRefusalError(
      "no_served_role",
      "register/sources.ts lists no board with the `served` role, so this freeze has no claim about the product to record. " +
        "A shadow-only register is a comparison of two boards nobody was shown.",
    );
  }
  if (served.rows.length === 0) {
    throw new RegisterRefusalError(
      "empty_served_board",
      `The served board ("${SERVED_BOARD_SOURCE}") holds no ${season} rows at or before ${frozenAt.toISOString()}, so there is no claim to freeze. Run \`npm run projections:preseason:persist\` first.`,
    );
  }

  const rows = boards.flatMap((board) => board.rows);
  await db.transaction(async (tx) => {
    await recordFreezeRows(tx, rows);
  });

  return { season, week, frozenAt, kickoff, boards, served, rows };
}

/** The coverage report, one line, in `REGISTER_COLUMNS` order. Shared by the operator script and
 *  anything else that has to say what a freeze actually caught. */
export function formatCoverage(coverage: FreezeCoverage): string {
  return REGISTER_COLUMNS.map((column) => `${column}=${coverage[column]}`).join("  ");
}
