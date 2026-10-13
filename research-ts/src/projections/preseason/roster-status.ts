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
 * PRECEDENCE, stated once here and applied in `current-status.ts` (the one resolution the board's
 * gate and the availability model both call): a dated harvest row over the week-one nflverse row
 * over the depth chart. Within the harvest the two captures carry different
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
 * `roster-status-read.ts` owns the reads, `current-status.ts` the resolution between them,
 * `roster-status-gate.ts` what the board does with a status, `availability-status.ts` what the
 * availability model reads off one, `roster-status-copy.ts` every word a surface prints about one.
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

/**
 * THE DESIGNATION DETAIL a source carries beyond the kind (current-status round, 2026-09-09): what
 * the kind alone does not say. `out` is an Out designation on a man who is on an active roster
 * (the sweep's or the player list's word, or a dated week-one report row); `designated_to_return`
 * is injured reserve with a return designation (the list's own text, the archive's `R48`); the
 * three suspension details are the archive's `R40` (a stated term), `R30` (indefinite) and `R33`
 * (by his club). No store carries a suspension's LENGTH, so none is claimed here. `null` is "the
 * kind is the whole of what the source said", never "no designation".
 */
export const STATUS_DETAILS = ["out", "designated_to_return", "suspended_term", "suspended_indefinite", "suspended_club"] as const;
export type StatusDetail = (typeof STATUS_DETAILS)[number];

