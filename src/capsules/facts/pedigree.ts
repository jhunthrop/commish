import type { PlayerFactsPedigree } from "./types";

/**
 * AGE, EXPERIENCE AND PEDIGREE (spec §4, fact 5; inventory rows 5, 5b and 5c).
 *
 * Age is the strongest single prior this board carries and the sheet never stated it: a law could
 * move a projection by a point and a half on the age curve, and the writer was told the effect
 * without ever being told the number behind it.
 *
 * EVERY FIELD FROM A REAL ROW, EACH INDEPENDENTLY ABSENT:
 *   - `preseason_rosters` for the birth date, the entry year, the overall pick and the drafting
 *     club, all of them settled at the cutdown deadline the row is stamped for;
 *   - `nfl_players.rookie_season` for seasons played;
 *   - `nfl_draft_picks.round` for the round, which is the ONE field only that table carries;
 *   - the harvest roster sweep's own `school` for the college.
 *
 * AGE IS COMPUTED FROM TWO STORED VALUES AND NEVER FROM A CLOCK — a stored birth date against the
 * season's own first kickoff instant — so the same player yields the same age on every machine and
 * in every replay, which a `new Date()` in this function would quietly break.
 *
 * `undrafted` IS A CLAIM, SO IT NEEDS EVIDENCE. It is `true` only when the roster row itself names
 * an entry year and carries no pick, which is that file's own way of saying he came in undrafted.
 * A player with no roster row at all gets `null`: a missing row is not evidence of anything, and
 * "the archive does not list him" is not "he was not drafted".
 */

export interface PedigreeInput {
  readonly birthDate: string | null;
  /** The season's own first kickoff instant, from the schedule store. `null` before the schedule
   *  has been ingested, which makes the age absent rather than computed against today. */
  readonly openingDay: Date | null;
  readonly rookieSeason: number | null;
  readonly productSeason: number;
  readonly draftYear: number | null;
  readonly draftRound: number | null;
  readonly draftPick: number | null;
  readonly draftClub: string | null;
  readonly college: string | null;
}

const DAYS_IN_A_YEAR = 365.25;
const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

/** Years to one decimal, or `null` when either half is missing or the birth date is unreadable. */
function ageOn(birthDate: string | null, openingDay: Date | null): number | null {
  if (birthDate === null || openingDay === null) return null;
  const born = Date.parse(`${birthDate.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(born)) return null;
  const years = (openingDay.getTime() - born) / MS_IN_A_DAY / DAYS_IN_A_YEAR;
  return years <= 0 ? null : Math.round(years * 10) / 10;
}

/** How many seasons he has already played, from his rookie season. Never negative: a rookie season
 *  after the product season is a contradiction in the store, and zero is the honest reading of it. */
function seasonsPlayed(rookieSeason: number | null, productSeason: number): number | null {
  if (rookieSeason === null) return null;
  return Math.max(0, productSeason - rookieSeason);
}

/** One player's pedigree, or `null` when not one field of it has a row behind it. */
export function pedigreeFor(input: PedigreeInput): PlayerFactsPedigree | null {
  const pedigree: PlayerFactsPedigree = {
    ageOnOpeningDay: ageOn(input.birthDate, input.openingDay),
    college: input.college,
    seasonsPlayed: seasonsPlayed(input.rookieSeason, input.productSeason),
    draftYear: input.draftYear,
    draftRound: input.draftRound,
    draftPick: input.draftPick,
    draftClub: input.draftClub,
    undrafted: input.draftYear === null ? null : input.draftPick === null,
  };
  const stated = Object.values(pedigree).some((value) => value !== null);
  return stated ? pedigree : null;
}
