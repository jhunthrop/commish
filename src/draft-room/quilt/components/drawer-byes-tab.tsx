"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import { Button } from "@/components/ui";
import { formatAdp } from "../../lib/tiers";
import { DrawerRow } from "./drawer-row";
import type { RoomActs } from "./room-acts";

export interface DrawerByesTabProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onPeek"> {
  /** Server-ranked, best first. */
  readonly players: readonly Player[];
  readonly available: ReadonlySet<string>;
  readonly byeWeeks: ReadonlyMap<string, number>;
}

/**
 * THE BYES TAB — the pool regrouped by the week a player disappears, earliest bye first, each
 * band in board order. A player whose team the schedule cannot claim a bye for sits under "No
 * bye on record" at the end rather than being invented into a week (law 7).
 */
export function DrawerByesTab({ players, available, byeWeeks, canDraft, submitting, onDraft, onPeek }: DrawerByesTabProps) {
  const bands = useMemo(() => {
    const byWeek = new Map<number | null, Player[]>();
    for (const player of players) {
      if (!available.has(player.id)) continue;
      const week = byeWeeks.get(player.nflTeam) ?? null;
      byWeek.set(week, [...(byWeek.get(week) ?? []), player]);
    }
    const weeks = [...byWeek.keys()].sort((a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY));
    return weeks.map((week) => ({ week, players: byWeek.get(week) ?? [] }));
  }, [players, available, byeWeeks]);

  if (bands.length === 0) {
    return <p className="text-sm text-text-faint">Nobody left to group. The pool is drafted out.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {bands.map((band) => (
        <section key={band.week ?? "none"} aria-label={band.week === null ? "No bye on record" : `Bye week ${band.week}`} className="flex flex-col gap-1">
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-faint">
            {band.week === null ? "No bye on record" : `Bye ${band.week}`}
            <span className="ml-2 tabular-nums">{band.players.length}</span>
          </h3>
          <ol className="flex flex-col gap-1">
            {band.players.map((player) => {
              const adp = formatAdp(player.adp);
              return (
                <DrawerRow
                  key={player.id}
                  player={player}
                  onPeek={onPeek}
                  meta={
                    <>
                      {player.nflTeam}
                      {adp === null ? "" : ` · ${adp}`}
                    </>
                  }
                  actions={
                    canDraft ? (
                      <Button size="sm" variant="verb" disabled={submitting} onClick={() => onDraft(player.id)}>
                        Draft
                      </Button>
                    ) : null
                  }
                />
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
