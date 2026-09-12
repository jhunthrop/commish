import type { HomeLeagueCard } from "../contract";
import { firstNameOf, formatDraftAbsolute, formatRecord, formatDraftWeekday, ordinal } from "./format";
import { LEAGUE_VERB, MOCK_DRAFT_HREF } from "./verbs";

/**
 * THE SIGNED-IN HOME'S OWN LANGUAGE (Sideline, 2026-09-11) — pure over `HomeLeagueCard`, so the
 * card component renders words rather than deciding them, and every sentence on that page has a
 * test that does not need a DOM.
 *
 * Why this is not `rail-line.ts`: the rail speaks in ONE line under a name, in a 64px flyout and
 * a row, and its ladder is built for that. A card has room for the league's own sentence, a
 * figure with its basis, and a verb, and it orders the whole page by which league is owed
 * something. The two answer different questions about the same read and are deliberately separate
 * rather than one function with a mode flag.
 *
 * Copy rules (the binding list): no em-dashes, no semicolons, no trading words, no system voice,
 * no explainer sentences, and every number names its basis in the same view.
 */

/**
 * WHAT A CARD OWES THIS MANAGER, in the order the page stacks them. The first three are open
 * one-time tasks: something this manager, and only this manager, can close. `live` and `idle` are
 * states of the world rather than things owed.
 */
export type HomeCardNeed = "draft-running" | "lineup-unset" | "slots-unranked" | "live" | "idle";

/** An open one-time task outranks a live week, and a live week outranks a quiet league. Ties keep
 *  the input order, which every caller passes as the home read's own stable league order
 *  (`myLeaguesOverview`: `createdAt` asc), so a quiet league never shuffles under a sibling. */
const NEED_RANK: Readonly<Record<HomeCardNeed, number>> = {
  "draft-running": 0,
  "lineup-unset": 1,
  "slots-unranked": 2,
  live: 3,
  idle: 4,
};

/** The three needs that are an open one-time task, and therefore may wear the amber wash and the
 *  page's one solid verb (P3). */
const OWED: ReadonlySet<HomeCardNeed> = new Set<HomeCardNeed>(["draft-running", "lineup-unset", "slots-unranked"]);

export function needFor(league: HomeLeagueCard): HomeCardNeed {
  if (league.draftStatus === "in_progress" && league.myTeamId !== null) return "draft-running";
  // The one-time task ladder, in the order a manager can act on them. A lineup with an empty slot
  // while the week is still open is the most perishable thing on the page: once the week starts
  // it cannot be closed at all.
  if (league.myTeamId !== null && league.weekStatus === "scheduled" && !league.lineupSet && league.draftStatus === "complete") return "lineup-unset";
  if (league.draftStatus === "scheduled" && league.myTeamId !== null && !league.slotsRanked) return "slots-unranked";
  if (league.weekStatus === "in_progress" && league.draftStatus === "complete") return "live";
  return "idle";
}

export function isOwed(need: HomeCardNeed): boolean {
  return OWED.has(need);
}

/** The page's order: what needs this manager first. A new array, never a mutation of the input. */
export function orderByNeed(leagues: readonly HomeLeagueCard[]): readonly HomeLeagueCard[] {
  return [...leagues].sort((a, b) => NEED_RANK[needFor(a)] - NEED_RANK[needFor(b)]);
}

export interface HomeCardVerb {
  readonly label: string;
  readonly href: string;
}

/**
 * The card's ONE verb. An open one-time task beats "Open the room", and a pre-draft league with
 * nothing owed offers the one thing a manager can genuinely do about a draft that has not
 * happened yet: run a mock of it.
 */
export function verbFor(league: HomeLeagueCard): HomeCardVerb {
  const need = needFor(league);
  if (need === "draft-running" && league.draftId !== null && league.nextAction !== null) {
    // The label off the WIRE, not retyped: `nextAction`'s own first rule is this exact condition
    // (a draft in progress and a seat in it), so the server has already said "Join the draft" in
    // `NEXT_ACTION_COPY`'s own words on this very card.
    return { label: league.nextAction.label, href: `/app/drafts/${league.draftId}` };
  }
  if (need === "lineup-unset") {
    // The tab split (founder, 2026-08-28): the lineup editor lives on the My team tab, so the
    // verb lands there. The `#lineup` anchor survives on the editor itself.
    return { label: LEAGUE_VERB.setLineup, href: `/app/leagues/${league.id}/team#lineup` };
  }
  if (need === "slots-unranked") {
    // The ranking panel lives in the league room itself (`SlotPreferencePanel`), which is where
    // this lands rather than a second, narrower ranking control invented for this page.
    return { label: LEAGUE_VERB.rankSlots, href: `/app/leagues/${league.id}` };
  }
  if (league.draftStatus === "scheduled") return { label: LEAGUE_VERB.mockDraft, href: MOCK_DRAFT_HREF };
  return { label: LEAGUE_VERB.openRoom, href: `/app/leagues/${league.id}` };
}

