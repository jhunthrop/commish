import Link from "next/link";
import type { LeagueHomeBody, LineupBody } from "../contract";
import { PageTitle } from "@/components/ui";
import { LeagueChat } from "@/chat-room/components/league-chat";
import type { HelpLevel } from "@/identity/preferences";
import { formatWeek } from "../lib/format";
import { AdvisorPanel } from "./advisor-panel";
import { DraftSchedulePanel } from "./draft-schedule-panel";
import { InvitePanel } from "./invite-panel";
import { LeagueMembersPanel } from "./league-members-panel";
import { LeagueTermsPanel } from "./league-terms-panel";
import { LineupEditor } from "./lineup-editor";
import { MatchupCelebration } from "./matchup-celebration";
import { MatchupScoreboard } from "./matchup-scoreboard";
import { ModerationSummary } from "./moderation-summary";
import { SlotPreferencePanel } from "./slot-preference-panel";
import { StandingsTable } from "./standings-table";
import { TradeInboxLink } from "./trade-inbox-link";
import { WaitingRoom } from "./waiting-room";

/**
 * The league's home screen. Deliberately NOT a client component: it composes, it does not
 * fetch, and every value it renders (`currentWeek`, `myMatchup`, `standings`, `clinched`,
 * `locked`) arrives already computed by `src/league/**` on the server. Keeping the
 * composition here rather than inside `page.tsx` is what makes it testable.
 */
