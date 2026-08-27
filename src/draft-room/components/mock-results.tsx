import type { ReactNode } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Avatar, EYEBROW, PositionBadge } from "@/components/ui";
import { BENCH_SLOT } from "@/domain/roster";
import { playersById as buildPlayersById } from "../lib/lookups";
import { formatPickFactClause, type PickFactCopy } from "../state/format";
import { reviewPicks } from "../state/pick-review";
import { rosterFillRows } from "../state/roster-fill";
import { RosterRow } from "./roster-row";

/** Mirrors `MockResultsCopy` (`../contract`) — the wire type this room fetches, forwarded down
 *  as one prop rather than several so `DraftRoom` stays a single pass-through.
 *  `rosterHeading`/`picksHeading`/`openSlotLabel`/`noPicksMessage`/`pickFact` are the mock-
 *  results design review's own finding (E6, 2026-08-26): this surface's remaining bare literals,
 *  moved into `MOCK_COPY` beside their siblings rather than hardcoded here. */
export interface MockResultsCopy {
  readonly heading: string;
  readonly retentionSentence: string;
  readonly rosterHeading: string;
  readonly picksHeading: string;
  readonly openSlotLabel: string;
  readonly noPicksMessage: string;
  readonly pickFact: PickFactCopy;
  readonly runAgainLabel: string;
  readonly openLobbyLabel: string;
  readonly browseLeaguesLabel: string;
}

export interface MockResultsProps {
  readonly view: DraftStateView;
  /** The seats, for the debrief's meta line (results review E5: your seat, the room's shape,
   *  who you played) — data `DraftRoom` always held and never passed down. */
  readonly teams: readonly TeamCard[];
  /** The room's own finished board (results review R3): `DraftRoom` builds the `DraftBoard` it
   *  was already rendering ninety seconds earlier and hands it down — the single strongest
   *  image the product makes, kept at the exact moment it is finally complete. */
  readonly board: ReactNode;
  /** In the same ranked order `START_DRAFT` snapshots — `GET /api/drafts/[draftId]/players`'s
   *  own docblock — which is what makes the board delta below a fact of THIS draft's own log
   *  rather than a live, still-moving ranking. */
  readonly players: readonly Player[];
  /** Null for a commissioner watching a mock without a team of their own — the roster and pick
   *  list below have nothing to say for that caller, so this component says only the heading,
   *  the retention line and the three next actions. */
  readonly myTeamId: string | null;
  readonly copy: MockResultsCopy;
  /**
   * The room's own way out (Step 2: "never a dead end") — real navigations, built by `DraftRoom`
   * so this component stays presentational, the same `primaryAction`/`secondaryAction` shape
   * `SeatTakenPanel` (`@/league-room/components/seat-taken-panel`) already uses for the same
   * reason: a results panel has no business owning routes.
   */
  readonly actions: {
    readonly runAgain: ReactNode;
    readonly openLobby: ReactNode;
    readonly browseLeagues: ReactNode;
  };
}

/**
 * One row per roster spot, in `view.slotConfig`'s own order (QB, then RB, then …) — never one
 * row per slot TYPE with several names crammed onto it, so "who is at my second RB spot" is a
 * fact this list states plainly rather than something a reader parses out of a comma list.
 */
