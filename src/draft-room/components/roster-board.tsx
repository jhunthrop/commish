"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Avatar, Badge, Card } from "@/components/ui";
import { playerName, teamsById } from "../lib/lookups";

export interface RosterBoardProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
}

interface SlotCell {
  readonly key: string;
  readonly slot: string;
  readonly playerName: string | null;
}

/** Expands the league's declared roster shape into one cell per spot, filled or not. */
function cellsFor(view: DraftStateView, teamId: string, playersById: ReadonlyMap<string, Player>): readonly SlotCell[] {
  const filled = view.rosters[teamId] ?? [];
  return view.slotConfig.flatMap((config) =>
    Array.from({ length: config.count }, (_, slotIndex): SlotCell => {
      const entry = filled.find((slot) => slot.slot === config.slot && slot.slotIndex === slotIndex);
      const playerId = entry?.playerId ?? null;
      return {
        key: `${config.slot}-${slotIndex}`,
        slot: config.slot,
        playerName: playerId === null ? null : playerName(playersById, playerId),
      };
    }),
  );
}

export function RosterBoard({ view, teams, playersById, myTeamId }: RosterBoardProps) {
  const byId = teamsById(teams);
  const ordered = view.draftOrder.map((teamId) => byId.get(teamId)).filter((team): team is TeamCard => team !== undefined);

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {ordered.map((team) => (
        <Card
          key={team.id}
          role="group"
          aria-label={team.name}
          className={team.id === myTeamId ? "border-accent" : ""}
        >
          <header className="mb-3 flex items-center gap-2">
            <Avatar name={team.ownerDisplayName} src={team.ownerAvatarUrl} size="sm" />
            <span className="font-semibold text-text-primary">{team.name}</span>
            {team.id === myTeamId ? <Badge tone="accent">Your team</Badge> : null}
          </header>
          <ul className="flex flex-col gap-1">
            {cellsFor(view, team.id, playersById).map((cell) => (
              <li key={cell.key} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="w-12 shrink-0 text-text-muted">{cell.slot}</span>
                <span className={cell.playerName === null ? "grow text-text-muted" : "grow text-text-primary"}>{cell.playerName ?? "Empty"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}
