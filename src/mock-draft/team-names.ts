/**
 * A bot's TEAM name — what a member sees on the board and the roster rail beside the seat, never
 * the seat's owner handle (`MOCK_CONFIG.botRoster.name`, `./config`). Founder directive
 * 2026-08-26: a mock draft should feel like drafting against real fantasy managers, each with
 * their own team name, rather than a wall of "X Bot" labels — the visible "Bot" marker
 * (`MOCK_COPY.botBadge`) still carries the truth on every seat, unconditionally; the name is
 * flavor on top of it, never a substitute for it.
 *
 * `rngFor(botSeed, TEAM_NAME_STREAM_KEY)` shuffles the WHOLE `MOCK_BOT_TEAM_NAME_POOL` and takes
 * the first `count` — shuffle-then-take, never sample-with-replacement, so the names handed back
 * are always distinct within one room. Deterministic per seed: the same `botSeed` and `count`
 * draw the identical names in the identical order every time, the same replay law every other
 * seeded draw in this phase keeps (`seededShuffle`, `assignArchetypes`, `drawBotSeats`).
 */
import { MOCK_BOT_TEAM_NAME_POOL } from "./config";
import { rngFor, seededShuffle } from "./rng";

/**
 * This picker's own stream key — load-bearing for replay the same way `botRoster`'s ids and the
 * archetype deal's `"archetypes"` key are (`./config`, `./archetypes`): renaming it re-deals
 * every in-flight seeded room's team names.
 */
const TEAM_NAME_STREAM_KEY = "team-names";

/**
 * Returns `count` distinct team names, deterministic per `botSeed`, never one in `exclude`.
 *
 * The exclusion set is what makes naming correct under ANY caller batching, not just today's
 * fill-every-empty-seat-at-once shape (T2 review MEDIUM): `seatBotsInTx` passes the league's
 * EXISTING team names, so a host who named their own team straight off this pool never gets a
 * bot twin, and a hypothetical second bot batch can never re-deal the first batch's names —
 * the deck's seeded order is untouched, excluded entries are simply skipped. `count` plus the
 * plausible exclusions sit far under `MOCK_BOT_TEAM_NAME_POOL.length` (the widest room is 12
 * seats against a pool of 24, `config.test.ts`'s own gate); an exhausted pool throws rather
 * than repeating a name, the same caller-bug-worth-a-rollback posture `seatBotsInTx` takes.
 */
export function pickBotTeamNames(botSeed: number, count: number, exclude: ReadonlySet<string> = new Set()): readonly string[] {
  const deck = seededShuffle(MOCK_BOT_TEAM_NAME_POOL, rngFor(botSeed, TEAM_NAME_STREAM_KEY)).filter((name) => !exclude.has(name));
  if (deck.length < count) {
    throw new Error(`pickBotTeamNames: the team-name pool (${MOCK_BOT_TEAM_NAME_POOL.length}) cannot cover ${count} names after ${exclude.size} exclusion(s).`);
  }
  return deck.slice(0, count);
}
