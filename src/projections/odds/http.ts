/**
 * THE ODDS API'S FETCH SHAPING — SHARED between `scripts/odds-props-snapshot.ts` (the live,
 * upcoming-week snapshot) and `scripts/odds-props-backfill.ts` (the historical archive, props-
 * backfill Task 1).
 *
 * Extracted rather than duplicated a second time: `requireEnv`, `creditStatus`, `requireOk` and the
 * one-event parse (`parseOddsEvent`) were IDENTICAL between the two scripts before this file
 * existed, because both read the same `/events`-shaped event object (the live endpoint returns it
 * bare, the historical endpoint wraps it in `{ timestamp, data }` — see
 * `src/projections/odds/historical.ts` for that wrapper) and both need the same credit-header
 * bookkeeping and the same "the key is not set" refusal.
 *
 * NEVER PRINT THE KEY. `requireOk`'s error path names the friendly `path` argument a caller passes
 * (`"/events"`, `` `/events/${eventId}/odds` ``), never the URL object, which is the one place the
 * key could leak into a log or a thrown error.
 */

import { envOrUndefined } from "@/lib/env";

export const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
export const SPORT_KEY = "americanfootball_nfl";

export interface OddsEvent {
  readonly id: string;
  readonly commenceTime: Date;
  readonly homeTeam: string;
  readonly awayTeam: string;
}

export interface CreditStatus {
  readonly remaining: string;
  readonly used: string;
}

export function requireEnv(name: string): string {
  const value = envOrUndefined(name);
  if (value === undefined) {
    throw new Error(`${name} is not set. Put a The Odds API key in .env.local.`);
  }
  return value;
}

export function creditStatus(response: Response): CreditStatus {
  return {
    remaining: response.headers.get("x-requests-remaining") ?? "unknown",
    used: response.headers.get("x-requests-used") ?? "unknown",
  };
}

/** Throws WITHOUT the URL — see this file's own docblock. `path` is a friendly label the caller
 *  supplies, never the `URL` object the key was set on. */
export async function requireOk(response: Response, path: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`The Odds API returned HTTP ${response.status} for ${path}.${body ? ` Body: ${body}` : ""}`);
  }
}

/** One event object -- `{ id, commence_time, home_team, away_team }` -- as both the live and the
 *  historical `/events` endpoints shape it. `path` names the offending element on failure. */
export function parseOddsEvent(raw: unknown, path: string): OddsEvent {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} was not an object.`);
  const event = raw as Record<string, unknown>;
  const { id, commence_time: commenceTimeRaw, home_team: homeTeam, away_team: awayTeam } = event;
  if (typeof id !== "string" || id === "") throw new Error(`${path}.id is missing.`);
  if (typeof commenceTimeRaw !== "string") throw new Error(`${path}.commence_time is missing.`);
  const commenceTime = new Date(commenceTimeRaw);
  if (Number.isNaN(commenceTime.getTime())) {
    throw new Error(`${path}.commence_time is unparseable ("${commenceTimeRaw}").`);
  }
  if (typeof homeTeam !== "string" || typeof awayTeam !== "string") {
    throw new Error(`${path} is missing home_team or away_team.`);
  }
  return { id, commenceTime, homeTeam, awayTeam };
}
