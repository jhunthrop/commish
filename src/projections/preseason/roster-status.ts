import type { BoardReason } from "./board";

/**
 * A PLAYER'S CURRENT ROSTER STATUS — the vocabulary, the readers of the two Tank01 payloads, and
 * the rule that turns those payloads and a week-one nflverse code into one dated status.
 *
 * THE DEFECT THIS CLOSES (founder report, 2026-09-08): the board read a player's status from the
 * nflverse week-one file alone (`preseason_rosters`, stamped at the cutdown), so a man placed on
 * injured reserve on the fourth of September projected thirteen games on the eighth, a man cut to
 * the practice squad kept his row, and a man nobody signed sat at 344. The harvest already held a
 * roster sweep and a player list four days fresher than the cutdown file, and nothing read them.
 *
 * EVERY STATUS IS A DATED OBSERVATION FROM A NAMED SOURCE. `CurrentRosterStatus` carries which
 * store said so and when it was captured, and absence from a source is never read as a status:
 * a player no source names this season is `unknown`, which means absent from every map this
 * module builds, and the board leaves him exactly as he was.
 *
 * PRECEDENCE, stated once here and applied in `roster-status-read.ts`: a dated harvest row over the
 * week-one nflverse row over the depth chart. Within the harvest the two captures carry different
 * halves of the fact — the 32-team sweep is MEMBERSHIP of each club's active roster (no injured
 * reserve player appears on it, measured on the 2026-09-05 capture), the player list carries the
 * club, the free-agent flag and the reserve DESIGNATION — so the later capture's word wins where
 * they can disagree (`currentStatusFromTank01`).
 *
 * WHAT "OFF THE ACTIVE ROSTER" MEANS AND DOES NOT. Tank01 has no practice-squad flag. A man the
 * player list places with a club, with no reserve designation, who is absent from that club's
 * roster sweep is NOT on the active roster as the feed sees it; this module names exactly that
 * (`off_active_roster`) and never guesses "practice squad" from it, because a physically-unable
 * or non-football-injury man the feed carries no designation for reads identically. The nflverse
 * `DEV` code is the only source that says practice squad, and it says so by name.
 *
 * PURE. No store, no React, no clock: the readers take a parsed payload, the rule takes values.
 * `roster-status-read.ts` owns the reads, `roster-status-gate.ts` owns what the board does with a
 * status, `roster-status-copy.ts` owns every word a surface prints about one.
 */

export const ROSTER_STATUS_KINDS = [
  "active",
  "injured_reserve",
  "pup",
  "nfi",
  "suspended",
  "exempt",
  "practice_squad",
  "off_active_roster",
  "no_roster",
  "retired",
] as const;
export type RosterStatusKind = (typeof ROSTER_STATUS_KINDS)[number];

export const ROSTER_STATUS_SOURCES = ["tank01_roster_sweep", "tank01_player_list", "nflverse_roster_week_1", "depth_chart"] as const;
export type RosterStatusSource = (typeof ROSTER_STATUS_SOURCES)[number];

export interface CurrentRosterStatus {
  readonly kind: RosterStatusKind;
  readonly source: RosterStatusSource;
  /** When the source captured or stamped the fact. Never derived. */
  readonly observedAt: Date;
  /** The club the source lists him with, in the source's own code; `null` when it lists none. */
  readonly team: string | null;
}

export type RosterStatusReason = Extract<BoardReason, { code: "roster_status" }>;

/** The board's stored `roster_status` reason, read back for a surface: the same fields plus
 *  whether that status took him off the ranked board. */
export interface RosterStatusNote {
  readonly status: RosterStatusKind;
  readonly source: RosterStatusSource;
  readonly observedAt: string;
  readonly team: string | null;
  readonly excluded: boolean;
}

/** Reserve designations: he is under contract and unavailable for a stated minimum. Capped. */
const CAPPED_STATUSES: ReadonlySet<RosterStatusKind> = new Set(["injured_reserve", "pup", "nfi", "suspended", "exempt"]);

/** Off the active roster: no projection at all. See `roster-status-gate.ts`. */
const EXCLUDED_STATUSES: ReadonlySet<RosterStatusKind> = new Set(["practice_squad", "off_active_roster", "no_roster", "retired"]);

export function isCappedRosterStatus(kind: RosterStatusKind): boolean {
  return CAPPED_STATUSES.has(kind);
}

export function isExcludedRosterStatus(kind: RosterStatusKind): boolean {
  return EXCLUDED_STATUSES.has(kind);
}

const NUMBERED_EXEMPTION = /^E\d{2}$/;

/**
 * The league's own week-one roster code, as `nflverse_roster_weeks` archives it verbatim.
 * `ACT`/`INA` are both active (`nflverse/rosters.ts`'s own ruling: a game-day inactive is not a
 * roster status). The trade codes, `RSN`, `NWT`, `RSR` and anything else are `null`: a code this
 * module does not know is a code it says nothing about, never a reserve list by default.
 */
export function rosterStatusFromNflverseCode(code: string): RosterStatusKind | null {
  const normalised = code.trim().toUpperCase();
  if (NUMBERED_EXEMPTION.test(normalised)) return "exempt";
  switch (normalised) {
    case "ACT":
    case "INA":
      return "active";
    case "RES":
      return "injured_reserve";
    case "PUP":
      return "pup";
    case "NON":
      return "nfi";
    case "SUS":
      return "suspended";
    case "EXE":
      return "exempt";
    case "DEV":
      return "practice_squad";
    case "CUT":
      return "no_roster";
    case "RET":
      return "retired";
    default:
      return null;
  }
}

/** One player as the Tank01 player list describes him. Every field is the feed's own, unparsed. */
export interface Tank01Listing {
  readonly team: string | null;
  readonly isFreeAgent: boolean;
  readonly designation: string | null;
}

