import Link from "next/link";
import type { LeagueHomeBody, LineupBody, MatchupSummary } from "../contract";
import { ButtonLink, Card, Crest, EYEBROW, LowerThird, Movement, PageTitle, PlayerFace, PositionBadge } from "@/components/ui";
import { LeagueChat } from "@/chat-room/components/league-chat";
import { LeagueTabs, type LeagueTab } from "./league-tabs";
import type { HelpLevel } from "@/identity/preferences";
import type { NextActionKind } from "@/league";
import type { LeagueAct } from "@/lib/leagues/next-act";
import { formatRecord, formatWeek } from "../lib/format";
import { playerOf } from "../lib/player";
import { AdvisorPanel } from "./advisor-panel";
import { InvitePanel } from "./invite-panel";
import { LeagueMembersPanel } from "./league-members-panel";
import { LeagueTermsPanel } from "./league-terms-panel";
import { FreeAgentsBoard, type RosterPlayerRow } from "./free-agents-board";
import { LineupEditor } from "./lineup-editor";
import { MatchupCelebration } from "./matchup-celebration";
import { MatchupHero, type RecordsByTeamId } from "./matchup-hero";
import { ModerationSummary } from "./moderation-summary";
import { StandingsTable } from "./standings-table";
import { WaitingRoom } from "./waiting-room";
import { WeekStatusBadge } from "./week-status-badge";

/**
 * The league's home screen. Deliberately NOT a client component: it composes, it does not
 * fetch, and every value it renders (`currentWeek`, `myMatchup`, `standings`, `clinched`,
 * `locked`) arrives already computed by `src/league/**` on the server. Keeping the
 * composition here rather than inside `page.tsx` is what makes it testable.
 *
 * Renders no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx`'s `AppShell` already
 * supplies the one `<main>` (full-bleed, `flex flex-col gap-6`) every page in this route group
 * renders into; this component's own top-level wrapper would be a second, redundant one.
 */
/** The header's own dense line (Step 1): this manager's record, their standings seed, the next
 *  thing on the calendar, and the league's format facts — every fact this component already
 *  holds, joined with the same " · " separator the old subtitle used. `record`/`seed` are
 *  omitted for a viewer with no team (a commissioner without one of their own): there is no row
 *  in `standings` naming them, so nothing here would be true.
 *
 *  Gauntlet fix wave, item 7: also omitted before the league's first played week. "0-0 · #1
 *  seed" is true of every team in a league that has not played yet, which makes it noise for the
 *  many and absurd on a one-team room (the first-timer's own reading of it, gauntlet report) — a
 *  seed only means something once at least one result has separated the field. */
function headerFacts(home: LeagueHomeBody): string {
  const parts: string[] = [];
  // THE RECORD AND THE SEED LEFT THIS LINE (Sunday v5). They are the manager's own standing, and
  // law 6 gives that to the lower third at the foot of the page, where the seed can carry its
  // movement beside it. Printing both in the header AND in the strip is one fact twice on one
  // screen, which is the duplication this pass is spending most of its subtractions on.
  // The next thing on the calendar: the current week once there's a season to point at
  // (`formatWeek`, never a new fact). Before the draft is complete, `WaitingRoom` (below,
  // whenever `home.draftSchedule` is non-null) already owns naming this same instant, in the
  // reader's OWN local time (`DraftSchedulePanel`'s `formatLocal`) — this line used to ALSO
  // print `terms.draftAt`, the fixed-UTC rendering, 300px above it (gauntlet fix wave, NEW-4).
  // One instant, one presentation: the schedule panel's local hero is the one that stays.
  if (home.draftStatus === "complete") parts.push(formatWeek(home.currentWeek));
  parts.push(`${home.format === "auction" ? "Auction" : "Snake"} draft`);
  return parts.join(" · ");
}

/**
 * Every team's win-loss-tie line, keyed by team id, for the week band's hero — the same join
 * `MatchupWeekPage` makes for the same reason. The standings are already on this page; a
 * scoreboard that prints a team name with no record beside it is the one thing every real sports
 * interface does that this band did not.
 */