/** The manager across the table, by first name, or their team when the seat does not resolve to a
 *  person. `null` on a bye and before a schedule exists: the line omits the clause rather than
 *  naming an opponent that does not exist. */
export function opponentOf(league: HomeLeagueCard): string | null {
  if (league.matchup === null) return null;
  if (league.opponentManagerName !== null) return firstNameOf(league.opponentManagerName);
  return league.matchup.homeTeamId === league.myTeamId ? league.matchup.awayTeamName : league.matchup.homeTeamName;
}

/** How many games this manager's record is actually built on — the basis "after week N" names. */
function gamesPlayed(league: HomeLeagueCard): number {
  return league.record === null ? 0 : league.record.wins + league.record.losses + league.record.ties;
}

/**
 * THE LEAGUE'S OWN SENTENCE on the card, in the league's voice rather than the product's.
 *
 * "You pick Nth" appears only once `assignedSlot` is a real number, which it is only after the
 * draw has run: a pre-draft card says the true fact ("your draft slots are not ranked yet")
 * rather than a slot nobody has been given.
 *
 * "Lineups lock when week N starts" is the clock this product actually owns (`@/league/week-
 * status.ts`: "Lineups lock when the week starts, not when it ends"). There is no per-kickoff
 * lock time to promise, so none is promised.
 */
export function momentLine(league: HomeLeagueCard): string {
  const need = needFor(league);
  if (need === "draft-running") {
    const slot = league.assignedSlot === null ? "" : ` You pick ${ordinal(league.assignedSlot)}.`;
    return `Your draft is running.${slot}`;
  }
  if (league.draftStatus === "scheduled") {
    const when =
      league.startTrigger === "when_full"
        ? `Filling, ${league.filledTeams} of ${league.teamCount}. Drafts when full.`
        : league.kickoffAt === null
          ? "A draft is scheduled."
          : `Drafts ${formatDraftWeekday(league.kickoffAt)}.`;
    return league.slotsRanked || league.myTeamId === null ? when : `${when} Your draft slots are not ranked yet.`;
  }
  if (league.draftStatus === "complete") {
    const opponent = opponentOf(league);
    const week = `Week ${league.weekNumber}`;
    if (league.weekStatus === "in_progress") return opponent === null ? `${week} is live.` : `${week}, you play ${opponent}. Live now.`;
    if (league.weekStatus === "final") return opponent === null ? `${week} is final.` : `${week}, you played ${opponent}.`;
    const plays = opponent === null ? week : `${week}, you play ${opponent}`;
    return `${plays}. Lineups lock when week ${league.weekNumber} starts.`;
  }
  return `${league.filledTeams} of ${league.teamCount} seats filled.`;
}

/**
 * THE ONE FIGURE ON THE CARD and what it is (P2). A `null` value renders the dash and the caption
 * says why, which is the only honest answer for a manager whose league has not played a game yet.
 */
export interface HomeCardFigure {
  readonly value: string | null;
  readonly basis: string;
}

export function figureFor(league: HomeLeagueCard): HomeCardFigure {
  if (league.draftStatus === "complete") {
    const played = gamesPlayed(league);
    if (league.record === null || played === 0) return { value: null, basis: "no games played yet" };
    return { value: formatRecord(league.record), basis: `your record, after week ${played}` };
  }
  if (league.draftStatus === "in_progress" && league.assignedSlot !== null) {
    return { value: ordinal(league.assignedSlot), basis: `your slot, of ${league.teamCount}` };
  }
  if (league.draftStatus === "scheduled" && league.startTrigger === "scheduled" && league.kickoffRelative !== null && league.kickoffAt !== null) {
    // "in 2 days" becomes "In 2 days" at the head of its own figure. Sentence case, not the caps
    // register: the caps charter routes every shout through `MICRO_LABEL`, and this is not one.
    return { value: `${league.kickoffRelative.charAt(0).toUpperCase()}${league.kickoffRelative.slice(1)}`, basis: formatDraftAbsolute(league.kickoffAt) };
  }
  const toGo = league.teamCount - league.filledTeams;
  return { value: String(toGo), basis: `${toGo === 1 ? "seat" : "seats"} to go, of ${league.teamCount}` };
}

/**
 * WHO IS IN, as a sentence beside the faces (`ManagerStack` requires one — P1 says a face never
 * stands alone). Names the reader first, then the next people by first name, then counts the
 * rest. An empty room says so in the second person rather than reporting a zero.
 */
export function stackCaption(league: HomeLeagueCard): string {
  const others = league.members.filter((member) => !member.isSelf);
  const mine = league.members.some((member) => member.isSelf);
  if (others.length === 0) return mine ? "You are in. Nobody else yet." : `Nobody is seated yet, of ${league.teamCount}.`;
  const shown = others.slice(0, 3).map((member) => firstNameOf(member.name));
  const rest = others.length - shown.length;
  const names = mine ? ["You", ...shown] : shown;
  const tail = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  return `${tail} are in.`;
}
