"use client";

import { useEffect, useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import { Button, Card, Modal, PositionBadge, SegmentGroup } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { AdvisorPanel } from "@/draft-room/advisor/components/advisor-panel";
import { OddsGlance } from "@/draft-room/advisor/components/odds-glance";
import { ADVISOR_ROOM_CONFIG } from "@/draft-room/advisor/config";
import { groupByTier } from "@/draft-room/advisor/tier-groups";
import { addToQueue, removeFromQueue } from "@/draft-room/state/queue";
import type { AssistantDemoFixture, DemoPlayer } from "./fixture";

export interface AssistantDemoProps {
  readonly fixture: AssistantDemoFixture;
}

const ALL = "ALL";
const LIST_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];
const FILTER_OPTIONS = [{ value: ALL, label: "All" }, ...LIST_POSITIONS.map((position) => ({ value: position, label: position }))];

/** The synthetic player as the room's primitives expect one: no headshot, so the face is the
 *  initials on the club colour, exactly what a real room shows for a player the feed has no
 *  photo for. */
function toPlayer(demo: DemoPlayer): Player {
  return { id: demo.playerId, name: demo.displayName, position: demo.position, nflTeam: demo.nflTeam, headshotUrl: null, adp: null };
}

/**
 * THE GUIDED DEMO. Steps a fixed, precomputed replay one pick at a time and renders the SAME
 * advisor panel the room's tab renders, from `fixture.advisor[step]` — a real `AdvisorView`
 * computed by the identical `advisorCore` a live room calls — and, under it, the board with the
 * same next-turn odds the room's pool rows carry, tier headers included when one position shows.
 * Queue is a local list here; Draft opens a confirmation (a phone's own two-step rule) and then
 * steps the replay forward. The replay's own pick at that step is what the room actually did,
 * and the demo says so when your pick differs from it.
 */
export function AssistantDemo({ fixture }: AssistantDemoProps) {
  const totalPicks = fixture.picks.length;
  const [step, setStep] = useState(0);
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(ALL);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setStep((current) => Math.min(totalPicks, current + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalPicks]);

  const playersById = useMemo(() => new Map(fixture.players.map((player) => [player.playerId, toPlayer(player)] as const)), [fixture.players]);
  const byeWeeks = useMemo(() => new Map(fixture.byeWeeksByTeam), [fixture.byeWeeksByTeam]);
  const nameOf = (playerId: string): string => playersById.get(playerId)?.name ?? playerId;

  const view = fixture.advisor[step]!;
  const picksSoFar = fixture.picks.slice(0, step);
  const drafted = useMemo(() => new Set(picksSoFar.map((pick) => pick.playerId)), [picksSoFar]);
  const queueOrder = useMemo(() => new Map(queue.filter((id) => !drafted.has(id)).map((id, index) => [id, index + 1] as const)), [queue, drafted]);

  const positionRanks = useMemo(() => {
    const seen = new Map<Position, number>();
    return new Map(
      fixture.boardOrder.map((id) => {
        const position = playersById.get(id)!.position;
        const next = (seen.get(position) ?? 0) + 1;
        seen.set(position, next);
        return [id, next] as const;
      }),
    );
  }, [fixture.boardOrder, playersById]);
  const rows = useMemo(() => {
    const undrafted = fixture.boardOrder.filter((id) => !drafted.has(id)).map((id) => playersById.get(id)!);
    return undrafted.filter((player) => filter === ALL || player.position === filter).slice(0, ADVISOR_ROOM_CONFIG.demoListSize);
  }, [fixture.boardOrder, drafted, playersById, filter]);
  const groups = useMemo(() => (filter === ALL ? [{ header: null, rows }] : groupByTier(rows, (player) => player.id, view.tiers)), [filter, rows, view.tiers]);

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
          {`A replayed room, seeded and reproducible. ${fixture.teamCount} teams, seed ${fixture.seed}, ${fixture.runs} runs behind every odds number. You hold seat ${fixture.povSeatNumber} in the snake order.`}
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
        playersById={playersById}
        byeWeeks={byeWeeks}
        recomputing={false}
      />

      <Card as="section" aria-label="The board, with your odds" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`${MICRO_LABEL} text-text-faint`}>Still there at your next pick</span>
          <SegmentGroup label="Show one position" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        </div>
        <ol data-testid="demo-odds-list" aria-label="Undrafted players, best first" className="flex flex-col gap-1">
          {groups.flatMap((group) => [
            ...(group.header === null
              ? []
              : [
                  <li key={`tier:${group.header}`} data-testid="advisor-tier-header" className={`${MICRO_LABEL} px-2.5 pt-2 text-text-faint`}>
                    {group.header}
                  </li>,
                ]),
            ...group.rows.map((player) => (
              <li key={player.id} data-testid="demo-odds-row" className="flex items-center gap-2 rounded-md bg-surface-raised px-2.5 py-1.5">
                <PositionBadge position={player.position} rank={positionRanks.get(player.id)} size="sm" />
                <span className="min-w-0 flex-1 truncate font-display text-md font-semibold text-text-primary">{player.name}</span>
                {view.odds === null ? null : <OddsGlance odds={view.odds} playerId={player.id} />}
              </li>
            )),
          ])}
        </ol>
      </Card>

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