function recordsFrom(standings: LeagueHomeBody["standings"]): RecordsByTeamId {
  const records: Record<string, RecordsByTeamId[string]> = {};
  for (const row of standings) {
    records[row.teamId] = { wins: row.wins, losses: row.losses, ties: row.ties, rank: row.rank, previousRank: row.previousRank };
  }
  return records;
}

/** "Week 1 · Bay Bandits vs Volt Kings" — the one sentence `DraftCompleteArrival` (Step 3b)
 *  needs and no other caller on this page does yet, so it stays local rather than joining
 *  `../lib/format.ts` for a single consumer. */
function matchupHeadline(matchup: MatchupSummary): string {
  return `${formatWeek(matchup.weekNumber)} · ${matchup.homeTeamName} vs ${matchup.awayTeamName}`;
}

/**
 * Step 3b (D4). The draft room's last moment used to be a room emptying out; this is what a
 * manager sees on the FIRST league-home visit after it instead — the fifteen players
 * `commitDraftResults` wrote to their roster, and the Week 1 opponent the SAME transaction
 * scheduled. `lineup` is the exact prop `LineupEditor` below already reads: before anyone has
 * ever saved a lineup, `getLineup`'s own fallback (`@/league-service/lineups.ts`) makes the
 * drafted roster (`rosterSlots`) the lineup, so `lineup.starters`/`lineup.bench` together ARE
 * the fifteen players the draft produced — no second query, no new field.
 *
 * Derived-only, same discipline as D1 (the seating moment) and ruling 11 (the attention queue):
 * `LeagueHome` decides whether to render this from fields it already holds
 * (`home.draftStatus`/`home.currentWeek`/`home.myMatchup`) — nothing is stored, and nothing here
 * is a seen-flag a manager could dismiss. It stops rendering on its own the moment the season
 * has its first settled result, because `home.currentWeek` only stays at `1` while week 1 still
 * has an unscored matchup somewhere in the league (`currentWeekNumber`, `@/league/schedule.ts`).
 *
 * Task 12 fix round 1 (F1): `WaitingRoom`'s own terminal "Draft complete" `StatePanel` is
 * suppressed for this same window (`draftJustCompleted`, threaded down as a prop — see its own
 * docblock) so the two never stack, and its one distinct value — the "View the draft board"
 * link — is folded in here rather than lost.
 */
