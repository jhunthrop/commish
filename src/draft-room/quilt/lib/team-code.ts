import type { TeamCard } from "@/domain/league";

/**
 * The quilt's column headers are three-letter codes (the mocks' MVK / BLZ / HAW): a fantasy team
 * has no league-issued abbreviation, so the code is derived from the name — initials for a
 * multi-word name ("Bay Bandits" → BB, "Iron Corps FC" → ICF), the first three letters otherwise
 * — and uppercased. Purely presentational; every accessible name stays the full team name.
 */
export function teamCode(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  const code = words.length === 1 ? words[0]!.slice(0, 3) : words.slice(0, 3).map((word) => word.charAt(0)).join("");
  return code.toUpperCase();
}

/** teamId → code, for the whole room in one pass. */
export function teamCodesById(teams: readonly TeamCard[]): ReadonlyMap<string, string> {
  return new Map(teams.map((team) => [team.id, teamCode(team.name)]));
}
