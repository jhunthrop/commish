"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { BoardReason } from "@/projections/preseason/board";
import type { Law } from "@/projections/laws/types";
import type { PickReason } from "@/projections/decide/draft";
import { PositionBadge } from "@/components/ui";
import { PlayerName } from "@/league-room/components/player-peek";
import { postPickBeat } from "../../assistant/beat";
import { detectRun, tierCountdowns } from "../../assistant/reads";
import { byeCollisionFor, stackNoteFor, type StackCandidate } from "../../assistant/roster-fit";
import { useAssistant } from "../../assistant/use-assistant";

export interface DrawerAssistantTabProps {
  readonly draftId: string;
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  /** Server-ranked, best first — the board order `tierCountdowns` reads its "best undrafted
   *  player per position" from, same contract as `DrawerByesTabProps.players`. */
  readonly players: readonly Player[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly available: ReadonlySet<string>;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]>;
  readonly laws: readonly Law[];
}

const NO_SEAT_COPY = "You have no seat in this draft. The assistant argues for a seat.";

/**
 * ROUNDS TO QUARTERS, honestly. The extremes get their own words rather than a misleading
 * "about 1 in 1" or "about 0 in 4" — nobody reads "better than 9 in 10" as a promise, but a
 * rounded quarter at the edges reads as false precision in the other direction (Task 7's
 * `postPickBeat` reuses this exact export, so the phrasing here is the product's only one).
 */
export function oddsPhrase(survival: number): string {
  if (survival > 0.9) return "better than 9 in 10";
  if (survival < 0.1) return "long odds";
  const quarter = Math.round(survival * 4) / 4;
  switch (quarter) {
    case 0.25:
      return "about 1 in 4";
    case 0.5:
      return "about 1 in 2";
    case 0.75:
      return "about 3 in 4";
    default:
      return survival >= 0.5 ? "better than 9 in 10" : "long odds";
  }
}

/** One plain sentence per `PickReason` variant, numbers straight off the reason's own fields —
 *  never a fresh estimate. Exhaustive over the union with no `default`, so a new reason code
 *  fails to compile here rather than rendering silently as nothing. */
export function reasonSentence(reason: PickReason): string {
  switch (reason.code) {
    case "value_over_replacement":
      return `He ranks No. ${reason.positionRank} at ${reason.position}, ${reason.valueOverReplacement.toFixed(1)} points over replacement.`;
    case "will_not_survive":
      return `He probably will not last. ${oddsPhrase(reason.survivalProbability)} he is still there at pick ${reason.nextPick}.`;
    case "safe_to_wait":
      return `He can wait. ${oddsPhrase(reason.survivalProbability)} he is still there at pick ${reason.nextPick}.`;
    case "no_further_turn":
      return `Pick ${reason.pickNumber} is your last turn of the draft. There is no next pick to wait for.`;
    case "tier_cliff":
      return `Only ${reason.playersLeftInTier} ${reason.position} left in this tier. The price drops ${reason.dropToNextTier.toFixed(1)} points after that.`;
    case "fills_starting_slot":
      return `He fills your starting ${reason.slot} slot.`;
    case "roster_saturated":
      return `You already roster ${reason.alreadyRostered} ${reason.position} and bench ${reason.alreadyBenched} more. He adds depth only.`;
  }
}

/** The asking seat's own rostered NFL team codes — `byeCollisionFor`'s own space (its docblock:
 *  team codes, not player ids). An empty roster slot (`playerId === null`) and a player id the
 *  pool no longer carries both drop out rather than poisoning the count with an unknown code. */
function rosterTeamCodes(view: DraftStateView, teamId: string, playersById: ReadonlyMap<string, Player>): readonly string[] {
  return (view.rosters[teamId] ?? []).flatMap((slot) => {
    if (slot.playerId === null) return [];
    const player = playersById.get(slot.playerId);
    return player === undefined ? [] : [player.nflTeam];
  });
}

/** The same roster, in `stackNoteFor`'s own `StackCandidate` shape. */
function rosterStackCandidates(view: DraftStateView, teamId: string, playersById: ReadonlyMap<string, Player>): readonly StackCandidate[] {
  return (view.rosters[teamId] ?? []).flatMap((slot) => {
    if (slot.playerId === null) return [];
    const player = playersById.get(slot.playerId);
    return player === undefined ? [] : [{ playerId: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam }];
  });
}

/**
 * THE ASSISTANT TAB — Task 6. The call itself (three candidates, each with its reasons as plain
 * sentences and a make-it-back line when the odds exist), then the room's own ambient reads
 * (Task 4's run alert and tier strip) and the top candidate's roster fit (Task 5's bye collision
 * and stack note). A commissioner (`myTeamId === null`) has no seat for the Assistant to argue
 * for, and is told so directly rather than shown an empty call — the same "nothing to say" law
 * the Roster handle already applies, stated in words here because this tab has no handle to hide
 * behind (it is never gated out of the drawer's tab row).
 */