export interface CurrentRosterStatus {
  readonly kind: RosterStatusKind;
  readonly source: RosterStatusSource;
  /** When the source captured or stamped the fact. Never derived. */
  readonly observedAt: Date;
  /** The club the source lists him with, in the source's own code; `null` when it lists none. */
  readonly team: string | null;
  /** The source's finer word, where it has one. See `STATUS_DETAILS`. */
  readonly detail: StatusDetail | null;
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

/** What a week-one roster row says, kind and detail together. */
export interface NflverseRosterStatus {
  readonly kind: RosterStatusKind;
  readonly detail: StatusDetail | null;
}

/**
 * The archive's `status_description_abbr` codes that name WHICH reserve list a `RES` row is
 * (measured on the real 2013-2025 files, the suspension round's ledger): `R01` injured reserve,
 * `R48` injured reserve designated to return, `R04` physically unable to perform, `R05`/`R06`/`R27`
 * non-football injury and illness, `R40`/`R30`/`R33` the three suspensions. A `RES` row with any
 * other detail (`W03`, `R59` COVID reserve, `R03` did not report, a blank) is injured reserve with
 * no detail, which is what the gate always read it as.
 */
const RESERVE_DETAIL_CODES: Readonly<Record<string, NflverseRosterStatus>> = {
  R01: { kind: "injured_reserve", detail: null },
  R48: { kind: "injured_reserve", detail: "designated_to_return" },
  R04: { kind: "pup", detail: null },
  R05: { kind: "nfi", detail: null },
  R06: { kind: "nfi", detail: null },
  R27: { kind: "nfi", detail: null },
  R40: { kind: "suspended", detail: "suspended_term" },
  R30: { kind: "suspended", detail: "suspended_indefinite" },
  R33: { kind: "suspended", detail: "suspended_club" },
};

function suspensionDetailOf(statusDetail: string): StatusDetail | null {
  const named = RESERVE_DETAIL_CODES[statusDetail];
  return named !== undefined && named.kind === "suspended" ? named.detail : null;
}

/**
 * The league's own week-one roster code and detail, as `nflverse_roster_weeks` archives them
 * verbatim. `ACT`/`INA` are both active (`nflverse/rosters.ts`'s own ruling: a game-day inactive is
 * not a roster status). A `RES` row reads its detail code for which list it is (`RESERVE_DETAIL_CODES`),
 * so a suspended man filed under `RES R40` reads `suspended` rather than injured reserve (the same
 * cap, the truer reason). The trade codes, `RSN`, `NWT`, `RSR` and anything else are `null`: a code
 * this module does not know is a code it says nothing about, never a reserve list by default.
 */
export function rosterStatusFromNflverseRow(code: string, statusDetail: string): NflverseRosterStatus | null {
  const normalised = code.trim().toUpperCase();
  const detail = statusDetail.trim().toUpperCase();
  if (NUMBERED_EXEMPTION.test(normalised)) return { kind: "exempt", detail: null };
  switch (normalised) {
    case "ACT":
    case "INA":
      return { kind: "active", detail: null };
    case "RES":
      return RESERVE_DETAIL_CODES[detail] ?? { kind: "injured_reserve", detail: null };
    case "PUP":
      return { kind: "pup", detail: null };
    case "NON":
      return { kind: "nfi", detail: null };
    case "SUS":
      return { kind: "suspended", detail: suspensionDetailOf(detail) };
    case "EXE":
      return { kind: "exempt", detail: null };
    case "DEV":
      return { kind: "practice_squad", detail: null };
    case "CUT":
      return { kind: "no_roster", detail: null };
    case "RET":
      return { kind: "retired", detail: null };
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

/** How many clubs a complete sweep enumerates. */
export const SWEEP_CLUB_COUNT = 32;

/**
 * THE FLOOR UNDER A CLUB'S SWEEP MEMBERSHIP before absence from it counts as evidence (fix round,
 * HIGH). A 53-man roster read at the cutdown carries at least 45 names even mid-churn; in season,
 * with men on injured reserve off the list, at least 40. A club below its floor, or a sweep of
 * fewer than 32 clubs, is a partial payload, and absence from a partial payload is silence.
 */
export const SWEEP_MINIMUM_CLUB_SIZE = { cutdown: 45, in_season: 40 } as const;
export type SweepPhase = keyof typeof SWEEP_MINIMUM_CLUB_SIZE;

/** One man on a club's active roster as the sweep lists him: the club, and the designation the
 *  club filed on him (`Out`, `Questionable`, or nothing), verbatim. */
export interface SweepMember {
  readonly team: string;
  readonly designation: string | null;
}

/** What one sweep payload enumerated: membership, and the two numbers completeness is judged on. */
export interface SweepMembership {
  readonly membersByEspnId: ReadonlyMap<string, SweepMember>;
  readonly clubCount: number;
  /** The thinnest club's membership, or `null` when the payload named no club at all. */
  readonly smallestClub: number | null;
}

/** The newest roster sweep: when it was taken, what it enumerated, and whether that is complete. */
export interface RosterSweepCapture extends SweepMembership {
  readonly capturedAt: Date;
  /** `sweepIsComplete` for the phase the read was taken in. MEMBERSHIP of an incomplete sweep is
   *  still a fact (he is on that club); ABSENCE from one is not. */
  readonly complete: boolean;
}

/** The completeness rule: every club present, none thinner than the phase's floor. */
export function sweepIsComplete(membership: SweepMembership, phase: SweepPhase): boolean {
  return membership.clubCount === SWEEP_CLUB_COUNT && membership.smallestClub !== null && membership.smallestClub >= SWEEP_MINIMUM_CLUB_SIZE[phase];
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
 * `tank01_injuries`: an array of clubs, each with a `roster` of the players on its active roster,
 * each carrying an `injury.designation`. Read as membership plus that one word — the description
 * and return-date half of this feed is `harvest-captures.ts`'s job. A payload of another shape
 * reads as an empty sweep, never as thirty-two empty rosters.
 */
export function readActiveRosterSweep(payload: unknown): SweepMembership {
  const membersByEspnId = new Map<string, SweepMember>();
  let clubCount = 0;
  let smallestClub: number | null = null;
  if (!Array.isArray(payload)) return { membersByEspnId, clubCount, smallestClub };
  for (const rawTeam of payload) {
    const club = asRecord(rawTeam);
    const team = asText(club.team);
    if (team === null || !Array.isArray(club.roster)) continue;
    clubCount += 1;
    let named = 0;
    for (const rawPlayer of club.roster) {
      const player = asRecord(rawPlayer);
      const espnId = espnIdOf(player);
      if (espnId === null) continue;
      membersByEspnId.set(espnId, { team, designation: asText(asRecord(player.injury).designation) });
      named += 1;
    }
    smallestClub = smallestClub === null ? named : Math.min(smallestClub, named);
  }
  return { membersByEspnId, clubCount, smallestClub };
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

const DESIGNATED_TO_RETURN = /designated (?:to|for) return/i;
const OUT_DESIGNATION = /^out$/i;

/** The detail a reserve designation's own text carries: the return designation, or nothing. */
function reserveDetailOf(designation: string | null): StatusDetail | null {
  return designation !== null && DESIGNATED_TO_RETURN.test(designation) ? "designated_to_return" : null;
}

/** The detail an active-roster man's designation carries: `Out`, or nothing (Questionable is the
 *  league saying a return is live, never an absence claim). */
function activeDetailOf(designation: string | null): StatusDetail | null {
  return designation !== null && OUT_DESIGNATION.test(designation.trim()) ? "out" : null;
}

export interface Tank01StatusInput {
  readonly espnId: string;
  readonly sweep: RosterSweepCapture | null;
  readonly listing: Tank01Listing | null;
  /** When the player list `listing` came from was captured; unread when `listing` is `null`. */
  readonly listAt: Date | null;
}

interface ListedAt {
  readonly listing: Tank01Listing;
  readonly at: Date;
}

/** Whether the player list's word is at least as fresh as the sweep's, so it outranks it. */
function listOutranksSweep(listed: ListedAt | null, sweep: RosterSweepCapture | null): listed is ListedAt {
  return listed !== null && (sweep === null || listed.at.getTime() >= sweep.capturedAt.getTime());
}

/**
 * One player's status from the two harvest captures, or `null` when neither names him.
 *
 * 1. A reserve designation on a player list AT LEAST AS FRESH as the sweep wins outright: he was
 *    placed on the list after the sweep saw him on the roster.
 * 2. Otherwise membership of a club's roster sweep is active, dated by the sweep. Its detail is the
 *    fresher capture's designation (the list's when it is at least as fresh, else the sweep's own):
 *    `out` for an Out, nothing for anything else — the later word wins here as it does above.
 * 3. Otherwise the player list alone: its reserve designation, its free-agent flag (`no_roster`),
 *    or a club with none of those (`off_active_roster` — see the module docblock), which needs a
 *    COMPLETE sweep to stand on: it is a claim about his absence from the sweep, and absence from
 *    a partial sweep is silence (`sweepIsComplete`, fix round HIGH). With no sweep or a partial
 *    one he falls through to the next source, or stays unknown.
 */
export function currentStatusFromTank01({ espnId, sweep, listing, listAt }: Tank01StatusInput): CurrentRosterStatus | null {
  const listed = listing !== null && listAt !== null ? { listing, at: listAt } : null;
  const reserveKind = listed === null ? null : reserveKindOf(listed.listing.designation);
  const member = sweep?.membersByEspnId.get(espnId) ?? null;

  if (reserveKind !== null && listOutranksSweep(listed, sweep)) {
    return { kind: reserveKind, source: "tank01_player_list", observedAt: listed.at, team: listed.listing.team, detail: reserveDetailOf(listed.listing.designation) };
  }
  if (sweep !== null && member !== null) {
    const designation = listOutranksSweep(listed, sweep) ? listed.listing.designation : member.designation;
    return { kind: "active", source: "tank01_roster_sweep", observedAt: sweep.capturedAt, team: member.team, detail: activeDetailOf(designation) };
  }
  if (listed === null) return null;
  const { listing: entry, at } = listed;
  if (reserveKind !== null) return { kind: reserveKind, source: "tank01_player_list", observedAt: at, team: entry.team, detail: reserveDetailOf(entry.designation) };
  if (entry.isFreeAgent) return { kind: "no_roster", source: "tank01_player_list", observedAt: at, team: null, detail: null };
  if (entry.team !== null && sweep !== null && sweep.complete) {
    return { kind: "off_active_roster", source: "tank01_player_list", observedAt: at, team: entry.team, detail: null };
  }
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
