import type { PublicLeagueSummary } from "./contract";

/**
 * THE SHELF'S ONE SORT SENTENCE (front door blueprint, 2026-09-02): "Sorted by soonest draft
 * you can still join." This module is that sentence as a pure comparator, browser-safe like the
 * rest of `src/matchmaking/**` — no I/O, no ambient clock (`Date.parse` of a parameter is the
 * only date arithmetic, and it reads nothing but its argument).
 *
 * WHY SEATS REMAINING LEADS, for BOTH triggers. A `when_full` room fires the moment its last
 * seat fills (`fireWhenFullInTx`), so its seats-remaining count IS its countdown. A `scheduled`
 * room's chosen kickoff is only a lower bound: an unfilled scheduled room ROLLS forward a day
 * at a time until it fills (the founder's "roll until full" ruling, `rollUnfilledDraftInTx`),
 * so proximity-to-full is the honest predictor of "the draft you can still join" there too. A
 * chosen kickoff therefore breaks TIES — at equal seats remaining the room with the sooner
 * chosen instant drafts first, and a chosen instant beats none — it never outranks a room that
 * is genuinely closer to firing.
 */
function seatsRemaining(league: PublicLeagueSummary): number {
  return league.teamCount - league.filledTeams;
}

/**
 * A `scheduled` league's chosen kickoff in ms, or `Infinity` for `when_full` (whose stored
 * instant is a placeholder nobody chose — `PublicLeagueSummary.startTrigger`'s own docblock)
 * and for a summary that carries no instant at all.
 */
function chosenKickoffMs(league: PublicLeagueSummary): number {
  if (league.startTrigger !== "scheduled" || league.draftAtIso === undefined) return Infinity;
  const ms = Date.parse(league.draftAtIso);
  return Number.isNaN(ms) ? Infinity : ms;
}

/** The comparator: seats remaining ascending, chosen kickoff ascending as the tiebreak, input
 *  order (a stable sort's own guarantee) as the final one. */
export function soonestJoinableOrder(a: PublicLeagueSummary, b: PublicLeagueSummary): number {
  const bySeats = seatsRemaining(a) - seatsRemaining(b);
  if (bySeats !== 0) return bySeats;
  const aKick = chosenKickoffMs(a);
  const bKick = chosenKickoffMs(b);
  if (aKick === bKick) return 0;
  if (aKick === Infinity) return 1;
  if (bKick === Infinity) return -1;
  return aKick - bKick;
}

/** A NEW array in soonest-joinable order — never a mutation of the caller's list. */
export function sortBySoonestJoinableDraft(leagues: readonly PublicLeagueSummary[]): readonly PublicLeagueSummary[] {
  return [...leagues].sort(soonestJoinableOrder);
}

/**
 * THE house sentence — moved here from `public-league-list.tsx` (front door blueprint,
 * 2026-09-02) when that module became a client component: `/browse`'s SERVER render interpolates
 * this string into its own JSX, and a value imported from a "use client" module is a client
 * reference a server component cannot read. The words are FOUNDER-ORDERED (2026-08-24) and
 * unchanged; only the module moved. The factory's user-visible contract survives inside it
 * verbatim, printable only because the reconciler makes it true by construction
 * (`ensureHouseCatalog`, `@/league-service/house-factory.ts`).
 */
export const HOUSE_SHELF_SENTENCE =
  "Commish runs some of these leagues itself, and a new league opens as soon as one fills, so there is always a seat.";

/**
 * THE FULLEST FILLING LEAGUE — house or member, with at least one seat taken. `null` when
 * nothing qualifies, because an untouched lobby is not a room that is filling and the board
 * features nothing rather than dressing one up. Pure and clock-free — moved here from
 * `public-league-list.tsx` with `HOUSE_SHELF_SENTENCE` above, for the same client-boundary
 * reason: `src/app/page.tsx` and `/browse` CALL these from server renders.
 *
 * A ROLLED KICKOFF NO LONGER DISQUALIFIES A ROOM (the doors-and-rooms fix round, 2026-09-10),
 * reversing storefront review R1's E4 clause. A roll is a fact about the DATE, and the row shows
 * the date current — it is not a reason to withhold the board's one verb. The cost of E4 was
 * measured on the dev board: every filling room there had rolled (rooms roll until they fill, by
 * the founder's own "roll until full" ruling), so NOTHING was ever featured, no row wore the
 * amber wash, and the board rendered as nine identical outline pills while the header pill
 * carried the page's only solid. The rule that was meant to protect the feature from an unkept
 * promise had quietly turned the feature off.
 *
 * THE TIE-BREAKS, in order: fewest seats remaining, then the sooner chosen draft, then the room
 * with a claim in flight. `PublicLeagueSummary` carries no claim timestamp and will not get one
 * (a per-claim instant is a fact about a PERSON acting, which that contract's privacy boundary
 * refuses), so `heldSeats` — a seat somebody is claiming right now — is the honest reading of
 * "most recently claimed". List order settles a total tie, so one rendered board has exactly one
 * deterministic answer.
 */
function featuredOrder(a: PublicLeagueSummary, b: PublicLeagueSummary): number {
  const bySeats = seatsRemaining(a) - seatsRemaining(b);
  if (bySeats !== 0) return bySeats;
  const aKick = chosenKickoffMs(a);
  const bKick = chosenKickoffMs(b);
  if (aKick !== bKick) {
    if (aKick === Infinity) return 1;
    if (bKick === Infinity) return -1;
    return aKick - bKick;
  }
  return b.heldSeats - a.heldSeats;
}

function fullestFillingLeague(leagues: readonly PublicLeagueSummary[]): PublicLeagueSummary | null {
  const filling = leagues.filter((league) => league.filledTeams > 0);
  if (filling.length === 0) return null;
  return filling.reduce((best, league) => (featuredOrder(league, best) < 0 ? league : best));
}

/**
 * Which league, if any, is the shelf's single featured one — the fullest filling league, else
 * the fewest seats remaining across the WHOLE shelf (the only fallback left once nothing is
 * genuinely filling). Ties keep list order, so the answer is deterministic for one rendered
 * shelf.
 */
export function featuredLeagueId(leagues: readonly PublicLeagueSummary[]): string | null {
  if (leagues.length === 0) return null;
  const fullest = fullestFillingLeague(leagues);
  if (fullest !== null) return fullest.id;
  return leagues.reduce((tightest, league) => (seatsRemaining(league) < seatsRemaining(tightest) ? league : tightest)).id;
}

/**
 * The SAME league `featuredLeagueId` marks featured, but ONLY the genuinely filling case —
 * never the fallback tightest-seats pick (E4: never feature an empty room). The page-level
 * caller (`page.tsx`'s nav-pill arithmetic, `/browse`'s lower third) needs the league OBJECT;
 * `null` says feature nothing at all — real or absent, never dressed up.
 */
export function featuredFillingLeague(leagues: readonly PublicLeagueSummary[]): PublicLeagueSummary | null {
  return fullestFillingLeague(leagues);
}
