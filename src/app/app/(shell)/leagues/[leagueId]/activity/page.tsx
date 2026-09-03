import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { RoomPage } from "../room-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("League activity");

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;

/** A `before` cursor is a raw `sequence` from a previous page's `nextBefore` — an untrusted
 *  query param, so a value that isn't a positive integer is treated as "no cursor" (the newest
 *  page) rather than passed through to the query. */
function parseBefore(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** The activity surface at full height — the drawer IS this route (law 2). This route alone
 *  carries the viewer's own platform-notice band and the feed's cursor pagination. */
export default async function ActivityPage({ params, searchParams }: PageProps) {
  const { leagueId } = await params;
  const query = await searchParams;
  return <RoomPage surface="activity" leagueId={leagueId} activityBefore={parseBefore(first(query.before))} />;
}
