import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { LEAGUE_CONFIG, nextAction } from "@/league";
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

  return (
    <LeagueHome
      home={home}
      lineup={lineup}
      helpLevel={preferences.helpLevel}
      holdExpired={holdExpired === "1"}
      nextActionKind={leagueNextActionKind(home, lineup)?.kind ?? null}
      playoffTeams={LEAGUE_CONFIG.playoffTeams}
    />
  );
}

/**
 * F16 (Task 11 Step 4): the same `nextAction` a cross-league card already computes, called here
 * because it is a pure, value-import-only function (`@/league`, exempt for `src/app/**` but not
 * for `src/league-room/**`) and `LeagueHome` may not call it itself. `lineupSet`'s input is an
 * approximation, stated plainly: `crossLeagueHome`'s own `lineupSet` reads a real
 * `notExists(lineup_slots WHERE teamId AND weekNumber)` query this single-league read does not
 * run (Task 11 adds no data, no new query — `read.ts`'s pinned `BASELINE_LEAGUE_HOME_QUERIES`
 * stays 12), so this reads the SAME signal `LineupBody` already carries instead: every starter
 * slot filled. The two can disagree only when a lineup_slots row exists but happens to leave a
 * slot empty on purpose — a real state, and one `fix-lineup`'s own copy ("your lineup is
 * genuinely unset") describes just as honestly as the DB-precise version would. Every other
 * `nextAction` branch (a live draft, an unfilled league, a scheduled draft, the week's own
 * in-progress/final state) is unaffected by this approximation — only the fix-lineup/set-lineup
 * boundary can move, and both already render the identical `LineupEditor`, just in a different
 * position on the page.
 *
 * The one cross-surface consequence (P11 review): `HomeLeagueCard` computes the SAME fact from
 * `crossLeagueHome`'s DB-exact read, so in the divergence window (a materialized auto-set row
 * with a genuinely empty starter slot) the home board and this page can briefly disagree about
 * the same lineup. Bounded and self-correcting — it resolves the moment the manager next saves —
 * but it is two surfaces, not one, and closing it means giving this page the DB-exact read.
 */
function leagueNextActionKind(home: Awaited<ReturnType<typeof leagueHome>>, lineup: Awaited<ReturnType<typeof lineupView>>) {
  if (home === null) return null;
  const lineupSet = lineup === null || lineup.starters.every((slot) => slot.playerId !== null);
  return nextAction({
    isCommissioner: home.isCommissioner,
    filledTeams: home.teams.length,
    teamCount: home.teamCount,
    myTeamId: home.myTeamId,
    draftStatus: home.draftStatus,
    weekStatus: home.weekStatus,
    lineupSet,
  });
}
