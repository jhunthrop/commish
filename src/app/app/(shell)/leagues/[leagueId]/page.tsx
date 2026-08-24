import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { leagueHome, lineupView } from "@/league-service";
import { LeagueHome } from "@/league-room/components/league-home";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
  /**
   * Task 6's binding carry, read here and forwarded as a plain boolean: `?holdExpired=1` is
   * CALLER-FORGEABLE (a visitor can type it into any league url they can already open) and
   * decorative only — `WaitingRoom` (Task 9 Step 2b) may soften the just-seated moment's copy
   * with it, and decides nothing about capacity, identity or state from it. `home.justSeated`
   * itself is computed server-side, from this render's own `leagueHome` read, never from this
   * param.
   */
  readonly searchParams: Promise<{ readonly holdExpired?: string }>;
}

/**
 * A Server Component reading through the service layer directly — idiomatic Next.js, and
 * outside the client-boundary rule (which covers `src/league-room/**`, browser code by
 * construction). Membership is enforced by the API for everything interactive on the page;
 * a non-member who guesses a league id sees a 404 rather than another league's standings.
 *
 * Reads preferences server-side (`readPreferences`, the same seed-on-first-read call the draft
 * room page makes) and forwards `helpLevel` into `LeagueHome`, so a `guided` caller's
 * `InfoTip`s (the standings Record column, the lineup lock warning, the Bench heading, and now
 * the terms panel's format/scoring definitions — Task 8) open inline from this page's very
 * first render.
 *
 * `leagueHome` (`@/league-service`) is also where the terms panel's data comes from: `home.terms`
 * rides the same read this page already made, so every member sees the league's format, scoring
 * and commissioner without this page issuing a second request for them.
 *
 * Task 8: the commissioner's own window onto platform moderation in their league
 * (`ModerationSummary`, `@/league-room/components/moderation-summary`) rides `LeagueHome`'s
 * existing `home.leagueId`/`home.isCommissioner` — this page hands down no new prop for it, the
 * same "own data layer" shape `TradeInboxLink` (Task 8 of Plan C) already established, so
 * `leagueHome`'s own query budget is unchanged by a surface most of a league's members never see.
 *
 * Phase 3.5, Task 8: `WaitingRoom` (a `when_full` draft's own surface) rides `home.draftSchedule`
 * and `home.teamCount` — both already part of this render — the same way `DraftSchedulePanel`
 * always has; `LeagueHome` is where the two are told apart, not this page.
 *
 * Renders no `TopBar` of its own (Task 2 Step 5) — `(shell)/layout.tsx` renders `AppShell`,
 * which supplies it once for every page in this route group.
 */
export default async function LeaguePage({ params, searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;
  const { holdExpired } = await searchParams;

  const [home, preferences] = await Promise.all([leagueHome(getDb(), leagueId, user.id), readPreferences(getDb(), user)]);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();

  const lineup =
    home.myTeamId === null
      ? null
      : await lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek });

  return <LeagueHome home={home} lineup={lineup} helpLevel={preferences.helpLevel} holdExpired={holdExpired === "1"} />;
}
