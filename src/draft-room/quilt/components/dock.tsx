"use client";

import { memo, useMemo, useState } from "react";
import type { Player } from "@research/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Card } from "@/components/ui";
import { AdvisorPanel } from "../../advisor/components/advisor-panel";
import { ADVISOR_CARD_FRAME } from "../../advisor/components/next-pick-card";
import type { UseAdvisorResult } from "../../advisor/use-advisor";
import { DockCall } from "./dock-call";
import { PoolList } from "./pool-list";
import type { RoomActs } from "./room-acts";

export interface DockProps extends RoomActs {
  readonly view: DraftStateView;
  readonly players: readonly Player[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly queue: readonly string[];
  readonly advisor: UseAdvisorResult;
  readonly nextPickLabel: string | null;
  /** The room's one available set, built once by the room (review L11). */
  readonly available: ReadonlySet<string>;
  /** Phone: the queue and the list ride in the page's flow; the call block is the caller's. */
  readonly withCall: boolean;
}

type DockList = "pool" | "calls";

const LIST_LABEL: Readonly<Record<DockList, string>> = { pool: "Pool", calls: "Our calls" };

/**
 * THE DOCK (rulings 1 and 3): the queue as chips along the top, a two-way switch between the
 * pool and our shortlist (the advisor's rows with Show 3, 5 or 10), and our call beside the one
 * Draft verb on the right. The queue strip carries no explainer sentence: the league's rules
 * page says what happens when a clock runs out, and a strip is not the place to repeat it (P7).
 */
export const Dock = memo(function Dock({ view, players, playersById, myTeamId, byeWeeks, queue, advisor, nextPickLabel, available, withCall, ...acts }: DockProps) {
  const [list, setList] = useState<DockList>("pool");
  const queued = useMemo(() => queue.flatMap((playerId) => (available.has(playerId) ? [playersById.get(playerId)] : [])).filter((player): player is Player => player !== undefined), [queue, available, playersById]);
  const queueOrder = useMemo(() => new Map(queue.map((playerId, index) => [playerId, index + 1] as const)), [queue]);
  const advisorActs = useMemo(() => ({ canDraft: acts.canDraft, submitting: acts.submitting, queueOrder, onDraft: acts.onDraft, onQueueToggle: acts.onQueueToggle }), [acts.canDraft, acts.submitting, queueOrder, acts.onDraft, acts.onQueueToggle]);
  const odds = advisor.view?.odds ?? null;

  return (
    <footer data-testid="dock" aria-label="Your pick" className={`grid h-full min-h-0 w-full min-w-0 rounded-t-xl bg-surface-elevated shadow-card ${withCall ? "grid-cols-[minmax(0,1fr)_32.5rem] grid-rows-[2.5rem_minmax(0,1fr)] [grid-template-areas:'queue_queue'_'list_call']" : "grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] [grid-template-areas:'queue'_'list']"}`}>
      <div id="dock-queue" className="flex min-h-10 min-w-0 items-center gap-2 overflow-x-auto border-b border-line px-3 text-xs text-text-faint [grid-area:queue]">
        <span className="shrink-0">Queue</span>
        {queued.length === 0 ? <span className="shrink-0 text-text-faint">nobody yet</span> : null}
        {queued.map((player, index) => (
          <span key={player.id} data-testid="queue-chip" className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface px-2.5 py-0.5 font-semibold text-text-primary">
            <span className="font-normal text-text-faint tabular-nums">{index + 1}</span>
            {player.name}
          </span>
        ))}
        <span className="flex-1" />
        <div role="tablist" aria-label="Dock list" className="flex shrink-0 gap-0.5 rounded-pill bg-surface-inset p-0.5">
          {(Object.keys(LIST_LABEL) as DockList[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={list === candidate}
              onClick={() => setList(candidate)}
              className={`rounded-pill px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${list === candidate ? "bg-surface-elevated text-text-primary shadow-card" : "text-text-muted hover:text-text-primary"}`}
            >
              {LIST_LABEL[candidate]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col px-2 py-1.5 [grid-area:list]">
        {list === "pool" ? (
          <PoolList leagueId={view.leagueId} players={players} available={available} byeWeeks={byeWeeks} odds={odds} nextPickLabel={nextPickLabel} recomputing={advisor.recomputing} {...acts} />
        ) : myTeamId === null ? (
          <p className="p-2 text-sm text-text-faint">You have no seat in this draft, so there is nobody to call for.</p>
        ) : advisor.view === null ? (
          <Card as="section" aria-label="Our calls" className={`flex flex-col gap-2 ${ADVISOR_CARD_FRAME}`}>
            <p className="text-sm text-text-faint">{advisor.recomputing ? "Reading the board." : advisor.error !== null ? "We could not reach the advisor. It tries again on the next pick." : "Nothing to call right now."}</p>
          </Card>
        ) : (
          <div data-testid="our-calls" className="min-h-0 flex-1 overflow-y-auto">
            <AdvisorPanel view={advisor.view} acts={advisorActs} playersById={playersById} byeWeeks={byeWeeks} recomputing={advisor.recomputing} withLeadCard={false} />
          </div>
        )}
      </div>
      {withCall ? (
        <div className="min-h-0 min-w-0 border-l border-line [grid-area:call]">
          <DockCall
            view={view}
            myTeamId={myTeamId}
            playersById={playersById}
            advisor={advisor.view}
            recomputing={advisor.recomputing}
            queue={queue}
            byeWeeks={byeWeeks}
            nextPickLabel={nextPickLabel}
            available={available}
            canDraft={acts.canDraft}
            submitting={acts.submitting}
            queuedPlayerIds={acts.queuedPlayerIds}
            onDraft={acts.onDraft}
            onQueueToggle={acts.onQueueToggle}
          />
        </div>
      ) : null}
    </footer>
  );
});