/** The newest roster sweep: when it was taken, and which club each ESPN id was on the active roster of. */
export interface RosterSweepCapture {
  readonly capturedAt: Date;
  readonly teamByEspnId: ReadonlyMap<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Tank01's own `playerID` is its ESPN id; both are read so either spelling of a payload resolves. */
function espnIdOf(player: Record<string, unknown>): string | null {
  return asText(player.espnID) ?? asText(player.playerID);
}

/**
 * `tank01_injuries`: an array of clubs, each with a `roster` of the players on its active roster.
 * Read as membership only — the designation half of this feed is `harvest-captures.ts`'s job. A
 * payload of another shape reads as an empty sweep, never as thirty-two empty rosters.
 */
export function readActiveRosterSweep(payload: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(payload)) return out;
  for (const rawTeam of payload) {
    const club = asRecord(rawTeam);
    const team = asText(club.team);
    if (team === null || !Array.isArray(club.roster)) continue;
    for (const rawPlayer of club.roster) {
      const espnId = espnIdOf(asRecord(rawPlayer));
      if (espnId !== null) out.set(espnId, team);
    }
  }
  return out;
}

/** `tank01_player_list`: every player the provider knows, with `team`, `isFreeAgent` ("True"/"False"
 *  as text) and an `injury.designation`. An empty designation is the feed saying nothing. */
export function readPlayerListings(payload: unknown): ReadonlyMap<string, Tank01Listing> {
  const out = new Map<string, Tank01Listing>();
  if (!Array.isArray(payload)) return out;
  for (const rawPlayer of payload) {
    const player = asRecord(rawPlayer);
    const espnId = espnIdOf(player);
    if (espnId === null) continue;
    out.set(espnId, {
      team: asText(player.team),
      isFreeAgent: asText(player.isFreeAgent)?.toLowerCase() === "true",
      designation: asText(asRecord(player.injury).designation),
    });
  }
  return out;
}

/** The designation vocabulary the player list has been observed to carry, plus the three reserve
 *  lists it can carry, matched by their names rather than by an exact spelling. */
const DESIGNATION_RULES: readonly { readonly pattern: RegExp; readonly kind: RosterStatusKind }[] = [
  { pattern: /injured reserve/i, kind: "injured_reserve" },
  { pattern: /physically unable|\bPUP\b/i, kind: "pup" },
  { pattern: /non-?football|\bNFI\b/i, kind: "nfi" },
  { pattern: /suspen/i, kind: "suspended" },
  { pattern: /exempt/i, kind: "exempt" },
];

function reserveKindOf(designation: string | null): RosterStatusKind | null {
  if (designation === null) return null;
  return DESIGNATION_RULES.find((rule) => rule.pattern.test(designation))?.kind ?? null;
}

export interface Tank01StatusInput {
  readonly espnId: string;
  readonly sweep: RosterSweepCapture | null;
  readonly listing: Tank01Listing | null;
  /** When the player list `listing` came from was captured; unread when `listing` is `null`. */
  readonly listAt: Date | null;
}

/**
 * One player's status from the two harvest captures, or `null` when neither names him.
 *
 * 1. A reserve designation on a player list AT LEAST AS FRESH as the sweep wins outright: he was
 *    placed on the list after the sweep saw him on the roster.
 * 2. Otherwise membership of a club's roster sweep is active, dated by the sweep.
 * 3. Otherwise the player list alone: its reserve designation, its free-agent flag (`no_roster`),
 *    or a club with none of those (`off_active_roster` — see the module docblock).
 */
export function currentStatusFromTank01({ espnId, sweep, listing, listAt }: Tank01StatusInput): CurrentRosterStatus | null {
  const listed = listing !== null && listAt !== null ? { listing, at: listAt } : null;
  const reserveKind = listed === null ? null : reserveKindOf(listed.listing.designation);
  const sweepTeam = sweep?.teamByEspnId.get(espnId) ?? null;

  if (listed !== null && reserveKind !== null && (sweep === null || listed.at.getTime() >= sweep.capturedAt.getTime())) {
    return { kind: reserveKind, source: "tank01_player_list", observedAt: listed.at, team: listed.listing.team };
  }
  if (sweep !== null && sweepTeam !== null) {
    return { kind: "active", source: "tank01_roster_sweep", observedAt: sweep.capturedAt, team: sweepTeam };
  }
  if (listed === null) return null;
  const { listing: entry, at } = listed;
  if (reserveKind !== null) return { kind: reserveKind, source: "tank01_player_list", observedAt: at, team: entry.team };
  if (entry.isFreeAgent) return { kind: "no_roster", source: "tank01_player_list", observedAt: at, team: null };
  if (entry.team !== null) return { kind: "off_active_roster", source: "tank01_player_list", observedAt: at, team: entry.team };
  return null;
}

/** The status as the board stores it on a row (`BoardReason`, JSON-safe: the date as ISO text). */
export function rosterStatusReason(status: CurrentRosterStatus): RosterStatusReason {
  return { code: "roster_status", status: status.kind, source: status.source, observedAt: status.observedAt.toISOString(), team: status.team };
}

/** The stored `roster_status` reason on a reason list, as a note a surface can print, or `null`
 *  when the list carries none (an active player, or one no source named). */
export function rosterStatusNoteOf(reasons: readonly BoardReason[]): RosterStatusNote | null {
  const reason = reasons.find((entry): entry is RosterStatusReason => entry.code === "roster_status");
  if (reason === undefined) return null;
  return { status: reason.status, source: reason.source, observedAt: reason.observedAt, team: reason.team, excluded: isExcludedRosterStatus(reason.status) };
}