export function LeagueHome({
  home,
  lineup,
  helpLevel,
}: {
  readonly home: LeagueHomeBody;
  readonly lineup: LineupBody | null;
  /** Forwarded from `LeaguePage`. Omitted only by tests that don't care about this branch —
   *  `InfoTip` itself defaults to the click-only, non-inline behavior when it's absent. */
  readonly helpLevel?: HelpLevel;
}) {
  const clinched = home.standings.some((row) => row.teamId === home.myTeamId && row.clinched);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <PageTitle>{home.name}</PageTitle>
        <p className="text-sm text-text-muted">
          {`${home.teams.length} of ${home.teamCount} managers · ${home.format === "auction" ? "Auction" : "Snake"} draft`}
        </p>
      </header>

      <MatchupCelebration matchup={home.myMatchup} myTeamId={home.myTeamId} clinched={clinched} />

      {/* Task 6: the button that has existed since Phase 1 and nobody could ever press on
          purpose. `home.draftSchedule` rides THIS render — the same props-in idiom every other
          panel below uses — and the panel reaches `fetchJson` only for its own writes (a
          reschedule or a start), never to read its initial state. Renders for every draft
          state, including `complete` — unlike the static card this replaced, which rendered
          nothing once a league had drafted.

          Task 8: `WaitingRoom` renders instead for a `'when_full'` draft — the two never render
          at once, keyed on `home.draftSchedule.startTrigger`. `DraftSchedulePanel` keeps the
          `'scheduled'`-trigger case exactly as it was. */}
      {home.draftSchedule === null ? null : home.draftSchedule.startTrigger === "when_full" ? (
        <WaitingRoom league={{ ...home.draftSchedule, teamCount: home.teamCount }} isCommissioner={home.isCommissioner} />
      ) : (
        <DraftSchedulePanel leagueId={home.leagueId} isCommissioner={home.isCommissioner} initialSchedule={home.draftSchedule} />
      )}

      {/* Task 6: NFFC's Kentucky Derby System. `null` only for a caller with no team here (a
          commissioner without one of their own) — a ranking is scoped to a team, so there is
          nothing for the panel to show them. */}
      {home.draftSchedule === null || home.draftSchedule.slotPreference === null ? null : (
        <SlotPreferencePanel leagueId={home.leagueId} initialPreference={home.draftSchedule.slotPreference} helpLevel={helpLevel} />
      )}

      <section className="flex flex-col gap-2" aria-label={`${formatWeek(home.currentWeek)} matchup`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-text-primary">{formatWeek(home.currentWeek)}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Link className="text-sm text-accent underline" href={`/app/leagues/${home.leagueId}/matchups/${home.currentWeek}`}>
              All matchups
            </Link>
            {/* Task 10: the member-visible history this league's own home page had no way to
                reach before — reachable from where a member already is, not by typing a url. */}
            <Link className="text-sm text-accent underline" href={`/app/leagues/${home.leagueId}/activity`}>
              League activity
            </Link>
            {/* Task 8: trading requires a team of the caller's own, same as `/trades` itself
                (`TradesPage`'s own `myTeamId === null` 404) — a viewer with no team here would
                open a link the page immediately refuses. */}
            {home.myTeamId === null ? null : <TradeInboxLink leagueId={home.leagueId} />}
          </div>
        </div>
        {home.myMatchup === null ? (
          <p className="text-text-muted">You have no matchup this week.</p>
        ) : (
          <MatchupScoreboard matchup={home.myMatchup} myTeamId={home.myTeamId} />
        )}
        {/* Same visibility the retired "Score Week" button had: the commissioner's control is
            gone, and this is what replaced it — an explanation of why, not a silent absence. */}
        {home.isCommissioner ? (
          <p className="text-sm text-text-muted">
            {"Scores update automatically as games finish. There's nothing to run by hand."}
          </p>
        ) : null}
      </section>

      <StandingsTable rows={home.standings} myTeamId={home.myTeamId} helpLevel={helpLevel} medianGame={home.medianGame} />

      {/*
        Unlike the draft room's `aside` band, this section sits in ordinary document flow, so
        `LeagueChat`'s own `h-full min-h-0` chain has nothing bounded to fill and would grow to
        fit every held message. A fixed height from the spacing scale is all the inner
        `min-h-0`/`flex-1` chain needs to scroll inside itself instead (L2, final review).
      */}
      <div className="h-96">
        <LeagueChat leagueId={home.leagueId} />
      </div>

      {lineup === null ? null : (
        <LineupEditor leagueId={home.leagueId} lineup={lineup} totalWeeks={home.totalWeeks} helpLevel={helpLevel} />
      )}

      {home.myTeamId === null ? null : <AdvisorPanel leagueId={home.leagueId} weekNumber={home.currentWeek} />}

      {/*
        The terms panel, the members panel and the invite panel sit here, in that order, as
        siblings in ordinary document flow rather than inside a layout that claims the space
        between them: "how this league works" (Task 8, the SAME `LeagueTermsPanel` the invite
        preview renders, fed by `home.terms` rather than a second fetch), the commissioner's
        "who is missing" question (the members panel), and their "invite someone" answer (the
        panel below) read together without any one of them owning the section. Every member sees
        the terms panel — it is not gated on `isCommissioner` — because the terms are what
        everybody in the league is playing under, not a commissioner-only fact.

        `titleAs="p"`: this page's own `PageTitle` above already renders `home.name` (the same
        string as `home.terms.name`) as its `h1`. Left at the panel's default `h2`, that is a
        second heading with the identical accessible name — a real e2e regression Task 9 caught
        (`league-lifecycle.spec.ts`, strict-mode ambiguity on `getByRole("heading", { name })`),
        not just a cosmetic one: a screen reader's headings list would carry the league's name
        twice for one fact. See `LeagueTermsPanel`'s own docblock.
      */}
      <LeagueTermsPanel terms={home.terms} helpLevel={helpLevel} titleAs="p" />

      <LeagueMembersPanel teams={home.teams} teamCount={home.teamCount} commissionerUserId={home.commissionerUserId} myTeamId={home.myTeamId} />

      {/* `id="invite-managers"`: `WaitingRoom`'s own "Invite someone" link (Task 8, a `when_full`
          league's filling state) points here — the one real invite surface a commissioner has. */}
      {home.isCommissioner ? (
        <div id="invite-managers">
          <InvitePanel leagueId={home.leagueId} />
        </div>
      ) : null}

      {/* Task 8: the commissioner's own window onto platform moderation in their league — a
          member with extra buttons, not an operator, so this sits behind the identical
          `isCommissioner` gate `InvitePanel` already does, right beside it. */}
      {home.isCommissioner ? <ModerationSummary leagueId={home.leagueId} /> : null}
    </main>
  );
}
