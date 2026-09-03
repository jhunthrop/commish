import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { RoomPage } from "../room-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Players");

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/** The players surface at full height — the drawer IS this route (law 2). */
export default async function PlayersPage({ params }: PageProps) {
  const { leagueId } = await params;
  return <RoomPage surface="players" leagueId={leagueId} />;
}
