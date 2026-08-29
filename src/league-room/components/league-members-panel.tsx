import type { LeagueMemberCard } from "../contract";
import { Avatar, Badge, Button, EmptyState, SeatMeter } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import type { LeagueAuthority } from "@/league-service/authority";
import { TIER_COMPOSITION_LABEL, type CompositionCategory } from "@/participation/composition";

export interface LeagueMembersPanelProps {
  readonly teams: readonly LeagueMemberCard[];
  /** Who runs this league — a named member, compared against each member's `ownerUserId` to
   *  mark the one row that runs the league, or the platform for a house league, which marks no
   *  row at all and renders the "Run by Commish" line above the roster instead. */
  readonly authority: LeagueAuthority;
  readonly myTeamId: string | null;
  /** The league's total seat count. Omit to hide the `SeatMeter` line entirely (e.g. a context
   *  that already states it elsewhere) rather than render a claim about seats that count omits. */
  readonly teamCount?: number;
  /**
   * Phase 3.6, Task 9: the SAME coarse composition line `RoomRoster` shows (ruling 19) — beside
   * `SeatMeter`, never a per-manager history tag. Omit to say nothing about it, the same
   * "count omits" reasoning `teamCount` already follows.
   */
  readonly compositionCategory?: CompositionCategory;
}

/**
 * The surface Step 15's audit found missing entirely: a league had no members list, so nobody
 * in it could see who else was in it or who ran it. The commissioner is named as a fact about
 * the league here, not implied by which controls a viewer happens to see — every member is
 * entitled to know who runs the league they are in (Phase 1's public-browse exclusion is a
 * different, narrower rule: it never reaches inside a league at all).
 *
 * An unfilled seat renders as an open seat, not as a missing person: those read as different
 * facts to a commissioner deciding whether to send another invite, and only one of them is
 * cause for concern. `SeatMeter` (Phase 3.6, Task 3, F17) owns that sentence now — this panel
 * no longer composes one of its own.
 *
 * Phase 3.5 addendum, Task 12, Step 5: a house league's `authority.kind === "house"` matches no
 * team's `ownerUserId` — no row would ever earn the "Commissioner" badge, which is correct but
 * silent. The line above the roster states the fact instead of leaving it to be inferred from
 * an absence.
 */
export function LeagueMembersPanel({ teams, authority, myTeamId, teamCount, compositionCategory }: LeagueMembersPanelProps) {
  return (
    <section className="flex flex-col gap-2" aria-label="League members">
      <h2 className="text-sm font-medium text-text-muted">Managers</h2>
      {authority.kind === "house" ? (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <Icon name="shield" size={16} />
          {/* NO TIPS (founder ruling, 2026-08-28): the "house league" definition was a click
              away behind a trigger. What it said is what these six words now say. */}
          Run by Commish, not by a manager playing in it
        </p>
      ) : null}
      {teams.length === 0 ? (
        <EmptyState
          title="Nobody is here yet"
          description="Nobody has taken a seat yet."
          icon="users"
          action={<Button disabled>Waiting for managers to join</Button>}
        />
      ) : (
        // LAW 4, DENSITY IS RESPECT, AND RULE 4's AMENDED TEST DECIDES THE FORM. Twelve managers
        // are a thing you READ DOWN A COLUMN — you are scanning for one name, or counting who is
        // missing — not twelve things you act on, so they are rows under hairlines rather than
        // twelve separate bordered, gapped cards. That is the amendment applied as written ("a
        // thing you read down a column stays a row"), and it takes this block from twelve boxes
        // to one, at roughly two thirds of the height, with the same twelve facts on it. The
        // two-column split (owner over team name) collapses to one line at `sm` and up for the
        // same reason: they are two short facts about one person, not a stacked pairing.
        <ul aria-label="Managers" className="flex flex-col rounded-lg border border-line bg-surface-elevated">
          {teams.map((team) => (
            <li
              key={team.id}
              className="flex items-center gap-3 border-b border-line px-3 py-1.5 last:border-b-0"
            >
              <Avatar name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                <span className="truncate text-sm font-medium text-text-primary">{team.ownerDisplayName}</span>
                <span className="truncate text-sm text-text-muted">{team.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {authority.kind === "member" && team.ownerUserId === authority.userId ? <Badge tone="accent">Commissioner</Badge> : null}
                {team.id === myTeamId ? <Badge tone="neutral">You</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {teamCount === undefined ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SeatMeter filled={teams.length} total={teamCount} />
          {compositionCategory === undefined ? null : <Badge tone="neutral">{TIER_COMPOSITION_LABEL[compositionCategory]}</Badge>}
        </div>
      )}
    </section>
  );
}
