import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league";
import { RoomShell } from "@/league-room/components/room-shell";
import type { DrawerSurface } from "@/league-room/lib/drawer-state";
import { loadRoomData } from "./room-data";

export interface RoomPageProps {
  /** Which drawer surface this route opens at full height — null for the room itself. */
  readonly surface: DrawerSurface | null;
  readonly leagueId: string;
  /** Caller-forgeable and decorative only (the waiting room's just-seated copy). */
  readonly holdExpired?: boolean;
  /** The activity feed's parsed `?before` cursor — only the activity route passes one. */
  readonly activityBefore?: number;
}

/**
 * THE ONE ROOM, FIVE ROUTES (law 2): the league home and the four full-height drawer surfaces
 * render the identical shell over the identical data — the route only decides which surface
 * starts expanded. Membership keeps the non-oracle 404 every league page has always had, and a
 * surface route on an undrafted league redirects home, where the room IS the waiting room.
 */
export async function RoomPage({ surface, leagueId, holdExpired = false, activityBefore }: RoomPageProps) {
  const user = await requireCurrentUser();
  const data = await loadRoomData(user, leagueId, {
    activityBefore,
    includeNotices: surface === "activity",
  });
  if (data === null) notFound();
  if (surface !== null && data.home.draftStatus !== "complete") redirect(`/app/leagues/${leagueId}`);

  return (
    <RoomShell
      data={data}
      initialSurface={surface}
      playoffTeams={LEAGUE_CONFIG.playoffTeams}
      regularSeasonWeeks={LEAGUE_CONFIG.regularSeasonWeeks}
      holdExpired={holdExpired}
    />
  );
}