export function DrawerAssistantTab({ draftId, view, myTeamId, players, playersById, available, byeWeeks, reasons, laws }: DrawerAssistantTabProps) {
  const { call, previousCall, loading } = useAssistant(draftId, view.pickNumber, myTeamId);

  const positionsById = useMemo(() => new Map([...playersById].map(([id, player]) => [id, player.position] as const)), [playersById]);
  const undraftedIds = useMemo(() => players.filter((player) => available.has(player.id)).map((player) => player.id), [players, available]);
  const tierRows = useMemo(() => tierCountdowns(undraftedIds, positionsById, reasons), [undraftedIds, positionsById, reasons]);
  const recentPositions = useMemo(() => {
    const ordered = [...view.picks].sort((a, b) => a.pickNumber - b.pickNumber);
    return ordered.flatMap((pick) => {
      const position = positionsById.get(pick.playerId);
      return position === undefined ? [] : [position];
    });
  }, [view, positionsById]);
  const run = useMemo(() => detectRun(recentPositions), [recentPositions]);

  // THE POST-PICK BEAT — Task 7. `previousCall.onTheClock === true` is the hook's own signal
  // (use-assistant.ts docblock) that the call it just replaced was live during YOUR turn, i.e. the
  // fetch that landed it was triggered by your own pick resolving, not some other seat's. Absent
  // that signal, or absent a matching pick in the room's own history, there is nothing honest to
  // say (absence, not invention) and the beat stays null.
  const beat = useMemo(() => {
    if (previousCall === null || !previousCall.onTheClock) return null;
    const pickedPick = view.picks.find((entry) => entry.pickNumber === previousCall.pickNumber);
    if (pickedPick === undefined) return null;
    return postPickBeat({
      pickedPlayerId: pickedPick.playerId,
      prePickCall: previousCall,
      playerName: (id) => playersById.get(id)?.name ?? id,
    });
  }, [previousCall, view.picks, playersById]);

  const myRosterTeamCodes = useMemo(() => (myTeamId === null ? [] : rosterTeamCodes(view, myTeamId, playersById)), [myTeamId, view, playersById]);
  const myRosterStack = useMemo(() => (myTeamId === null ? [] : rosterStackCandidates(view, myTeamId, playersById)), [myTeamId, view, playersById]);

  if (myTeamId === null) {
    return <p className="text-sm text-text-faint">{NO_SEAT_COPY}</p>;
  }

  if (call === null) {
    return <p className="text-sm text-text-faint">{loading ? "Reading the board." : "The assistant has nothing to say right now."}</p>;
  }

  const top = call.candidates[0] ?? null;
  const topPlayer = top === null ? null : (playersById.get(top.playerId) ?? null);
  const byeNote = top === null || topPlayer === null ? null : byeCollisionFor(topPlayer.nflTeam, byeWeeks, myRosterTeamCodes);
  const stackNote =
    top === null || topPlayer === null
      ? null
      : stackNoteFor({ playerId: topPlayer.id, name: topPlayer.name, position: topPlayer.position, nflTeam: topPlayer.nflTeam }, myRosterStack, laws);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-label="The assistant's call">
      {beat === null ? null : (
        <p data-testid="assistant-beat" className="rounded-sm bg-surface-raised px-2.5 py-1.5 text-sm font-semibold text-text-primary">
          {beat}
        </p>
      )}
      {run === null ? null : (
        <p data-testid="assistant-run-alert" className="rounded-sm bg-surface-raised px-2.5 py-1.5 text-sm font-semibold text-text-primary">
          {run.position} is on a run. {run.count} of the last {run.window} picks were {run.position}.
        </p>
      )}
      {tierRows.length === 0 ? null : (
        <ul data-testid="assistant-tier-strip" className="flex flex-col gap-1">
          {tierRows.map((row) => (
            <li key={row.position} className="text-xs text-text-faint">
              Only {row.playersLeftInTier} {row.position} left in this tier. The price drops {row.dropToNextTier.toFixed(1)} points after that.
            </li>
          ))}
        </ul>
      )}
      <ol className="flex flex-col gap-2">
        {call.candidates.flatMap((candidate) => {
          const player = playersById.get(candidate.playerId);
          if (player === undefined) return [];
          return [
            <li key={candidate.playerId} className="flex flex-col gap-1 rounded-sm bg-surface-raised px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <PositionBadge position={candidate.position} size="sm" />
                <PlayerName
                  leagueId={view.leagueId}
                  playerId={candidate.playerId}
                  name={player.name}
                  className="font-display text-md font-semibold text-text-primary"
                />
              </div>
              <ul className="flex flex-col gap-0.5 text-xs text-text-faint">
                {candidate.reasons.map((reason) => (
                  <li key={reason.code}>{reasonSentence(reason)}</li>
                ))}
              </ul>
              {candidate.makeItBack === null || candidate.makeItBack.survival === null ? null : (
                <p className="text-xs text-text-faint">
                  Our sims make it {oddsPhrase(candidate.makeItBack.survival)} he is still here at your next turn.
                </p>
              )}
            </li>,
          ];
        })}
      </ol>
      {byeNote === null && stackNote === null ? null : (
        <div className="flex flex-col gap-1">
          {byeNote === null || topPlayer === null ? null : (
            <p data-testid="assistant-bye-note" className="text-xs text-text-faint">
              {topPlayer.name} shares Bye {byeNote.week} with {byeNote.count} rostered {byeNote.count === 1 ? "player" : "players"}. Drafting him would
              make it {byeNote.wouldMake}.
            </p>
          )}
          {stackNote === null ? null : (
            <p data-testid="assistant-stack-note" className="text-xs text-text-faint">
              {stackNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
