"use client";

import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Badge } from "@/components/ui";
import { formatClockLength, formatTightening } from "../state/format";
import { playerName, teamName, teamsById } from "../lib/lookups";
import type { ConnectionStatus } from "../hooks/use-draft-room";
import { ConnectionBanner } from "./connection-banner";
import { Countdown, useCountdown } from "./countdown";

export type RoomRailVariant = "room" | "tv";
/** The four states the whole room morphs between. The rail is where the morph is loudest. */
export type RoomMode = "scheduled" | "watching" | "hot" | "complete";

export interface RoomRailProps {
  readonly leagueName: string;
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly connection: ConnectionStatus;
  /** `tv` drops the personal chrome — no team chip, no my-turn heat. */
  readonly variant?: RoomRailVariant;
}

const FORMAT_LABEL: Readonly<Record<DraftStateView["format"], string>> = {
  snake: "Snake draft",
  auction: "Auction draft",
};

const LEAGUE_TEXT: Readonly<Record<RoomRailVariant, string>> = {
  room: "text-display-md",
  tv: "text-display-xl",
};

/**
 * The rail's whole visual morph, in one map. `hot` is the negative family, because the one
 * moment the room should stop being calm is the sixty seconds that belong to you.
 */
const MODE_SKIN: Readonly<Record<RoomMode, string>> = {
  scheduled: "border-border bg-surface-elevated",
  watching: "border-border bg-surface-elevated",
  hot: "border-negative bg-negative/10",
  complete: "border-border bg-surface-elevated",
};

interface TurnSummary {
  /** The eyebrow above the subject: "You're on the clock", "Live bid", … */
  readonly label: string;
  /** Who or what the turn is about — a team name, or the player up for bid. */
  readonly subject: string;
  /** The same fact as a sentence, for screen readers, since the digits are `aria-hidden`. */
  readonly sentence: string;
  readonly mine: boolean;
}

/**
 * Which round the board is on: how many picks the team on the clock already owns, plus one —
 * the same "your next empty row" derivation `DraftBoard` uses. Falls back to the round of the
 * last completed pick, and to round 1 on an untouched board. Nothing here restates a
 * turn-order rule; it counts what already happened.
 */
function currentRound(view: DraftStateView): number {
  if (view.onClockTeamId !== null) {
    return view.picks.filter((pick) => pick.teamId === view.onClockTeamId).length + 1;
  }
  return view.picks[view.picks.length - 1]?.round ?? 1;
}

/** The one-line "where are we" label. An auction has lots, not rounds. */
function turnLabel(view: DraftStateView): string | null {
  if (view.phase !== "in_progress") return null;
  if (view.format === "auction") return `Lot ${view.pickNumber}`;
  return `Round ${currentRound(view)} · Pick ${view.pickNumber}`;
}

/**
 * Whose turn it is, said once. An auction lot has no `onClockTeamId` by design — the clock
 * belongs to everyone while bidding is open — so this branches on `view.format` rather than
 * ever claiming somebody is "on the clock" during a live lot. This is also where the
 * `AuctionLotPanel` went: the standing bid and its holder are a fact about *the turn*, and the
 * turn has exactly one home.
 */
function turnSummary(
  view: DraftStateView,
  teams: readonly TeamCard[],
  playersById: ReadonlyMap<string, Player>,
  myTeamId: string | null,
): TurnSummary {
  const byId = teamsById(teams);
  const lot = view.format === "auction" ? (view.auction?.lot ?? null) : null;

  if (lot !== null) {
    const name = playerName(playersById, lot.playerId);
    const bidder = teamName(byId, lot.highBidTeamId, "Someone");
    return {
      label: "Live bid",
      subject: `${name} · $${lot.highBid}`,
      sentence: `Bidding is open on ${name}. High bid $${lot.highBid} by ${bidder}.`,
      mine: false,
    };
  }

  if (view.format === "auction") {
    const nominatorId = view.auction?.nominatingTeamId ?? null;
    const who = nominatorId === null ? "Nobody" : teamName(byId, nominatorId, "Someone");
    const mine = nominatorId !== null && nominatorId === myTeamId;
    return { label: mine ? "You're nominating" : "Nominating", subject: who, sentence: `${who} is nominating.`, mine };
  }

  const who = view.onClockTeamId === null ? "Nobody" : teamName(byId, view.onClockTeamId, "Someone");
  const mine = view.onClockTeamId !== null && view.onClockTeamId === myTeamId;
  const clockLength = view.clockSeconds === null ? "" : ` This round's pick clock is ${formatClockLength(view.clockSeconds)}.`;
  return { label: mine ? "You're on the clock" : "On the clock", subject: who, sentence: `${who} is on the clock.${clockLength}`, mine };
}

