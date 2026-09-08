"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdvisorView, SeatAhead } from "@/draft-service/assistant/view";
import { Button, Card, Modal } from "@/components/ui";
import { postPickBeat } from "@/draft-room/advisor/beat";
import { AdvisorPanel } from "@/draft-room/advisor/components/advisor-panel";
import { changedSinceLine } from "@/draft-room/advisor/format";
import { planDelta } from "@/draft-room/advisor/plan-delta";
import { foldLandedView } from "@/draft-room/advisor/use-advisor";
import { byeCollisionFor } from "@/draft-room/assistant/roster-fit";
import { addToQueue, removeFromQueue } from "@/draft-room/state/queue";
import type { AssistantDemoFixture } from "./fixture";

export interface AssistantDemoProps {
  readonly fixture: AssistantDemoFixture;
}

/** The post-pick latch the live hook keeps, replayed over the fixture's own sequence of views. */
function latchedViews(views: readonly AdvisorView[]): readonly (AdvisorView | null)[] {
  return views.reduce<{ readonly held: ReturnType<typeof foldLandedView>; readonly out: readonly (AdvisorView | null)[] }>(
    (acc, view) => {
      const held = foldLandedView(acc.held, view);
      return { held, out: [...acc.out, held.prePickView] };
    },
    { held: { view: null, prePickView: null, previousPlan: null }, out: [] },
  ).out;
}

/**
 * THE GUIDED DEMO. Steps a fixed, precomputed replay one pick at a time and renders the SAME
 * three bands the room's advisor tab renders, from `fixture.advisor[step]` — a real `AdvisorView`
 * computed by the identical `advisorCore` a live room calls. Queue is a local list here; Draft
 * opens a confirmation (a phone's own two-step rule) and then steps the replay forward. The
 * replay's own pick at that step is what the room actually did, and the demo says so when your
 * pick differs from it, rather than pretending the replay followed you.
 */
export function AssistantDemo({ fixture }: AssistantDemoProps) {
  const totalPicks = fixture.picks.length;
  const [step, setStep] = useState(0);
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setStep((current) => Math.min(totalPicks, current + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalPicks]);

  const displayNameById = useMemo(() => new Map(fixture.players.map((player) => [player.playerId, player.displayName] as const)), [fixture.players]);
  const nflTeamById = useMemo(() => new Map(fixture.players.map((player) => [player.playerId, player.nflTeam] as const)), [fixture.players]);
  const byeWeeks = useMemo(() => new Map(fixture.byeWeeksByTeam), [fixture.byeWeeksByTeam]);
  const latched = useMemo(() => latchedViews(fixture.advisor), [fixture.advisor]);
  const nameOf = (playerId: string): string => displayNameById.get(playerId) ?? playerId;

  const view = fixture.advisor[step]!;
  const previous = step === 0 ? null : fixture.advisor[step - 1]!;
  const picksSoFar = fixture.picks.slice(0, step);
  const queueOrder = useMemo(() => new Map(queue.filter((id) => !picksSoFar.some((pick) => pick.playerId === id)).map((id, index) => [id, index + 1] as const)), [queue, picksSoFar]);

  const beat = useMemo(() => {
    const prePickView = latched[step] ?? null;
    if (prePickView === null) return null;
    const pickedPick = fixture.picks.find((pick) => pick.pickNumber === prePickView.stamp.computedAtPick);
    return pickedPick === undefined ? null : postPickBeat({ pickedPlayerId: pickedPick.playerId, prePickView, playerName: nameOf });
  }, [latched, step, fixture.picks, displayNameById]); // eslint-disable-line react-hooks/exhaustive-deps

  const changedSince = previous === null ? null : changedSinceLine(planDelta(previous.plan, view.plan), nameOf, view.teamCount, (turn) => view.plan.turns[turn - 1]?.pickNumber ?? null);

  const top = view.now[0] ?? null;
  const povRosterTeamCodes = picksSoFar.filter((pick) => pick.teamId === fixture.povTeamId).flatMap((pick) => nflTeamById.get(pick.playerId) ?? []);
  const bye = top === null ? null : byeCollisionFor(nflTeamById.get(top.playerId) ?? "", byeWeeks, povRosterTeamCodes);
  const notes = bye === null || top === null ? [] : [`${nameOf(top.playerId)} shares Bye ${bye.week} with ${bye.count} rostered ${bye.count === 1 ? "player" : "players"}. Drafting him would make it ${bye.wouldMake}.`];

  const latestPick = step > 0 ? fixture.picks[step - 1]! : null;
  const replayPick = step < totalPicks ? fixture.picks[step]! : null;

  function confirmDraft(playerId: string): void {
    setConfirmId(null);
    const taken = nameOf(playerId);
    if (replayPick === null) return;
    setDraftNote(
      replayPick.playerId === playerId
        ? `You took ${taken}. The replay took him here too.`
        : `You took ${taken}. The replay's own pick here was ${nameOf(replayPick.playerId)}, and the replay continues from that.`,
    );
    setStep((current) => Math.min(totalPicks, current + 1));
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <p data-testid="demo-replay-label" className="text-sm text-text-muted">
          {`A replayed room, seeded and reproducible. ${fixture.teamCount} teams, seed ${fixture.seed}, ${fixture.runs} runs behind every odds number. You hold seat ${fixture.povSeatNumber} in the snake order. The writer never runs here, so every sentence is the template floor.`}
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
            {`${latestPick.teamLabel} took ${nameOf(latestPick.playerId)}.`}
          </p>
        )}
        {draftNote === null ? null : (
          <p data-testid="demo-draft-note" className="text-sm text-text-primary">
            {draftNote}
          </p>
        )}
      </Card>

      <AdvisorPanel
        view={view}
        acts={{
          canDraft: view.onTheClock && replayPick !== null,
          submitting: false,
          queueOrder,
          onDraft: (playerId) => setConfirmId(playerId),
          onQueueToggle: (playerId) => setQueue((current) => (current.includes(playerId) ? removeFromQueue(current, playerId) : addToQueue(current, playerId))),
        }}
        renderName={(_, name) => <span>{name}</span>}
        seatLabel={(seat: SeatAhead) => fixture.teamLabels[seat.teamId] ?? `Seat ${seat.seat}`}
        changedSince={changedSince}
        changedSincePick={previous?.plan.computedAtPick ?? null}
        recomputing={false}
        beat={beat}
        notes={notes}
      />

      <Modal
        open={confirmId !== null}
        title={confirmId === null ? "Draft" : `Draft ${nameOf(confirmId)}?`}
        onClose={() => setConfirmId(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmId(null)}>
              Back
            </Button>
            <Button variant="verb" onClick={() => confirmId !== null && confirmDraft(confirmId)}>
              Confirm pick
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">In a live room this is the same pick path the pool uses, with the same undo window.</p>
      </Modal>
    </div>
  );
}
