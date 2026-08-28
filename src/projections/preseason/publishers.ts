import type { RankingCandidate } from "./benchmarks";

/**
 * FETCHING THE TWO PUBLISHED BOARDS — development-time calibration, never a runtime dependency.
 *
 * The founder's PFF ruling of 2026-08-27 set the standard this follows: a third-party source may
 * calibrate the engine at development time and may never be something a draft-week surface waits
 * on. So these run from an operator script, land in `preseason_rankings` with a publication date,
 * and nothing in the product ever calls them. If both publishers vanished tomorrow, every board the
 * engine produces would be unchanged and only the scoreboard would stop growing.
 *
 * `fetch` is injected for the same reason the nflverse client injects it: no test may touch the
 * network, and a default that quietly did would make the suite depend on somebody else's uptime.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PublishedBoard {
  readonly candidates: readonly RankingCandidate[];
  /** When the publisher says this board was current. Stored as provenance. */
  readonly publishedAt: Date;
  /** Verbatim, for the research write-up: a stamp nobody can verify should be quoted, not laundered. */
  readonly publisherStamp: string;
}

interface FfcPlayer {
  readonly name: string;
  readonly position: string;
  readonly team: string | null;
  readonly adp: number;
}

interface FfcResponse {
  readonly meta?: { readonly end_date?: string };
  readonly players?: readonly FfcPlayer[];
}

/**
 * Fantasy Football Calculator's twelve-team PPR average draft position for a past season.
 *
 * THE ONE BENCHMARK IN THIS ENGINE WITH AN HONEST DATE ON IT. The API returns the window the drafts
 * it averaged were run in, and for every season measured that window closes in the last days of
 * August — strictly before the opener. That is what makes this a real point-in-time market price
 * rather than a current-value column, which is exactly what
 * `docs/research/2026-08-27-decision-quality.md` said the repository was missing.
 *
 * It is SHALLOW, and the depth is the limitation to remember: fifteen rounds of a twelve-team draft
 * is roughly two hundred players, so there is no market price at all past about rank 205. The deep
 * band a manager wins a league in runs to 400, and beyond 205 there is simply nobody to beat. That
 * is a fact about the market rather than a gap in the ingestion, and the research document says so
 * rather than quietly scoring the deep band on its shallow half.
 */
export async function fetchAverageDraftPosition(
  season: number,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<PublishedBoard> {
  const url = `https://fantasyfootballcalculator.com/api/v1/adp/ppr?year=${season}&teams=12&position=all`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Fantasy Football Calculator returned HTTP ${response.status} for ${season}.`);
  }
  const body = (await response.json()) as FfcResponse;
  const players = body.players ?? [];
  if (players.length === 0) {
    throw new Error(`Fantasy Football Calculator published no ${season} board; there is no market price to score against.`);
  }
  const endDate = body.meta?.end_date;
  if (endDate === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Fantasy Football Calculator's ${season} board carries no draft window; an undated market price is not a benchmark.`);
  }
  return {
    candidates: players.map((player) => ({
      name: player.name,
      position: player.position,
      team: player.team,
      rank: player.adp,
    })),
    // The day after the last draft it averaged: the earliest moment the average itself existed.
    publishedAt: new Date(Date.parse(`${endDate}T00:00:00.000Z`) + MILLISECONDS_PER_DAY),
    publisherStamp: endDate,
  };
}

interface FantasyProsPlayer {
  readonly player_name?: string;
  readonly player_position_id?: string;
  readonly player_team_id?: string;
  readonly rank_ecr?: number;
}

interface FantasyProsBoard {
  readonly year?: string;
  readonly last_updated?: string;
  readonly players?: readonly FantasyProsPlayer[];
}

/**
 * FantasyPros' archived expert consensus draft board for a past season.
 *
 * THE STAMP ON THIS ONE IS NOT TRUSTWORTHY AND IS NOT PRETENDED TO BE. The archive embeds a bare
 * `M/D` with no year, and the values it carries across seasons are not consistent with a single
 * meaning — one season's board reads as a date after that season's opener, another's reads as a
 * date in the following February. The board's CONTENTS are unambiguously an end-of-preseason
 * consensus (the top of each year's is that August's consensus, and each carries that April's
 * rookies), so the content is usable and the stamp is not.
 *
 * The stamp is therefore recorded verbatim in `publisherStamp` and the stored `publishedAt` is the
 * season's opening week, which is the LATEST moment the board could honestly claim. Erring late
 * here credits the benchmark with more information than it may have had, which is the direction
 * that cannot flatter us. See `docs/research/2026-08-27-preseason-board.md`, which states this in
 * the same paragraph as the number it affects.
 */
export async function fetchExpertConsensus(
  season: number,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<PublishedBoard> {
  const url = `https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php?year=${season}`;
  const response = await fetchImpl(url, { headers: { "user-agent": "commish-projection-engine/1.0" } });
  if (!response.ok) {
    throw new Error(`FantasyPros returned HTTP ${response.status} for ${season}.`);
  }
  const board = parseExpertConsensus(await response.text(), season);
  return board;
}

/**
 * Pulls the consensus board out of the page's embedded JSON.
 *
 * Separated from the fetch so the parser is testable without a network call, and because a scrape's
 * failure mode is a silent shape change: the page still returns 200 and the board is simply absent.
 * Throwing by name here is what turns that into an operator's problem rather than a benchmark that
 * quietly has no rows.
 */
export function parseExpertConsensus(html: string, season: number): PublishedBoard {
  const match = /ecrData\s*=\s*(\{[\s\S]*?\});\s*\n/.exec(html);
  if (match === null) {
    throw new Error(`FantasyPros' ${season} page carries no ecrData block; the page shape has changed.`);
  }
  const board = JSON.parse(match[1]!) as FantasyProsBoard;
  if (board.year !== String(season)) {
    throw new Error(`FantasyPros returned a board for ${board.year ?? "no season"} when asked for ${season}.`);
  }
  const players = (board.players ?? []).filter(
    (player): player is Required<Pick<FantasyProsPlayer, "player_name" | "player_position_id" | "rank_ecr">> &
      FantasyProsPlayer => player.player_name !== undefined && player.player_position_id !== undefined && player.rank_ecr !== undefined,
  );
  if (players.length === 0) {
    throw new Error(`FantasyPros' ${season} board carries no ranked players.`);
  }
  return {
    candidates: players.map((player) => ({
      name: player.player_name,
      position: player.player_position_id,
      // The archive writes `FA` where it has lost a player's team. Null rather than a fake club, so
      // the resolver treats it as "no tiebreak available" instead of matching him to a team.
      team: player.player_team_id === undefined || player.player_team_id === "FA" ? null : player.player_team_id,
      rank: player.rank_ecr,
    })),
    publishedAt: new Date(Date.UTC(season, 8, 8)),
    publisherStamp: board.last_updated ?? "none",
  };
}
