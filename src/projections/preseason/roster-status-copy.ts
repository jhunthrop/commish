import type { RosterStatusKind, RosterStatusNote, RosterStatusSource } from "./roster-status";

/**
 * EVERY WORD A SURFACE PRINTS ABOUT A ROSTER STATUS, in one place (founder rule: centralize the
 * mapping the first time). The board's pill, the pool row, the search result, the team page, the
 * peek's line and the "Not on an active roster" band all read these, so the same status can never
 * be spelled two ways.
 *
 * HOUSE COPY RULES APPLY (`integrity/copy-rules.ts`, checked by this module's own test): sentence
 * case, no dash of either length, no contraction, nothing passive, nothing accusatory. Initialisms
 * the league itself uses (IR, PUP, NFI) stay as initialisms on the pill because that is how every
 * sports surface has always written them; the sentence form spells them out.
 *
 * EVERY SENTENCE NAMES ITS SOURCE AND DATE. "On injured reserve, observed Sep 5 on the player list"
 * is a dated observation a manager can weigh; "On injured reserve" alone would read as today's
 * truth on a Thursday when the capture was Saturday's.
 *
 * Pure and React-free, so a server module (the search index, the team page) reads the same words
 * the pill does.
 */

const LABELS: Readonly<Record<RosterStatusKind, string>> = {
  active: "Active",
  injured_reserve: "IR",
  pup: "PUP",
  nfi: "NFI",
  suspended: "Suspended",
  exempt: "Exempt",
  practice_squad: "Practice squad",
  off_active_roster: "Not on active roster",
  no_roster: "Free agent",
  retired: "Retired",
};

const PHRASES: Readonly<Record<RosterStatusKind, string>> = {
  active: "On the active roster",
  injured_reserve: "On injured reserve",
  pup: "On the physically unable to perform list",
  nfi: "On the non-football injury list",
  suspended: "Suspended",
  exempt: "On the exempt list",
  practice_squad: "Practice squad",
  off_active_roster: "Not on the active roster",
  no_roster: "Not on any roster",
  retired: "Retired",
};

const SOURCE_PHRASES: Readonly<Record<RosterStatusSource, string>> = {
  tank01_roster_sweep: "the roster sweep",
  tank01_player_list: "the player list",
  nflverse_roster_week_1: "the week 1 roster",
  depth_chart: "the depth chart",
};

/** The band the excluded players render under, at the end of the board. */
export const NOT_ON_ACTIVE_ROSTER_BAND = "Not on an active roster";

/** The one sentence above that band. */
export const NOT_ON_ACTIVE_ROSTER_NOTE = "These players carry no projection while they are off an active roster. Each row names where that was observed and when.";

const OBSERVED_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Sep 5", from the stored ISO stamp, in UTC so the day never moves with the reader's clock. */
export function observedOn(observedAtIso: string): string {
  return OBSERVED_DATE.format(new Date(observedAtIso));
}

/** The pill's own word for a status. */
export function rosterStatusLabel(status: RosterStatusKind): string {
  return LABELS[status];
}

/** The status spelled out, as a clause: "On injured reserve", "Practice squad". */
export function rosterStatusPhrase(status: RosterStatusKind): string {
  return PHRASES[status];
}

type Observation = Pick<RosterStatusNote, "source" | "observedAt">;

/** Where and when it was seen, as its own clause: "Observed Sep 5 on the player list". */
export function rosterStatusObservation(note: Observation): string {
  return `Observed ${observedOn(note.observedAt)} on ${SOURCE_PHRASES[note.source]}`;
}

/** The status as a clause a reader can weigh, source and date included, without a full stop so a
 *  caller may end it or continue it. */
export function rosterStatusSentence(note: Pick<RosterStatusNote, "status"> & Observation): string {
  return `${PHRASES[note.status]}, observed ${observedOn(note.observedAt)} on ${SOURCE_PHRASES[note.source]}`;
}

/** The peek's own line for a player the gate took off the ranked board. */
export function noProjectionSentence(note: Pick<RosterStatusNote, "status"> & Observation): string {
  return `${rosterStatusSentence(note)}. He has no projection while he is off an active roster.`;
}
