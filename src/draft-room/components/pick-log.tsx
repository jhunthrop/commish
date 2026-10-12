"use client";

import { useMemo } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@research/domain/player";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { PlayerFace, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { PlayerName } from "@/league-room/components/player-peek";
import { rosterSpots } from "../state/format";
import { teamName, teamsById } from "../lib/lookups";
import { verdictForPick, verdictPopulation } from "../lib/verdict";
import { VerdictChip } from "./verdict-chip";

export interface PickLogProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  /**
   * The pool's own ranked snapshot order, for each pick's verdict. Required rather than derived
   * from `playersById`: a `Map`'s insertion order happens to carry the same ranking today, and a
   * board rank is far too load-bearing a fact to rest on that happening to stay true.
   */
  readonly players: readonly Player[];
  /** The caller's own seat, so their own picks read as theirs. Null while watching. */
  readonly myTeamId: string | null;
}

interface LoggedPick {
  readonly pick: CompletedPick;
  readonly player: Player;
}

/**
 * Every pick this draft has made, newest first, with the player resolved. A pick whose player id
 * is not in `playersById` (a resync gap, never expected in steady state) is skipped rather than
 * rendered with a placeholder — the log stays a list of true facts, never a guess.
 */
function loggedPicks(picks: readonly CompletedPick[], playersById: ReadonlyMap<string, Player>): readonly LoggedPick[] {
  const entries: LoggedPick[] = [];
  for (let index = picks.length - 1; index >= 0; index--) {
    const pick = picks[index]!;
    const player = playersById.get(pick.playerId);
    if (player !== undefined) entries.push({ pick, player });
  }
  return entries;
}

/**
 * THE ROOM'S OWN HISTORY, AT DENSITY (Gameday, law 4) — the region that replaced the one-line
 * `PickWire` under the room's board.
 *
 * WHY IT EXISTS. Collapsing the board's unreached rounds (law 4, `DRAFT_ROOM_CONFIG.
 * boardFutureRoundsShown`) handed the stage back several hundred pixels, and the honest thing to
 * do with reclaimed space is not to stretch a grid of dashes into it. The stage's second-best
 * fact after the board itself is what the room has actually DONE, and until now the room said
 * that in one truncated mono line that showed six picks and hid every one before them. *"A
 * manager on Sunday wants more true facts per screen, not fewer."*
 *
 * WHY IT IS ROWS AND NOT CARDS. Law 3's amended test, unchanged: *a thing you act on or compare
 * against its neighbours may be a card; a thing you read down a column stays a row.* Nothing in a
 * pick log is actionable — every pick in it already happened — and the whole point is to scan the
 * column for a run at your position. Hairlines, one row per pick, mono where the value is data.
 *
 * WHAT IT ADDS THAT THE WIRE COULD NOT. The draft's own progress as a NUMBER (law 2: pick 44 of
 * 180, the room's total being `rosterSpots × seats`, which is arithmetic on the payload and not a
 * projection), every pick rather than the last six, the drafting team on every row, and each
 * pick's verdict rather than only the newest one's. The room's total is stated once, in the one
 * place it is not already implied.
 *
 * NO MOTION (law 6). Rows arrive because a real pick landed, and `PickCelebration` above already
 * owns that moment; a second animation on the same event would be the room performing rather than
 * reporting. The list is `aria-label`led and is not a live region for the same reason.
 */
export function PickLog({ view, teams, playersById, players, myTeamId }: PickLogProps) {
  const entries = useMemo(() => loggedPicks(view.picks, playersById), [view.picks, playersById]);
  const population = useMemo(() => verdictPopulation(players, view.picks), [players, view.picks]);
  const byId = teamsById(teams);
  // The room's whole shape, from the payload: one pick per roster spot per seat. Zero seats (a
  // draft whose order has not been drawn) yields no total rather than a divide-by-nothing, and
  // the header states only the count it does have.
  const totalPicks = view.draftOrder.length * rosterSpots(view.slotConfig);

  return (
    <section aria-label="Pick log" className="flex min-h-0 flex-col gap-1">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <h2 className={`${MICRO_LABEL} text-text-faint`}>Pick log</h2>
        {/* Law 2's pairing at the size a supporting band earns: the figure in mono tabular ink
            over an 11px micro-label. No `Stat`: a pick count falls inside no population, and a
            number is never coloured for looking big. */}
        <span className="flex shrink-0 items-baseline gap-1">
          <span data-testid="pick-log-progress" className="font-mono text-md font-semibold tabular-nums text-text-primary">
            {totalPicks === 0 ? view.picks.length : `${view.picks.length} of ${totalPicks}`}
          </span>
          <span className={`${MICRO_LABEL} text-text-faint`}>picks in</span>
        </span>
      </div>
      {entries.length === 0 ? (
        // Honest silence, not a placeholder row: nothing has happened yet and the rail above
        // already says why.
        <p className="text-sm text-text-muted">No picks yet.</p>
      ) : (
        <ol aria-label="Every pick, newest first" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {entries.map(({ pick, player }) => (
            <li
              key={pick.pickNumber}
              data-mine={pick.teamId === myTeamId ? "true" : undefined}
              className="flex items-center gap-3 border-t border-line py-1.5 first:border-t-0"
            >
              <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-text-faint">{`#${pick.pickNumber}`}</span>
              {/* Law 3: the club colour behind the face, on every surface that draws a player.
                  `sm`, because this is a dense log row rather than the pool's own board. */}
              <PlayerFace player={player} size="sm" />
              {/* The player's three facts travel TOGETHER, in one group that takes the row's
                  slack — name, sticker, club. Letting the name alone take `flex-1` across a
                  980px stage stranded the sticker and the club code half a screen from the man
                  they describe, which is the opposite of law 3: an object's attributes belong on
                  the object. */}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <PlayerName leagueId={view.leagueId} playerId={player.id} name={player.name} className="truncate text-sm font-semibold text-text-primary" />
                <PositionBadge position={player.position} size="sm" />
                <span className="shrink-0 font-mono text-xs text-text-muted">{player.nflTeam}</span>
              </span>
              {/* Whose pick it was. Ink for the caller's own seat, muted for everyone else's —
                  one weight step, no second colour, so a manager can find his own row down a
                  scrolling column without the log growing a legend. */}
              <span
                className={`w-40 shrink-0 truncate text-sm ${pick.teamId === myTeamId ? "font-semibold text-text-primary" : "text-text-muted"}`}
              >
                {teamName(byId, pick.teamId)}
              </span>
              <span className="w-20 shrink-0 text-right">
                <VerdictChip verdict={verdictForPick(population, pick)} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
