import type { LeagueMemberCard } from "../contract";
import { Avatar, Badge, Button, EmptyState } from "@/components/ui";

export interface LeagueMembersPanelProps {
  readonly teams: readonly LeagueMemberCard[];
  /** The league's commissioner, by raw user id — compared against each member's
   *  `ownerUserId` to mark the one row that runs the league. */
  readonly commissionerUserId: string;
  readonly myTeamId: string | null;
  /** The league's total seat count. Omit to hide the open-seats line entirely (e.g. a context
   *  that already states it elsewhere) rather than render "0 seats still open" as a fact. */
  readonly teamCount?: number;
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
 * cause for concern.
 */
export function LeagueMembersPanel({ teams, commissionerUserId, myTeamId, teamCount }: LeagueMembersPanelProps) {
  const openSeats = teamCount === undefined ? 0 : Math.max(0, teamCount - teams.length);

  return (
    <section className="flex flex-col gap-2" aria-label="League members">
      <h2 className="text-sm font-medium text-text-muted">Managers</h2>
      {teams.length === 0 ? (
        <EmptyState
          title="Nobody's here yet"
          description="Once managers join this league, they'll show up here — commissioner included."
          icon="users"
          action={<Button disabled>Waiting for managers to join</Button>}
        />
      ) : (
        <ul aria-label="Managers" className="flex flex-col gap-2">
          {teams.map((team) => (
            <li
              key={team.id}
              className="flex items-center gap-3 rounded-md border border-border bg-surface-elevated p-2"
            >
              <Avatar name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-text-primary">{team.ownerDisplayName}</span>
                <span className="truncate text-sm text-text-muted">{team.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {team.ownerUserId === commissionerUserId ? <Badge tone="accent">Commissioner</Badge> : null}
                {team.id === myTeamId ? <Badge tone="neutral">You</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {openSeats === 0 ? null : (
        <p className="text-sm text-text-muted">{`${openSeats} seat${openSeats === 1 ? "" : "s"} still open`}</p>
      )}
    </section>
  );
}
