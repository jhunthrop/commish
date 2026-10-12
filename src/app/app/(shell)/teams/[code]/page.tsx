import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@research/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { NFL_TEAM_NAMES } from "@research/domain/nfl-team-names";
import { TeamPageView } from "@/teams/components/team-page-view";
import { resolveTeamRoute, teamPagePath } from "@/teams/route";
import { teamPage } from "@/teams/service";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/** The club's own name in the tab when the code is real, the honest generic title otherwise. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const route = resolveTeamRoute((await params).code);
  const names = route.kind === "unknown" ? undefined : NFL_TEAM_NAMES[route.code];
  return pageTitle(names === undefined ? "Team" : `${names.city} ${names.nickname}`);
}

/**
 * THE TEAM ANALYSIS PAGE (site search round, 2026-09-08, the founder's scope addition): one
 * canonical URL per club in the product's own spelling, the other spelling redirected
 * (`resolveTeamRoute`), an unknown code a 404. Signed-in like every page under this shell, and
 * league-free: the data is the club's, not any league's, and the roster's links choose the
 * reader's league on the client (`usePlayerPageHref`). Every read is `teamPage`'s one memoized
 * read.
 */
export default async function TeamPage({ params }: PageProps) {
  await requireCurrentUser();
  const route = resolveTeamRoute((await params).code);
  if (route.kind === "unknown") notFound();
  if (route.kind === "redirect") redirect(teamPagePath(route.code));

  const data = await teamPage(getDb(), route.code);
  if (data === null) notFound();

  return <TeamPageView data={data} />;
}