function DraftCompleteArrival({
  leagueId,
  draftId,
  lineup,
  matchup,
}: {
  readonly leagueId: string;
  /** `home.draftId` — `null` only in the same never-true case every other reader of it already
   *  guards defensively (a league somehow missing the draft `createLeague` always writes). */
  readonly draftId: string | null;
  readonly lineup: LineupBody;
  readonly matchup: MatchupSummary;
}) {
  const roster = [...lineup.starters, ...lineup.bench].filter((slot) => slot.playerId !== null);
  return (
    // `interactive` (rule 4's amendment, the fun pass): this card holds the two links a manager
    // presses in the moment their draft ends, which is the "a thing you act on may be a card"
    // half of the test. The depth response is the card's, never a second click target: the links
    // inside it are still the only things you can press.
    <Card as="section" interactive data-testid="draft-complete-arrival" aria-label="Your draft is in the books" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <h2 className={EYEBROW}>Your draft is in the books</h2>
        <span className="text-sm text-text-muted">{matchupHeadline(matchup)}</span>
      </div>
      {/* Law 3: fifteen players a manager just drafted, drawn as players. This was fifteen slot
          chips beside fifteen strings — the first screen after a draft room that spent an hour
          drawing every one of these men as an object. */}
      <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {roster.map((slot) => {
          const player = playerOf(slot);
          return (
            <li key={`${slot.slot}:${slot.slotIndex}`} className="flex min-w-0 items-center gap-2 text-sm text-text-primary">
              {player === null ? null : <PlayerFace player={player} size="sm" />}
              <span className="truncate">{slot.playerName}</span>
              {player === null ? null : <PositionBadge position={player.position} size="sm" />}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <Link href={`/app/leagues/${leagueId}/matchups/${matchup.weekNumber}`} className="text-sm font-medium text-accent underline">
          See the matchup
        </Link>
        {draftId === null ? null : (
          <Link href={`/app/drafts/${draftId}`} className="text-sm font-medium text-accent underline">
            View the draft board
          </Link>
        )}
      </div>
    </Card>
  );
}

export function LeagueHome({
  home,
  lineup,
  helpLevel,
  holdExpired = false,
  tab = "matchup",
  /**
   * The league's own `nextAction.kind` (F16), computed by `LeaguePage` (`src/app/app/(shell)/
   * leagues/[leagueId]/page.tsx`, exempt from the client boundary and the one place this room may
   * call `nextAction` from `@/league` as a value) from fields `home`/`lineup` already carry — no
   * new query, no new wire field. `null` for a league with nothing to point at (the `"none"` case,
   * or a test that doesn't care) — the same "omit it, get the old behavior" contract every other
   * optional prop on this component already holds.
   */
  act = null,
  playoffTeams = null,
}: {
  /** Which room of the league this render is (founder, 2026-08-28: the tab-based center
   *  viewport). The shell — masthead, tab rail, right rail, lower third — is identical on every
   *  tab; only the main column changes. Routes, not client state: /standings and /team pass
   *  their own value, the index passes nothing and gets the matchup. */
  readonly tab?: LeagueTab;
  readonly home: LeagueHomeBody;
  readonly lineup: LineupBody | null;
  /** Forwarded from `LeaguePage`. Omitted only by tests that don't care about this branch —
   *  `InfoTip` itself defaults to the click-only, non-inline behavior when it's absent. */
  readonly helpLevel?: HelpLevel;
  /** The `?holdExpired=1` carry (Task 6, binding, forwarded from `LeaguePage`'s own
   *  `searchParams`) — CALLER-FORGEABLE and decorative only. `WaitingRoom` is the one place it
   *  reaches; every other panel on this page ignores it entirely. */
  readonly holdExpired?: boolean;
  readonly nextActionKind?: NextActionKind | null;
  /** The same act, with the words and the destination — `leagueAct` (`@/lib/leagues/next-act`),
   *  computed by `LeaguePage` because `nextAction` is a value import this room may not make. It is
   *  the verb in this page's lower third; `null` renders the strip with no verb at all. */
  readonly act?: LeagueAct | null;
  /** `LEAGUE_CONFIG.playoffTeams` (Step 3c) — see `StandingsTable`'s own docblock for why this
   *  arrives as a plain prop rather than a value-import. `null` (the default) draws no cut line. */
  readonly playoffTeams?: number | null;
}) {
  const clinched = home.standings.some((row) => row.teamId === home.myTeamId && row.clinched);
  // Step 4 (F16): the ONE rule that promotes a panel — never a per-page list of exceptions, the
  // same derived-only discipline the attention queue and the rail's own state already hold. The
  // condition is the SAME fact `nextAction`'s own `fix-lineup` branch reads (`myTeamId !== null`
  // is implied by `lineup !== null`, since `LeaguePage` only fetches a lineup for a caller with a
  // team); this page has nothing else to add.
  // Step 3b (D4): see `DraftCompleteArrival`'s own docblock for why `home.currentWeek === 1` is
  // the derived "the season has no settled result yet" signal, and why `lineup`/`myMatchup` both
  // being present is the same "nothing to show a team-less commissioner" guard `promoteLineup
  // Editor` above already reads off `lineup !== null`. Also threaded into `WaitingRoom` below
  // (fix round 1, F1) so its own terminal "Draft complete" panel suppresses itself for this same
  // window rather than stacking a second "draft complete" message under the arrival.
  const draftJustCompleted = home.draftStatus === "complete" && home.currentWeek === 1 && lineup !== null && home.myMatchup !== null;
  /** Everyone this manager owns, as player objects — the Free agents board's drop list. */
  const rosterPlayers: readonly RosterPlayerRow[] | null =
    lineup === null
      ? null
      : [...lineup.starters, ...lineup.bench]
          .map((slot) => playerOf(slot))
          .filter((player): player is NonNullable<typeof player> => player !== null);

  return (
    <>
      {/* The `Card` primitive, not a hand-rolled copy of it: this header spelled
          `rounded-lg border border-line bg-surface-elevated shadow-card` inline, which is
          `Card`'s own base string with a different padding step. One surface vocabulary, spelled
          in one file (the fun pass, Task 11). */}
      <Card as="header" className="flex flex-wrap items-center gap-3">
        <Crest id={home.leagueId} name={home.name} size={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <PageTitle>{home.name}</PageTitle>
          <p className="text-sm text-text-muted">{headerFacts(home)}</p>
        </div>
        {/* The draft's one remnant once it is history — quiet, in the masthead, instead of a
            floating sentence row of its own between the masthead and the week. */}
        {home.draftStatus === "complete" ? (
          <Link className="text-sm font-medium text-text-muted underline hover:text-text-primary" href={`/app/drafts/${home.draftId}`}>
            View the draft board
          </Link>
        ) : null}
      </Card>

      <LeagueTabs leagueId={home.leagueId} active={tab} />

      {draftJustCompleted ? (
        <DraftCompleteArrival leagueId={home.leagueId} draftId={home.draftId} lineup={lineup!} matchup={home.myMatchup!} />
      ) : null}

      <MatchupCelebration matchup={home.myMatchup} myTeamId={home.myTeamId} clinched={clinched} />

      {/* Task 6: the button that has existed since Phase 1 and nobody could ever press on
          purpose. `home.draftSchedule` rides THIS render — the same props-in idiom every other
          panel below uses — and the panel reaches `fetchJson` only for its own writes (a
          reschedule or a start), never to read its initial state. Renders for every draft
          state, including `complete` — unlike the static card this replaced, which rendered
          nothing once a league had drafted.

          Phase 3.6, Task 9 (F12/P8): `WaitingRoom` is now the ONLY renderer here, for BOTH
          `startTrigger`s — the structural change this task owns. A `'when_full'` draft gets its
          own hero (the fill meter, then the countdown once it fills, D3); a `'scheduled'` draft
          delegates its hero and its commissioner console to `DraftSchedulePanel`, nested INSIDE
          `WaitingRoom` rather than rendered as a sibling this page chooses between — `WaitingRoom`
          is where the two are told apart now, not this page, and it is also where the ranking
          panel (Task 6, NFFC's Kentucky Derby System) lives, inlined into the checklist's own
          third item rather than a fourth sibling panel here. */}
      {/* THE PHASE GATE (founder, 2026-08-28: "it's already drafted but it shows that we have
          position 6"). WaitingRoom is the PRE-draft surface — the fill meter, the slot ranking,
          the checklist. It used to render for every draft state including `complete`, which kept
          a season-long league narrating its own pre-draft ("You did not rank a slot, so we gave
          you slot 6") months after the draft. Once the draft is history it renders only inside
          the just-completed arrival window; afterwards the masthead's own "View the draft board"
          link is the one true remnant of the draft on this page. */}
      {home.draftSchedule === null || (home.draftStatus === "complete" && !draftJustCompleted) ? null : (
        <WaitingRoom
          league={{
            ...home.draftSchedule,
            teamCount: home.teamCount,
            authority: home.authority,
            currentWeek: home.currentWeek,
            totalWeeks: home.totalWeeks,
          }}
          isCommissioner={home.isCommissioner}
          leagueName={home.name}
          myTeamId={home.myTeamId}
          justSeated={home.justSeated}
          holdExpired={holdExpired}
          format={home.format}
          teams={home.teams}
          compositionCategory={home.compositionCategory}
          helpLevel={helpLevel}
          draftJustCompleted={draftJustCompleted}
        />
      )}

      {/* ONE GRID, TWO REGIONS (founder, 2026-08-28: "it feels like it's all over the place").
          The page was ten siblings in a flat stack, every band negotiating its own width. Now
          the MAIN column carries the week: the bug, the tower, the lineup, the advisor — one
          left edge, one rhythm. The RAIL carries the room's ambient life: chat, the terms, the
          members. Below xl they stack in reading order, main first. The lower third stays
          full-bleed at the foot, outside both. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {/* THE ROOMS OF THE LEAGUE (founder, 2026-08-28). Matchup is the game; Standings is
              the table; My team is the decision surface (the lineup editor and its advisor,
              which left the matchup tab because setting a lineup is not watching a game).
              Trades and Activity keep their own routes and appear in the rail above. */}
          {tab === "matchup" ? (
            <>
      <section className="flex flex-col gap-2" aria-label={`${formatWeek(home.currentWeek)} matchup`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            {/* THE WEEK, ON THE DISPLAY SCALE (the fun pass, Task 11). The two things a manager
                opens this page for are which week it is and what happened in it, and the week
                rendered at 18px — the same size as the "All matchups" link beside it. Range from
                size, never from weight: rule 2's ≤600 cap did not move. */}
            <h2 className="font-display text-display-sm font-semibold leading-display text-text-primary">{formatWeek(home.currentWeek)}</h2>
            {/* ALWAYS, now — the badge moved out of the scoreboard when the band adopted the
                shared hero (Gameday). `Scoreboard` is a primitive shared with the matchup page,
                which carries the week's state on its own panel head; putting a week status inside
                it would have made every caller inherit a fact only some of them own. So the band
                states it once, here, beside its own week heading, for a manager with a matchup and
                a manager on a bye alike. It is still said exactly once: the hero below has no
                badge of its own. */}
            <WeekStatusBadge status={home.weekStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link className="text-sm text-accent underline" href={`/app/leagues/${home.leagueId}/matchups/${home.currentWeek}`}>
              All matchups
            </Link>
          </div>
        </div>
        {home.myMatchup === null ? (
          <p className="text-text-muted">You have no matchup this week.</p>
        ) : (
          // THE SAME HERO THE MATCHUP PAGE LEADS WITH (Gameday, law 2), not a quieter cousin of
          // it. This band used to render `MatchupScoreboard` at its `hero` size — 58px, no
          // crests, no records, the two names centred over the two numbers — while the page one
          // click away drew the identical fixture at 84px with both teams' records under their
          // crests. One matchup, two treatments, is exactly the "little changes here and there"
          // incoherence Gameday replaced. `records` is joined here from `home.standings`, which
          // this page already holds.
          <Card className="flex flex-col gap-3">
            <MatchupHero matchup={home.myMatchup} myTeamId={home.myTeamId} records={recordsFrom(home.standings)} />
          </Card>
        )}
        {/* Same visibility the retired "Score Week" button had: the commissioner's control is
            gone, and this is what replaced it — an explanation of why, not a silent absence. */}
        {home.isCommissioner ? (
          <p className="text-sm text-text-muted">
            {"Scores update as games finish."}
          </p>
        ) : null}
      </section>


            </>
          ) : null}
          {tab === "players" ? (
            <FreeAgentsBoard
              leagueId={home.leagueId}
              canClaim={home.myTeamId !== null && lineup !== null}
              rosterFull={rosterPlayers !== null && lineup !== null && rosterPlayers.length >= lineup.starters.length + lineup.bench.length}
              myRoster={rosterPlayers ?? []}
            />
          ) : null}
          {tab === "standings" ? (
            <>
          <StandingsTable
            rows={home.standings}
            myTeamId={home.myTeamId}
            medianGame={home.medianGame}
            playoffTeams={playoffTeams ?? undefined}
          />

            </>
          ) : null}
          {tab === "team" ? (
            <>
          {lineup === null ? null : (
            <LineupEditor leagueId={home.leagueId} lineup={lineup} totalWeeks={home.totalWeeks} draftStatus={home.draftStatus} />
          )}

          {home.myTeamId === null ? null : <AdvisorPanel leagueId={home.leagueId} weekNumber={home.currentWeek} />}
            </>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* The chat's fixed height: in ordinary flow its `h-full min-h-0` chain has nothing
              bounded to fill and would grow to every held message (L2, final review). */}
          <div className="h-96">
            <LeagueChat leagueId={home.leagueId} />
          </div>

          <LeagueTermsPanel terms={home.terms} titleAs="p" />

          <LeagueMembersPanel
            teams={home.teams}
            teamCount={home.teamCount}
            authority={home.authority}
            myTeamId={home.myTeamId}
            compositionCategory={home.compositionCategory}
          />
        </div>
      </div>

      {/* `id="invite-managers"`: `WaitingRoom`'s own "Invite someone" link (Task 8, a `when_full`
          league's filling state) points here — the one real invite surface a commissioner has. */}
      {home.isCommissioner ? (
        <div id="invite-managers">
          <InvitePanel leagueId={home.leagueId} leagueName={home.name} />
        </div>
      ) : null}

      {/* Task 8: the commissioner's own window onto platform moderation in their league — a
          member with extra buttons, not an operator, so this sits behind the identical
          `isCommissioner` gate `InvitePanel` already does, right beside it. */}
      {home.isCommissioner ? <ModerationSummary leagueId={home.leagueId} /> : null}

      {/*
        LAW 6 — the league home's lower third. Everything above it is a room: a scoreboard, a
        table, a chat, three panels of terms. The strip is the one place that answers "so what am I
        supposed to do", which is the question a manager opens this page with and the reason law 6
        exists at all.

        The cells are this manager's own line in the league — the week, their record, their seed
        and what it did last week — because the strip speaks to the reader, not about the league in
        general. A viewer with no team here (a commissioner without one) gets the week and nothing
        personal, which is the same discipline `headerFacts` above already keeps.
      */}
      <LowerThird live={home.weekStatus === "in_progress"} cells={homeCells(home)} action={act === null ? undefined : (
        <ButtonLink href={act.href} variant="verb" size="sm">{act.label}</ButtonLink>
      )} />
    </>
  );
}

/** The week's state in the words a scoreboard uses. "In progress" is an administrative noun; a
 *  week that is happening now reads "Live" (the copy charter's own worked example). */
const WEEK_STATE_WORD: Readonly<Record<LeagueHomeBody["weekStatus"], string>> = {
  scheduled: "Not started",
  in_progress: "Live",
  final: "Final",
};

/**
 * The lower third's facts, in the order a broadcast reads them: where the season is, then where
 * this manager is in it.
 *
 * The seed carries its movement (law 2) from the SAME standings rows the table below already
 * renders — `previousRank` is real arithmetic over held-out weeks, never a stored snapshot, so a
 * league with no week behind it shows the seed alone and no arrow rather than a fabricated zero.
 */
function homeCells(home: LeagueHomeBody) {
  const myRow = home.standings.find((row) => row.teamId === home.myTeamId) ?? null;
  const played = myRow !== null && myRow.wins + myRow.losses + myRow.ties > 0;
  return [
    { label: "Week", value: String(home.currentWeek) },
    { label: "Week state", value: WEEK_STATE_WORD[home.weekStatus] },
    ...(myRow === null || !played
      ? []
      : [
          { label: "Your record", value: formatRecord(myRow) },
          {
            label: "Seed",
            value: (
              <span className="flex items-baseline gap-2">
                {`#${myRow.rank}`}
                {myRow.previousRank === null ? null : <Movement places={myRow.previousRank - myRow.rank} against="last week" />}
              </span>
            ),
          },
        ]),
  ];
}
