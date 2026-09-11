"use client";

import { useMemo } from "react";
import type { TeamCard } from "@/domain/league";
import { Avatar, Crest } from "@/components/ui";
import { BOARD_HEIGHTS } from "../state/heights";
import { teamCodesById } from "../lib/team-code";

/** Who a column head is, in Sideline's chroma: amber is yours, live green is the clock. */
type HeadState = "live" | "you" | "quiet";

/** The ring around each face. YOUR head is amber even while you are the one on the clock: the
 *  moment the room turns toward you is exactly the moment the row must not go live green at you. */
const RING: Readonly<Record<HeadState, string>> = {
  live: "ring-live",
  you: "ring-self",
  quiet: "ring-line",
};

const LABEL: Readonly<Record<HeadState, string>> = {
  live: "text-live",
  you: "text-self-ink",
  quiet: "text-text-faint",
};

export interface ManagerRowProps {
  readonly draftOrder: readonly string[];
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly onClockTeamId: string | null;
  /** The board's OWN grid columns, so a compaction change can never move a column out from
   *  under its manager. */
  readonly columns: { readonly gridTemplateColumns: string };
  /** The height model's ladder step 1 (a squeezed stage): smaller heads, no name codes. */
  readonly compact?: boolean;
  /** A head is a button: it opens that team's roster as a sheet (rulings 2026-09-10). */
  readonly onOpenRoster: (teamId: string) => void;
  readonly openRosterTeamId: string | null;
}

/** Head diameters per density; full is the founding 26px, compact fits `managerCompact`. */
const CREST_SIZE = { full: 26, compact: 20 } as const;

/**
 * THE MANAGER ROW: every swimlane wears its manager's face and short team name at the column
 * head, so who drafts next stops being a grid coordinate (P1). The on-the-clock manager's ring
 * is live green, yours is amber, everyone else stays quiet. Each head is the way to that team's
 * roster (the old drawer's Roster tab, retired): press a face, get the sheet.
 */
export function ManagerRow({ draftOrder, teams, myTeamId, onClockTeamId, columns, compact = false, onOpenRoster, openRosterTeamId }: ManagerRowProps) {
  const byId = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const codes = useMemo(() => teamCodesById(teams), [teams]);
  const height = compact ? BOARD_HEIGHTS.headerPx.managerCompact : BOARD_HEIGHTS.headerPx.manager;

  return (
    <div data-testid="manager-row" data-density={compact ? "compact" : "full"} className="grid shrink-0 gap-1.5 overflow-hidden" style={{ ...columns, height }}>
      <div />
      {draftOrder.map((teamId) => {
        const team = byId.get(teamId) ?? null;
        const state: HeadState = teamId === myTeamId ? "you" : teamId === onClockTeamId ? "live" : "quiet";
        const name = team?.name ?? teamId;
        const owner = team?.ownerDisplayName ?? name;
        return (
          <button
            key={teamId}
            type="button"
            data-testid="manager-head"
            data-state={state}
            aria-pressed={openRosterTeamId === teamId}
            aria-label={`${name}, ${teamId === myTeamId ? "you" : owner}. Open the roster.`}
            title={name}
            onClick={() => onOpenRoster(teamId)}
            className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true" className={`inline-flex shrink-0 overflow-hidden rounded-pill ring-2 ${RING[state]}`}>
              {team === null || team.ownerAvatarUrl === null ? (
                <Crest id={teamId} name={name} size={compact ? CREST_SIZE.compact : CREST_SIZE.full} />
              ) : (
                <Avatar name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="sm" />
              )}
            </span>
            {compact ? null : (
              <span aria-hidden="true" className={`max-w-full truncate font-display text-xs font-bold ${LABEL[state]}`}>
                {teamId === myTeamId ? "You" : (codes.get(teamId) ?? "")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
