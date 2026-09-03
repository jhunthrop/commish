import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { RoomPage } from "./room-page";

export const dynamic = "force-dynamic";
// Honest static title — the real one (the league's own name) rides the week strip's <h1>.
export const metadata: Metadata = pageTitle("League room");

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
  /** `?holdExpired=1` is CALLER-FORGEABLE and decorative only — the waiting room may soften
   *  the just-seated copy with it, and decides nothing about capacity, identity or state. */
  readonly searchParams: Promise<{ readonly holdExpired?: string }>;
}

/** The league home: the room itself, drawer collapsed to the chip row. */
export default async function LeaguePage({ params, searchParams }: PageProps) {
  const { leagueId } = await params;
  const { holdExpired } = await searchParams;
  return <RoomPage surface={null} leagueId={leagueId} holdExpired={holdExpired === "1"} />;
}