function RosterSection({
  view,
  playersById,
  myTeamId,
  copy,
}: {
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string;
  readonly copy: MockResultsCopy;
}) {
  // THE SAME ROW the rail draws (results review D1/D2): faces, the player's OWN position, the
  // bench under its hairline — the finisher's team rendered exactly as well as the room
  // rendered it a minute earlier, because it is literally the same component.
  const rows = rosterFillRows(view.slotConfig, view.rosters[myTeamId] ?? []);
  const firstBenchIndex = rows.findIndex((row) => row.slot === BENCH_SLOT);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>{copy.rosterHeading}</h2>
      <ul aria-label={copy.rosterHeading} className="flex flex-col gap-1.5">
        {rows.map((row, index) => (
          <RosterRow
            key={`${row.slot}:${row.slotIndex}`}
            slot={row.slot}
            player={row.playerId === null ? null : (playersById.get(row.playerId) ?? null)}
            className={index === firstBenchIndex ? "mt-1 border-t border-line pt-2" : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

function PickList({
  view,
  players,
  playersById,
  myTeamId,
  copy,
}: {
  readonly view: DraftStateView;
  readonly players: readonly Player[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string;
  readonly copy: MockResultsCopy;
}) {
  // A record, not prose (results review E1): one tabular mono row per pick — number, face,
  // name, position, then the honest board fact. Weight, never color, marks the extremes (the
  // R2 register ruling): a best-available pick reads in ink, everything else stays quiet.
  const reviews = reviewPicks(players, view.picks, myTeamId);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>{copy.picksHeading}</h2>
      {reviews.length === 0 ? (
        <p className="text-sm text-text-muted">{copy.noPicksMessage}</p>
      ) : (
        <ol aria-label={copy.picksHeading} className="flex flex-col">
          {reviews.map((review) => {
            const player = playersById.get(review.playerId);
            if (player === undefined) return null;
            const best = review.bestAvailableDelta === 0 || review.positionBestDelta === 0;
            return (
              <li key={review.pickNumber} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-text-muted">{review.pickNumber}</span>
                <Avatar name={player.name} avatar={player.headshotUrl} size="sm" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{player.name}</span>
                <PositionBadge position={player.position} size="sm" />
                <span className={`min-w-0 flex-1 truncate text-right font-mono text-xs tabular-nums ${best ? "font-semibold text-text-primary" : "text-text-muted"}`}>
                  {formatPickFactClause(copy.pickFact, review, player.position)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * The post-draft panel for a mock room (Task 8, Step 2). On `phase === "complete"`, `DraftRoom`
 * lets this yield the whole board: your roster grouped by slot, your pick list with each pick's
 * honest board facts (`reviewPicks`, `../state/pick-review`: best available at that pick, and at
 * that position, both computed from the pool order the draft itself snapshotted at start — never
 * a live ranking), the retention sentence, and the room's three next actions.
 *
 * Deliberately NO letter grade (ruling 5) — a grade manufactures authority this platform has not
 * earned, and the real-only rule forbids it. The pick facts are the honest version of the same
 * itch: what you actually took, against what the board actually still had, both facts of this
 * one draft. Ruling R2 (the mock-results design review, 2026-08-26): a raw, un-normalized board
 * rank implies exactly the verdict ruling 5 refuses, and points it backwards for any pick late in
 * a long draft — best-available-at-the-pick never drifts with the round the way raw rank does.
 */
export function MockResults({ view, teams, board, players, myTeamId, copy, actions }: MockResultsProps) {
  const playersById = buildPlayersById(players);
  // The debrief's meta line (review E5) — every clause a fact the props already held: your
  // seat, the room's shape, who you played. Composed only for a caller WITH a seat.
  const seat = myTeamId === null ? 0 : view.draftOrder.indexOf(myTeamId) + 1;
  const myName = teams.find((team) => team.id === myTeamId)?.name ?? null;
  const rounds = view.draftOrder.length === 0 ? 0 : Math.floor(view.picks.length / view.draftOrder.length);
  const bots = teams.filter((team) => team.isBot === true).length;
  return (
    // Full-bleed (review E2/R1): the frame spends the screen it is given; the team sheet takes
    // its own measure as a grid column, the pick log takes the rest, the finished board takes
    // the width. Mobile order (review E9): team first, the way out before the log — order
    // utilities re-sequence the single column without duplicating a region.
    <section aria-label="Mock draft results" className="flex w-full flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-display-md font-semibold leading-display text-text-primary">{copy.heading}</h1>
        {myTeamId === null || seat === 0 ? null : (
          <p className="font-mono text-xs tabular-nums text-text-muted">
            {myName === null ? "" : `${myName} · `}
            {`seat ${seat} of ${view.draftOrder.length} · ${rounds} rounds · ${bots} practice opponents`}
          </p>
        )}
        {/* ONE retention fact per view (review E3): the practice banner above this panel
            already says the room clears itself — `copy.retentionSentence` stays on the wire
            for any chrome-less consumer but is deliberately not restated here. */}
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {myTeamId === null ? null : (
          <>
            <div className="order-1">
              <RosterSection view={view} playersById={playersById} myTeamId={myTeamId} copy={copy} />
            </div>
            <div className="order-3 lg:order-2">
              <PickList view={view} players={players} playersById={playersById} myTeamId={myTeamId} copy={copy} />
            </div>
          </>
        )}
        <div className="order-2 flex flex-wrap items-center gap-3 border-t border-line pt-4 lg:order-3 lg:col-span-2">
          {actions.runAgain}
          {actions.openLobby}
          {actions.browseLeagues}
        </div>
        {/* The finished board (review R3/E7) — for EVERY caller, including the commissioner
            with no team, for whom the room's own completed picture is the whole point. */}
        <div className="order-4 min-h-0 lg:col-span-2">{board}</div>
      </div>
    </section>
  );
}
