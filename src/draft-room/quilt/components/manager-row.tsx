"use client";

import { useMemo } from "react";
import type { TeamCard } from "@/domain/league";
import { Avatar, Crest } from "@/components/ui";
import { BOARD_HEIGHTS } from "../state/heights";
import { teamCodesById } from "../lib/team-code";

/** Who a column head is, in the channel law's grammar (amber = yours, red = live). */
type HeadState = "live" | "you" | "quiet";

/** The ring around each face. Precedence keeps the channel law the clock strip states
 * ("amber is yours, red is the room's; nothing here ever flashes red at you"): YOUR head is
 * amber even while you are the one on the clock — the moment the room turns toward you is
 * exactly the moment the row must not flash red at you. */
const RING: Readonly<Record<HeadState, string>> = {
  live: "ring-live",
  you: "ring-accent shadow-verb-glow",
  quiet: "ring-line",
};

const LABEL: Readonly<Record<HeadState, string>> = {
  live: "text-live",
  you: "text-accent",
  quiet: "text-text-faint",
};

export interface ManagerRowProps {
  readonly draftOrder: readonly string[];
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly onClockTeamId: string | null;
  /** The board's OWN grid columns — the row is part of the quilt, so a lens switch or a
   *  compaction change can never move a column out from under its manager. */
  readonly columns: { readonly gridTemplateColumns: string };
  /** The height model's ladder step 1 (a squeezed stage): smaller heads, no name codes — the
   *  manager row gives ground BEFORE the active round ever has to (fix requirement 3). */
  readonly compact?: boolean;
}

/** Head diameters per density; full is the founding 26px, compact fits `managerCompact`. */
const CREST_SIZE = { full: 26, compact: 20 } as const;

/**
 * THE MANAGER ROW (founder addition 1, WarmQuilt mock): every swimlane wears its manager's
 * avatar and short team name at the column head, so who drafts next stops being a grid
 * coordinate. Ring semantics keep the channel law — the on-the-clock manager's ring is red
 * (live), YOURS is amber with the soft glow token, everyone else stays quiet. Rendered by
 * `QuiltBoard` inside the board's flex column, so it scrolls and compacts with the quilt and
 * can never overlap the clock strip.
 *
 * A manager with a stored avatar ref renders the `Avatar` primitive (preset tile or headshot);
 * one without gets the team's `Crest` monogram, clipped circular by the ring wrapper so the
 * row stays a row of faces. The full team name rides every head as an `abbr` title — the codes
 * are furniture, the name is the fact.
 */
export function ManagerRow({ draftOrder, teams, myTeamId, onClockTeamId, columns, compact = false }: ManagerRowProps) {
  const byId = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const codes = useMemo(() => teamCodesById(teams), [teams]);
  const height = compact ? BOARD_HEIGHTS.headerPx.managerCompact : BOARD_HEIGHTS.headerPx.manager;

  return (
    <div
      data-testid="manager-row"
      data-density={compact ? "compact" : "full"}
      className="grid shrink-0 gap-1.5 overflow-hidden"
      style={{ ...columns, height }}
    >
      <div />
      {draftOrder.map((teamId) => {
        const team = byId.get(teamId) ?? null;
        const state: HeadState = teamId === myTeamId ? "you" : teamId === onClockTeamId ? "live" : "quiet";
        return (
          <div key={teamId} data-testid="manager-head" data-state={state} className="flex min-w-0 flex-col items-center justify-center gap-0.5">
            <span aria-hidden="true" className={`inline-flex shrink-0 overflow-hidden rounded-pill ring-2 ${RING[state]}`}>
              {team === null || team.ownerAvatarUrl === null ? (
                <Crest id={teamId} name={team?.name ?? teamId} size={compact ? CREST_SIZE.compact : CREST_SIZE.full} />
              ) : (
                <Avatar name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="sm" />
              )}
            </span>
            {/* Compact drops the code line — the ring's channel color still says who is who,
                and the full team name survives on the head itself. */}
            {compact ? (
              <span className="sr-only">{team?.name ?? teamId}</span>
            ) : (
              <abbr title={team?.name ?? teamId} className={`max-w-full truncate font-display text-xs font-bold tracking-wide no-underline ${teamId === myTeamId ? LABEL.you : LABEL[state]}`}>
                {teamId === myTeamId ? "YOU" : (codes.get(teamId) ?? "")}
              </abbr>
            )}
          </div>
        );
      })}
    </div>
  );
}
