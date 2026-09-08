"use client";

import type { Player } from "@/domain/player";
import { SegmentGroup } from "@/components/ui";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "../config";
import { isPickCount, usePickCount } from "../pick-count";
import type { AdvisorActs } from "./advisor-acts";
import { CandidateRows } from "./candidate-rows";
import { NextPickCard } from "./next-pick-card";
import { SignalsStrip } from "./signals-strip";

export interface AdvisorPanelProps {
  readonly view: AdvisorView;
  readonly acts: AdvisorActs;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly recomputing: boolean;
}

const PICK_COUNT_OPTIONS = ADVISOR_ROOM_CONFIG.pickCount.options.map((count) => ({ value: String(count), label: String(count) }));

/**
 * THE ADVISOR PANEL, the one composition the room's tab and the Draft HQ demo both render: the
 * strip (nothing when the room has nothing to report), the lead card with its verb, then the
 * pick-count selector ("Show 3 / 5 / 10", remembered per browser) over the rest of the
 * shortlist as compact rows. The selector counts the card as the first pick, so "Show 5" is
 * the card and four rows, and the widest setting is exactly the depth the server already sent.
 */
export function AdvisorPanel({ view, acts, playersById, byeWeeks, recomputing }: AdvisorPanelProps) {
  const [count, setCount] = usePickCount();
  const player = view.pick === null ? null : (playersById.get(view.pick.playerId) ?? null);
  return (
    <div data-testid="advisor-panel" className="flex flex-col gap-2">
      <SignalsStrip signals={view.signals} />
      <NextPickCard view={view} acts={acts} player={player} byeWeek={player === null ? null : (byeWeeks.get(player.nflTeam) ?? null)} recomputing={recomputing} />
      {view.candidates.length > 1 ? (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-text-muted">Show</span>
            <SegmentGroup
              label="Show"
              labelled={false}
              size="sm"
              options={PICK_COUNT_OPTIONS}
              value={String(count)}
              onChange={(value) => {
                const next = Number(value);
                if (isPickCount(next)) setCount(next);
              }}
            />
          </div>
          <CandidateRows view={view} acts={acts} playersById={playersById} byeWeeks={byeWeeks} count={count} />
        </>
      ) : null}
    </div>
  );
}
