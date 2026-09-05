"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { BoardReason } from "@/projections/preseason/board";
import type { PickReason } from "@/projections/decide/draft";
import type { Law } from "@/projections/laws/types";
import type { BuildLabel } from "@/draft-service/sim/classify";
import { PositionBadge } from "@/components/ui";
import { PlayerName } from "@/league-room/components/player-peek";
import { postPickBeat } from "../../assistant/beat";
import { oddsPhrase } from "../../assistant/odds-phrase";
import { detectRun, tierCountdowns } from "../../assistant/reads";
import { reasonSentence } from "../../assistant/reason-sentence";
import { byeCollisionFor, stackNoteFor, type StackCandidate } from "../../assistant/roster-fit";
import { useAssistant } from "../../assistant/use-assistant";

// Re-exported for this file's own existing import sites (`drawer-assistant-tab.test.tsx`) — the
// actual definition now lives in `../../assistant/reason-sentence.ts` (see that module's own
// docblock for why), shared verbatim with the Assistant demo rather than duplicated.
export { reasonSentence };

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
const EMPTY_CALL_COPY = "The assistant has nothing to say right now.";
const FETCH_FAILED_COPY = "We could not reach the assistant. It tries again on the next pick.";

/** `PickReason` codes whose sentence is a closed-form restatement of the same survival number the
 *  candidate's own `makeItBack` line already states measured (R-1: displayed odds come from the
 *  micro-sim). `reasonSentence` still exists and is still correct for a candidate with no measured
 *  odds — this list is only for candidates that already show one survival claim, so they never
 *  show two that could disagree. */
const SURVIVAL_REASON_CODES = new Set<PickReason["code"]>(["will_not_survive", "safe_to_wait"]);

/** The Simulator (`simulator-client.tsx`) and My Sheet's insights rail carry the identical map —
 *  duplicated here rather than imported because `@/draft-service/sim/classify` is server-side
 *  code, and this client room may only `import type` from it (the room/server boundary this
 *  repo's own lint rule enforces): `BuildLabel` the type crosses that line, but this const, a
 *  runtime value, cannot. */
const BUILD_LABEL_TEXT: Readonly<Record<BuildLabel, string>> = {
  "hero-RB": "Hero-RB",
  "zero-RB": "Zero-RB",
  "robust-RB": "Robust RB",
  "early-TE": "Early TE",
  "late-QB": "Late QB",
};

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
  const { call, prePickCall, loading, error } = useAssistant(draftId, view.pickNumber, myTeamId);

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

  // THE POST-PICK BEAT — Task 7. `prePickCall` is the hook's own latch (`use-assistant.ts`
  // docblock): it is set only from a call that was live while THIS seat was on the clock, and
  // survives every other seat's picks in between, so it is already guaranteed to be "my turn's
  // call" — no further onTheClock check needed here. INVARIANT: a pick number and `onTheClock`
  // together identify the asking seat's own turn (only the seat on the clock for a given pick
  // number can be the one who resolves it), so looking up `view.picks` by `prePickCall.pickNumber`
  // alone is enough to find the exact player this seat picked — no teamId match required. Absent
  // that latch, or absent a matching pick in the room's own history, there is nothing honest to
  // say (absence, not invention) and the beat stays null.
  const beat = useMemo(() => {
    if (prePickCall === null) return null;
    const pickedPick = view.picks.find((entry) => entry.pickNumber === prePickCall.pickNumber);
    if (pickedPick === undefined) return null;
    return postPickBeat({
      pickedPlayerId: pickedPick.playerId,
      prePickCall,
      playerName: (id) => playersById.get(id)?.name ?? id,
    });
  }, [prePickCall, view.picks, playersById]);

  const myRosterTeamCodes = useMemo(() => (myTeamId === null ? [] : rosterTeamCodes(view, myTeamId, playersById)), [myTeamId, view, playersById]);
  const myRosterStack = useMemo(() => (myTeamId === null ? [] : rosterStackCandidates(view, myTeamId, playersById)), [myTeamId, view, playersById]);

  // THE BUILDS LINE — Task 6's honest wiring of `call.yourBuild`/`call.winningBuilds` (both
  // already computed by `assistantCallCore`, never rendered before this). `winningBuilds` is the
  // whole gate: `null` means no cached sim run exists for this league and seat yet, an honest
  // absence rather than an invented list, so the block renders nothing rather than a guess. The
  // top three by `top3FinishRate`, ties broken by label, so the ordering never depends on the
  // registry's own iteration order.
  const topWinningBuilds = useMemo(
    () =>
      call === null || call.winningBuilds === null
        ? []
        : [...call.winningBuilds].sort((a, b) => b.top3FinishRate - a.top3FinishRate || a.label.localeCompare(b.label)).slice(0, 3),
    [call],
  );

  if (myTeamId === null) {
    return <p className="text-sm text-text-faint">{NO_SEAT_COPY}</p>;
  }

  if (call === null) {
    // A dropped request is not the same story as an honestly empty call — `error` is set only
    // when the fetch itself failed (see `use-assistant.ts`'s own contract), so a network failure
    // gets its own honest line rather than reading as "the assistant looked and found nothing."
    const text = loading ? "Reading the board." : error !== null ? FETCH_FAILED_COPY : EMPTY_CALL_COPY;
    return <p className="text-sm text-text-faint">{text}</p>;
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
          // R-1: displayed odds come from the micro-sim. A candidate whose `makeItBack` is
          // already rendering the measured survival number below drops the reason list's own
          // closed-form restatement of that same claim, so the card never states two survival
          // numbers that could read as disagreeing with each other.
          const displayedSurvival = candidate.makeItBack === null ? null : candidate.makeItBack.survival;
          const hasDisplayedOdds = displayedSurvival !== null;
          const reasons = hasDisplayedOdds ? candidate.reasons.filter((reason) => !SURVIVAL_REASON_CODES.has(reason.code)) : candidate.reasons;
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
                {reasons.map((reason) => (
                  <li key={reason.code}>{reasonSentence(reason)}</li>
                ))}
              </ul>
              {displayedSurvival === null ? null : (
                <p className="text-xs text-text-faint">Our sims make it {oddsPhrase(displayedSurvival)} he is still here at your next turn.</p>
              )}
            </li>,
          ];
        })}
      </ol>
      {call.winningBuilds === null ? null : (
        <div data-testid="assistant-builds" className="flex flex-col gap-1">
          <p className="text-xs text-text-faint">
            Your build so far: {call.yourBuild.length === 0 ? "no shape yet" : call.yourBuild.map((label) => BUILD_LABEL_TEXT[label]).join(", ")}.
          </p>
          {topWinningBuilds.length === 0 ? null : (
            <ul className="flex flex-col gap-0.5 text-xs text-text-faint">
              {topWinningBuilds.map((build) => (
                <li key={build.label}>
                  {BUILD_LABEL_TEXT[build.label]} wins {Math.round(build.top3FinishRate * 100)}% of sims from your slot.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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
