/**
 * THE TEAM'S OWN NAMES — the code this engine stores, and the city and nickname a person says out
 * loud for it.
 *
 * WHY IT EXISTS (capsule acceptance round, 2026-09-07): the capsule validator grounds every
 * multi-word proper name against the fact sheet's own name ledger, and that ledger carried only
 * the stored CODE ("NYG"). A writer told the player plays for NYG and then writing "New York" was
 * failing grounding for naming the team it had just been given, which is a false positive, not a
 * fabrication. Every spelling of a team the facts name is now ledgered.
 *
 * BOTH SPELLINGS OF THE THREE FRANCHISES THIS REPO DISAGREES WITH ITSELF ABOUT are keys here
 * (`LA`/`LAR`, `WAS`/`WSH`, `LV`/`OAK`), because two feeds in this codebase spell them differently
 * (`NFL_TEAM_ABBREVIATIONS` uses `LAR`/`WSH`, nflverse uses `LA`/`WAS`) and a lookup that knew only
 * one would silently ground nothing for the other. A code with no entry returns `undefined` and
 * the ledger simply carries the code alone, exactly as it did before this file.
 */

export interface NflTeamNames {
  readonly city: string;
  readonly nickname: string;
}

export const NFL_TEAM_NAMES: Readonly<Record<string, NflTeamNames>> = {
  ARI: { city: "Arizona", nickname: "Cardinals" },
  ATL: { city: "Atlanta", nickname: "Falcons" },
  BAL: { city: "Baltimore", nickname: "Ravens" },
  BUF: { city: "Buffalo", nickname: "Bills" },
  CAR: { city: "Carolina", nickname: "Panthers" },
  CHI: { city: "Chicago", nickname: "Bears" },
  CIN: { city: "Cincinnati", nickname: "Bengals" },
  CLE: { city: "Cleveland", nickname: "Browns" },
  DAL: { city: "Dallas", nickname: "Cowboys" },
  DEN: { city: "Denver", nickname: "Broncos" },
  DET: { city: "Detroit", nickname: "Lions" },
  GB: { city: "Green Bay", nickname: "Packers" },
  HOU: { city: "Houston", nickname: "Texans" },
  IND: { city: "Indianapolis", nickname: "Colts" },
  JAX: { city: "Jacksonville", nickname: "Jaguars" },
  KC: { city: "Kansas City", nickname: "Chiefs" },
  LA: { city: "Los Angeles", nickname: "Rams" },
  LAR: { city: "Los Angeles", nickname: "Rams" },
  LAC: { city: "Los Angeles", nickname: "Chargers" },
  LV: { city: "Las Vegas", nickname: "Raiders" },
  OAK: { city: "Oakland", nickname: "Raiders" },
  MIA: { city: "Miami", nickname: "Dolphins" },
  MIN: { city: "Minnesota", nickname: "Vikings" },
  NE: { city: "New England", nickname: "Patriots" },
  NO: { city: "New Orleans", nickname: "Saints" },
  NYG: { city: "New York", nickname: "Giants" },
  NYJ: { city: "New York", nickname: "Jets" },
  PHI: { city: "Philadelphia", nickname: "Eagles" },
  PIT: { city: "Pittsburgh", nickname: "Steelers" },
  SEA: { city: "Seattle", nickname: "Seahawks" },
  SF: { city: "San Francisco", nickname: "49ers" },
  TB: { city: "Tampa Bay", nickname: "Buccaneers" },
  TEN: { city: "Tennessee", nickname: "Titans" },
  WAS: { city: "Washington", nickname: "Commanders" },
  WSH: { city: "Washington", nickname: "Commanders" },
  SD: { city: "San Diego", nickname: "Chargers" },
  STL: { city: "St. Louis", nickname: "Rams" },
};

/** Every way a person writes one team: its code, its city, its nickname, and the two together.
 *  An unknown code grounds only itself, never a guessed city. */
export function teamNameForms(code: string): readonly string[] {
  const trimmed = code.trim();
  if (trimmed === "") return [];
  const names = NFL_TEAM_NAMES[trimmed.toUpperCase()];
  if (names === undefined) return [trimmed];
  return [trimmed, names.city, names.nickname, `${names.city} ${names.nickname}`];
}