function modeOf(view: DraftStateView, turn: TurnSummary): RoomMode {
  if (view.phase === "scheduled") return "scheduled";
  if (view.phase === "complete") return "complete";
  return turn.mine ? "hot" : "watching";
}

/** The waiting and finished states: no clock, one plain sentence, nothing to hunt for. */
function StaticState({ headline, detail }: { readonly headline: string; readonly detail: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-xs font-semibold uppercase tracking-wide text-text-muted">{headline}</span>
      <span className="text-sm text-text-muted">{detail}</span>
    </div>
  );
}

/**
 * The room's masthead and its ONLY clock: league, format, where the board is, whose turn it
 * is, the countdown, and when the clock next tightens. It replaced `RoomHeader` outright and
 * absorbed `ClockBanner` before it and `AuctionLotPanel` alongside it — three surfaces
 * claiming one fact is what made the old room feel like a hunt.
 *
 * It is a fixed-height band by construction (`lg:h-20`): the stage below it gets every
 * remaining pixel, and nothing in the room reflows when the turn changes.
 */
export function RoomRail({ leagueName, view, teams, myTeamId, playersById, connection, variant = "room" }: RoomRailProps) {
  // The TV board is nobody's team: `personalId` is what every personal affordance reads, so
  // dropping the chrome for that variant is one assignment rather than a flag per element.
  const personalId = variant === "room" ? myTeamId : null;
  const turn = turnSummary(view, teams, playersById, personalId);
  const mode = modeOf(view, turn);
  // Called unconditionally, before any early return — React's Rules of Hooks. `now` is the
  // same wall-clock reading `remainingMs` came from, so the tightening line shares this one
  // ticking interval instead of running a second `useNow` beside it.
  const { remainingMs, now } = useCountdown(view.deadlineAt);
  const tightening = formatTightening(view.nextTightening, now);
  const myTeamName = personalId === null ? null : teamName(teamsById(teams), personalId, "Your team");
  const turnWhere = turnLabel(view);

  return (
    <header
      data-testid="room-rail"
      data-mode={mode}
      className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 lg:h-20 lg:flex-nowrap ${MODE_SKIN[mode]}`}
    >
      <h1 className={`font-display font-bold leading-display text-text-primary ${LEAGUE_TEXT[variant]}`}>{leagueName}</h1>
      <Badge tone="neutral">{FORMAT_LABEL[view.format]}</Badge>
      {turnWhere === null ? null : (
        <span data-testid="turn-label" className="font-display text-sm font-semibold uppercase tracking-wide text-text-muted">
          {turnWhere}
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 lg:flex-nowrap">
        {mode === "scheduled" ? (
          <StaticState headline="Not started" detail="Your commissioner starts it when everyone is here." />
        ) : mode === "complete" ? (
          <StaticState headline="Draft complete" detail="Every roster is final." />
        ) : (
          <>
            <div className="flex min-w-0 flex-col">
              <span className={`font-display text-xs font-semibold uppercase tracking-wide ${turn.mine ? "text-negative" : "text-text-muted"}`}>
                {turn.label}
              </span>
              <span className="truncate font-display text-display-sm font-bold leading-display text-text-primary">{turn.subject}</span>
            </div>
            <div className="flex flex-col items-end">
              {remainingMs === null ? null : <Countdown remainingMs={remainingMs} size="lg" tone={turn.mine ? "hot" : "default"} data-testid="countdown" />}
              {tightening === null ? null : <span className="text-xs text-warning">{tightening}</span>}
            </div>
            {/* The digits above are `aria-hidden`; this is the same turn stated once, in words. */}
            <p className="sr-only">{turn.sentence}</p>
          </>
        )}
        {myTeamName === null ? null : (
          <span className="whitespace-nowrap text-sm text-text-muted">
            Your team: <span className="font-display font-semibold text-text-primary">{myTeamName}</span>
          </span>
        )}
        <ConnectionBanner connection={connection} />
      </div>
    </header>
  );
}
