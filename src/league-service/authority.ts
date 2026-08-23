import type { HouseRungName } from "@/matchmaking/house-catalog";

/**
 * The one answer to "who commissions this league", as a discriminated union rather than a
 * nullable-string comparison. Phase 3.5 addendum, Task 12 (ruling 28-33): a house league has
 * `leagues.commissioner_user_id === null` and `leagues.house_rung !== null` — the platform runs
 * it, and NO ONE holds commissioner powers there, operators included. `leagues.house_commissioner
 * _ck` (`drizzle/0032_house_leagues.sql`) is what keeps a row from ever disagreeing about which
 * of the two states it is in; this module is what keeps every reader answering that question the
 * same way once a row commits.
 *
 * The seven `league.commissionerUserId === userId` comparisons this addendum found (six sites,
 * plus `read.ts`'s `commissionerTeamId` `find`) all collapse onto `isCommissionerOf` below. That
 * matters beyond tidiness: `x === userId` with a nullable `x` is a silent authority grant the
 * moment `userId` is ever widened to `string | null | undefined` — the worst possible failure
 * direction for an authorization check. `isCommissionerOf` cannot fail that way, because its
 * `house` branch returns `false` before any comparison runs at all.
 */

/**
 * A catalog rung name, narrowed to the real union. Fix round 1, F1: `src/matchmaking/
 * house-catalog.ts` (Task 13) now exists and is the ONE place `HouseRungName` (`keyof typeof
 * HOUSE_CATALOG.rungs`) is declared — this module imports it as a TYPE ONLY (`import type`),
 * never a value, so a server module (this one) reading a browser-safe, pure directory's type
 * costs nothing at runtime and creates no new dependency edge worth worrying about. A second
 * `HouseRungName` declared here would have been exactly the duplicate-declaration this codebase's
 * label-map convention (`ROSTER_SHAPE_LABEL`, `TIER_COMPOSITION_LABEL`, ...) refuses; importing
 * the real one is what that convention actually asks for.
 */
export type LeagueAuthority =
  | { readonly kind: "member"; readonly userId: string }
  | { readonly kind: "house"; readonly rung: HouseRungName };

/** The two `leagues` columns `leagueAuthority` and `isCommissionerOf` read — every caller already
 *  has these off a plain `leagues` select, house or member. `houseRung` stays a plain `string |
 *  null` here (the column's own Postgres type, `text`, unconstrained to the catalog's own
 *  vocabulary) — `leagueAuthority` below is the one place a raw row's string is trusted into
 *  `HouseRungName`, not this row shape itself. */
export interface LeagueAuthorityRow {
  readonly commissionerUserId: string | null;
  readonly houseRung: string | null;
}

/**
 * Reads the union off a row. Throws rather than guessing on a row the CHECK constraint should
 * have refused before it ever committed — `leagues_house_commissioner_ck` makes both throw
 * branches below unreachable from Postgres, but a unit test can still construct the shape by
 * hand, and a future reader needs the invariant stated here in TypeScript as well as in DDL.
 *
 * The `house` branch's `row.houseRung as HouseRungName` is the one cast in this module, and it
 * is safe for a reason no `CHECK` constraint states: `house_rung` has exactly one writer in this
 * codebase, `spawnHouseLeagueInTx` (`@/league-service/house-factory.ts`), and it never writes
 * anything but a real `HOUSE_CATALOG` key. A row bearing a string outside that vocabulary would
 * mean a second writer exists — a fact worth a loud failure somewhere else, not a silent `string`
 * leaking past this function's own return type into every caller that trusts `LeagueAuthority`.
 */
export function leagueAuthority(row: LeagueAuthorityRow): LeagueAuthority {
  if (row.commissionerUserId !== null) {
    if (row.houseRung !== null) {
      throw new Error(
        "A league row named both a commissioner_user_id and a house_rung; leagues_house_commissioner_ck should have refused this before it committed.",
      );
    }
    return { kind: "member", userId: row.commissionerUserId };
  }
  if (row.houseRung === null) {
    throw new Error(
      "A league row named neither a commissioner_user_id nor a house_rung; leagues_house_commissioner_ck should have refused this before it committed.",
    );
  }
  return { kind: "house", rung: row.houseRung as HouseRungName };
}

/**
 * The one predicate every commissioner-gated door reads. A total function over the union, not an
 * equality against a nullable string — see this module's own docblock for why that direction
 * matters. Nobody is commissioner of a house league, including an operator: an operator's
 * authority is `users.isAdmin` and it reaches the admin surface, not this one, and a house
 * league has no commissioner seat for anybody to occupy in the first place.
 */
export function isCommissionerOf(row: LeagueAuthorityRow, userId: string): boolean {
  const authority = leagueAuthority(row);
  return authority.kind === "member" && authority.userId === userId;
}

/**
 * The two commissioner-only doors a house league closes, and the true sentences they answer with
 * instead of a refusal about a commissioner that does not exist. Ruling 32: both REFUSE rather
 * than routing to the operator console — handing discretionary commissioner powers to an
 * operator is the same trust problem a stranger-run league would be.
 *
 * A third refusal (league settings) was drafted and is deliberately NOT written here: there is no
 * league-settings write endpoint in this product, and a refusal string with no caller is wired to
 * nothing.
 */
export const HOUSE_AUTHORITY_REFUSALS = {
  invite: "House leagues are open to everyone, so they don't use invite links. Share the league's page instead.",
  schedule: "Commish picks the draft time when a house league opens, because everyone here chose their seat around it.",
} as const;
