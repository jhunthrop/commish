"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardReason } from "@/projections/preseason/board";
import { Button, Card, PositionBadge } from "@/components/ui";
import { postPickBeat } from "@/draft-room/assistant/beat";
import { oddsPhrase } from "@/draft-room/assistant/odds-phrase";
import { detectRun, tierCountdowns } from "@/draft-room/assistant/reads";
import { reasonSentence } from "@/draft-room/assistant/reason-sentence";
import { byeCollisionFor } from "@/draft-room/assistant/roster-fit";
import type { AssistantDemoFixture } from "./fixture";
import { latchPrePickCalls } from "./pre-pick-latch";

export interface AssistantDemoProps {
  readonly fixture: AssistantDemoFixture;
}

/**
 * THE GUIDED DEMO — Task 12. Steps a fixed, precomputed replay (`AssistantDemoFixture`) one pick
 * at a time and renders the SAME panes `DrawerAssistantTab` renders in a live room, called
 * against exactly this step's own state: `detectRun`/`tierCountdowns` (Task 4) over the board as
 * it stands after `step` picks, `byeCollisionFor` (Task 5) against this seat's own roster so far,
 * and `postPickBeat` (Task 7, with `oddsPhrase`) once a pick of this seat's own has landed. The
 * one thing NOT recomputed here is the call itself (`AssistantCallView`, three candidates with
 * real reasons and real make-it-back odds): that is `fixture.calls[step]`, precomputed once by
 * `assistantCallCore` — the identical function a real room's Assistant calls — at fixture-build
 * time. No fetch, no gateway, ever: every control below only ever moves `step`.
 */
