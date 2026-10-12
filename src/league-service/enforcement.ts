import { eq } from "drizzle-orm";
import type { ReadonlyDb } from "@research-ts/db/client";
import { leagues } from "@/db/schema";
import type { ExperienceTier } from "@/domain/user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { participationTierFor } from "@/participation/tier";
import { completedSeasonsFor } from "./participation";

/**
 * THE HOLE THE SPEC NEVER SAW (ruling 6), and the one predicate both doors read.
 *
 * Step 6 blocks a `veteran` from JOINING a `beginner` public league through
 * `publicJoinPrecondition`. Nothing in the spec blocks a `veteran` from CREATING one:
 * `leagues.experience_tier` is self-declared by whoever creates the league, and a creator never
 * passes through a join precondition at all — so a veteran declaring their own public league
 * `beginner` and waiting for it to fill is the exact abuse §4.1's segregation exists to prevent,
 * executed through the one door the segregation does not cover.
 *
 * This module is the SINGLE place that predicate lives. `src/league-service/join.ts`'s
 * `publicJoinPrecondition` and `src/league-service/creation.ts`'s `createLeague` both ask it the
 * same question about the same two facts (is this league public-and-enforced, is it declared for
 * beginners) and get the same answer — the refusal COPY differs at each call site (one person is
 * being turned away from somebody else's league; the other is being told to change one field of
 * their own), but the RULE that decides who is turned away exists exactly once.
 *
 * Deliberately NOT `Pick<typeof leagues.$inferSelect, ...>` (`@research-ts/db/schema`'s row type): a creator
 * asks this question about a league that does not have a row yet, before the `INSERT` that would
 * give it one, just as readily as a joiner asks it about a league that already does — so this is
 * the smallest shape either caller can supply, real row or proposed one.
 */
export interface PublicLeagueEnforcementPolicy {
  readonly isPublicMatchmade: boolean;
  readonly experienceTier: ExperienceTier;
}

/**
 * The one answer to "is the platform this league's commissioner?" — `is_public_matchmade` AND
 * `INTEGRITY_CONFIG.participation.enforceTierSegregation`. Every automated action this plan takes
 * asks it and none of them re-derives it, which is what makes the spec's matched public-versus-
 * private pair a property of one function rather than a promise repeated in four places.
 *
 * IT IS NOT A PER-LEAGUE DATABASE FLAG. The spec's rollback says "per-league feature flag", and a
 * boolean column with no UI, no script and no caller that could ever set it would be the control
 * wired to nothing this phase has refused four times (ruling 17). The per-league axis already
 * exists and is `is_public_matchmade`; the platform axis is one config boolean settable at deploy,
 * exactly the way `INTEGRITY_CONFIG.trade.autoHoldThreshold` is. Both are tested in both states.
 *
 * A PRIVATE league answers `false` regardless of the switch: `is_public_matchmade` is the axis
 * that puts a league in front of a stranger at all, and this platform never polices what a
 * commissioner does inside a group they invited by hand.
 */
export function enforcementAppliesTo(league: Pick<PublicLeagueEnforcementPolicy, "isPublicMatchmade">): boolean {
  return league.isPublicMatchmade && INTEGRITY_CONFIG.participation.enforceTierSegregation;
}

/**
 * The DEPLOY half of `enforcementAppliesTo`, asked on its own — and DEFINED in terms of it, never
 * as a second read of the config, so the rule still exists exactly once (final review F18).
 *
 * The two SCANS need this shape and the gate paths do not. `autoStartDueDrafts`
 * (`@/draft-service/auto-start`) and `autoSetLineupsForWeek` (`./auto-lineup`) both ask it FIRST,
 * before any query runs at all: enforcement being off means the scan does not happen, rather than
 * every row it would have found being refused one at a time. Both used to spell it
 * `enforcementAppliesTo({ isPublicMatchmade: true })` inline, which reads as a claim about a
 * league that does not exist; this says what it means.
 */
export function enforcementIsSwitchedOn(): boolean {
  return enforcementAppliesTo({ isPublicMatchmade: true });
}

/**
 * The PER-LEAGUE half, as the SQL predicate a scan applies inside its own candidate query — the
 * second copy final review F18 named ("`enforcement.ts`'s 'single place that predicate lives' is
 * true for 3 of 4 sites"). Both scans import THIS rather than hand-writing
 * `eq(leagues.isPublicMatchmade, true)`, so the axis is one expression wherever it is asked,
 * whether in TypeScript or in SQL.
 *
 * It is the `is_public_matchmade` axis ALONE and deliberately carries no config read: a `WHERE`
 * clause cannot branch on a deploy switch, which is exactly why the switch is asked first, in
 * TypeScript, by `enforcementIsSwitchedOn` above.
 */
export const ENFORCED_LEAGUE_SQL = eq(leagues.isPublicMatchmade, true);

/**
 * The two refusals this rule can ever say, named once so the join gate and the creation gate
 * never hand-type a copy of the other's sentence. Different sentences on purpose — the two
 * moments are different people being told different things, never the same words with a
 * find-and-replace on the subject.
 */
export const ENFORCEMENT_REFUSALS = {
  join: "This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join.",
  create: "You have played enough seasons here that you cannot open a league reserved for newer players. Open it to everyone instead.",
} as const;

/**
 * THE predicate: is THIS account blocked from THIS league by tier segregation. `false` for
 * everything except the one shape the segregation exists for — a `veteran` account against a
 * league that is both public-and-enforced (`enforcementAppliesTo`) AND declared `beginner` —
 * checked in that order so the common case (a private league, an `experienced` league, or
 * segregation switched off at deploy) never reaches the completed-seasons read at all.
 *
 * `db` is a `ReadonlyDb` (`Pick<Db, "select">`), not a `DbTx`, on purpose: `publicJoinPrecondition`
 * (`@/league-service/join`) calls this from INSIDE the join transaction, where the caller holds a
 * `DbTx`; `createLeague` (`@/league-service/creation`) calls it BEFORE its transaction ever opens,
 * where the caller holds a plain `Db` — both satisfy `ReadonlyDb` structurally, so this stays the
 * one implementation either door can call rather than a version each.
 *
 * FK LOCK NOTE, folded into the callers' own enumeration: this function issues exactly one read
 * (`completedSeasonsFor`'s `teams` INNER JOIN `leagues`, filtered on `season_completed_at IS NOT
 * NULL`) and takes no lock of its own beyond whatever the caller's own statement already holds.
 */
export async function tierJoinPrecondition(db: ReadonlyDb, league: PublicLeagueEnforcementPolicy, userId: string): Promise<boolean> {
  if (!enforcementAppliesTo(league) || league.experienceTier !== "beginner") return false;
  const completedSeasons = await completedSeasonsFor(db, userId);
  return participationTierFor(completedSeasons, INTEGRITY_CONFIG.participation.veteranSeasonCutoff) === "veteran";
}
