import Link from "next/link";
import { Avatar, Badge } from "@/components/ui";
import { TIER_COMPOSITION_LABEL, type CompositionCategory } from "@/participation/composition";
import type { LeagueMemberCard } from "../contract";

export interface RoomRosterProps {
  readonly leagueId: string;
  readonly teams: readonly LeagueMemberCard[];
  readonly teamCount: number;
  readonly myTeamId: string | null;
  /**
   * The room's coarse composition (ruling 19) — the SAME three-bucket reduction a stranger reads
   * on a browse card, never the raw newcomer/veteran counts a per-manager tag would disclose.
   */
  readonly compositionCategory: CompositionCategory;
  /** Gates the share link, the same "member league only" rule `WaitingRoom`'s own filling state
   *  already applies (ruling 33 — nobody holds an invite code to a room the platform runs). */
  readonly canInvite: boolean;
}

/**
 * The room, without the tags (Phase 3.6, Task 9, Step 3). Lists every seated manager beside every
 * open seat, and carries the league's own coarse composition line where a per-manager history tag
 * ("3rd season", "verified reviewer") would otherwise go — those would disclose exactly the
 * per-member participation tier `compositionCategory`'s server-side reduction exists to hide, and
 * re-opening that decision inside a design phase would be the privacy equivalent of a page-local
 * visual mapping (ruling 19). The gauntlet's "the YOU row has no tag" finding is answered by
 * nobody having one — not even the composition line singles a row out, it describes the room as
 * a whole.
 *
 * An unfilled seat renders as an open seat, not a missing person — `LeagueMembersPanel`'s own
 * reasoning, restated here at the room's own, more compact grain.
 */
export function RoomRoster({ leagueId, teams, teamCount, myTeamId, compositionCategory, canInvite }: RoomRosterProps) {
  const openSeats = Math.max(0, teamCount - teams.length);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface-elevated p-4" aria-label="The room">
      {/* Gauntlet fix wave, NEW-9: `SeatMeter` used to render here too — `WaitingRoom`'s own hero,
          immediately above this panel, already owns the "N of 12 seated" sentence (F17); a second
          meter within 200px said the same fact twice. `Badge` alone stays: composition is a fact
          about the room this panel is the only place that names. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge tone="neutral">{TIER_COMPOSITION_LABEL[compositionCategory]}</Badge>
      </div>
      <ul aria-label="Seated managers" className="flex flex-wrap gap-3">
        {teams.map((team) => (
          <li key={team.id} className="flex min-w-0 items-center gap-2">
            <Avatar name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="sm" />
            <span className="truncate text-sm text-text-primary">{team.ownerDisplayName}</span>
            {team.id === myTeamId ? <Badge tone="neutral">You</Badge> : null}
          </li>
        ))}
        {Array.from({ length: openSeats }, (_, index) => (
          <li key={`open-${index}`} className="flex items-center gap-2 rounded-pill border border-dashed border-line px-2 py-1">
            <span className="text-sm text-text-muted">Open seat</span>
          </li>
        ))}
      </ul>
      {canInvite ? (
        <Link href={`/app/leagues/${leagueId}#invite-managers`} className="text-sm font-medium text-accent underline">
          Invite someone
        </Link>
      ) : null}
    </section>
  );
}