export function AssistantDemo({ fixture }: AssistantDemoProps) {
  const totalPicks = fixture.picks.length;
  const [step, setStep] = useState(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setStep((current) => Math.min(totalPicks, current + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalPicks]);

  const positionsById = useMemo(() => new Map(fixture.players.map((player) => [player.playerId, player.position] as const)), [fixture.players]);
  const displayNameById = useMemo(() => new Map(fixture.players.map((player) => [player.playerId, player.displayName] as const)), [fixture.players]);
  const nflTeamById = useMemo(() => new Map(fixture.players.map((player) => [player.playerId, player.nflTeam] as const)), [fixture.players]);
  const byeWeeks = useMemo(() => new Map(fixture.byeWeeksByTeam), [fixture.byeWeeksByTeam]);

  const reasonsById = useMemo<ReadonlyMap<string, readonly BoardReason[]>>(() => {
    const map = new Map<string, BoardReason[]>();
    for (const row of fixture.tierReasons) {
      map.set(row.playerId, [{ code: "tier_cliff", playersLeftInTier: row.playersLeftInTier, dropToNextTier: row.dropToNextTier }]);
    }
    return map;
  }, [fixture.tierReasons]);

  const prePickCalls = useMemo(() => latchPrePickCalls(fixture.calls), [fixture.calls]);

  const picksSoFar = useMemo(() => fixture.picks.slice(0, step), [fixture.picks, step]);
  const draftedIds = useMemo(() => new Set(picksSoFar.map((pick) => pick.playerId)), [picksSoFar]);
  const undraftedIds = useMemo(() => fixture.players.filter((player) => !draftedIds.has(player.playerId)).map((player) => player.playerId), [fixture.players, draftedIds]);
  const recentPositions = useMemo(
    () =>
      picksSoFar.flatMap((pick) => {
        const position = positionsById.get(pick.playerId);
        return position === undefined ? [] : [position];
      }),
    [picksSoFar, positionsById],
  );
  const run = useMemo(() => detectRun(recentPositions), [recentPositions]);
  const tierRows = useMemo(() => tierCountdowns(undraftedIds, positionsById, reasonsById), [undraftedIds, positionsById, reasonsById]);

  const call = fixture.calls[step]!;
  const prePickCall = prePickCalls[step] ?? null;

  const beat = useMemo(() => {
    if (prePickCall === null) return null;
    const pickedPick = fixture.picks.find((pick) => pick.pickNumber === prePickCall.pickNumber);
    if (pickedPick === undefined) return null;
    return postPickBeat({ pickedPlayerId: pickedPick.playerId, prePickCall, playerName: (id) => displayNameById.get(id) ?? id });
  }, [prePickCall, fixture.picks, displayNameById]);

  const povRosterTeamCodes = useMemo(
    () =>
      picksSoFar
        .filter((pick) => pick.teamId === fixture.povTeamId)
        .flatMap((pick) => {
          const nflTeam = nflTeamById.get(pick.playerId);
          return nflTeam === undefined ? [] : [nflTeam];
        }),
    [picksSoFar, fixture.povTeamId, nflTeamById],
  );

  const top = call.candidates[0] ?? null;
  const topNflTeam = top === null ? null : (nflTeamById.get(top.playerId) ?? null);
  const byeNote = top === null || topNflTeam === null ? null : byeCollisionFor(topNflTeam, byeWeeks, povRosterTeamCodes);

  const latestPick = step > 0 ? fixture.picks[step - 1]! : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <p data-testid="demo-replay-label" className="text-sm text-text-muted">
          {`A replayed room, seeded and reproducible. ${fixture.teamCount} teams, seed ${fixture.seed}. You hold seat ${fixture.povSeatNumber} in the snake order.`}
        </p>
        <div className="flex items-center justify-between gap-4">
          <Button variant="secondary" size="sm" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
            Back
          </Button>
          <p data-testid="demo-step-label" className="text-sm font-medium text-text-primary">
            {step === 0 ? "Before pick 1" : `Pick ${step} of ${totalPicks}`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setStep((current) => Math.min(totalPicks, current + 1))} disabled={step === totalPicks}>
            Forward
          </Button>
        </div>
        {latestPick === null ? null : (
          <p data-testid="demo-latest-pick" className="text-sm text-text-muted">
            {`${latestPick.teamLabel} took ${displayNameById.get(latestPick.playerId) ?? latestPick.playerId} (${positionsById.get(latestPick.playerId) ?? "?"}).`}
          </p>
        )}
      </Card>

      <div className="flex flex-col gap-3">
        {beat === null ? null : (
          <p data-testid="assistant-beat" className="rounded-sm bg-surface-raised px-2.5 py-1.5 text-sm font-semibold text-text-primary">
            {beat}
          </p>
        )}
        {run === null ? null : (
          <p data-testid="assistant-run-alert" className="rounded-sm bg-surface-raised px-2.5 py-1.5 text-sm font-semibold text-text-primary">
            {`${run.position} is on a run. ${run.count} of the last ${run.window} picks were ${run.position}.`}
          </p>
        )}
        {tierRows.length === 0 ? null : (
          <ul data-testid="assistant-tier-strip" className="flex flex-col gap-1">
            {tierRows.map((row) => (
              <li key={row.position} className="text-xs text-text-faint">
                {`Only ${row.playersLeftInTier} ${row.position} left in this tier. The price drops ${row.dropToNextTier.toFixed(1)} points after that.`}
              </li>
            ))}
          </ul>
        )}

        {call.candidates.length === 0 ? (
          <p className="text-sm text-text-faint">The assistant has nothing to say right now.</p>
        ) : (
          <>
            <p className="text-xs text-text-faint">{call.onTheClock ? "You are on the clock." : "Previewing your very next turn."}</p>
            <ol data-testid="assistant-candidates" className="flex flex-col gap-2">
              {call.candidates.map((candidate) => (
                <li key={candidate.playerId} className="flex flex-col gap-1 rounded-sm bg-surface-raised px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <PositionBadge position={candidate.position} size="sm" />
                    <span className="font-display text-md font-semibold text-text-primary">{displayNameById.get(candidate.playerId) ?? candidate.playerId}</span>
                  </div>
                  <ul className="flex flex-col gap-0.5 text-xs text-text-faint">
                    {candidate.reasons.map((reason) => (
                      <li key={reason.code}>{reasonSentence(reason)}</li>
                    ))}
                  </ul>
                  {candidate.makeItBack === null || candidate.makeItBack.survival === null ? null : (
                    <p className="text-xs text-text-faint">{`Our sims make it ${oddsPhrase(candidate.makeItBack.survival)} he is still here at your next turn.`}</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {byeNote === null || top === null ? null : (
          <p data-testid="assistant-bye-note" className="text-xs text-text-faint">
            {`${displayNameById.get(top.playerId) ?? top.playerId} shares Bye ${byeNote.week} with ${byeNote.count} rostered ${byeNote.count === 1 ? "player" : "players"}. Drafting him would make it ${byeNote.wouldMake}.`}
          </p>
        )}
      </div>
    </div>
  );
}
