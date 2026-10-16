# The shell follows the league's season

Founder, 2026-10-15: the Leagues tab that only opens the switcher goes, and the site must know whether a league is before or after its draft and change the member's experience to match, with the in-season tools (matchup, trades, waivers, lineup) taking the navigation once the draft tools are no longer needed. The founder delegated the design calls ("make the best decisions for the user experience of the app"). This document is the authority for Lanes 53 (API) and 54 (web). It extends `docs/superpowers/specs/2026-10-15-in-season-tools-design.md` §8 and the Sideline direction (`design-sideline-direction`: people on every screen, one verb, the phone's five).

## 1. The phase

Every followed league carries a phase, computed on the API from facts the league sync already reads, and the site carries one season phase for a visitor with no league. Nothing is guessed from the calendar alone when the host states the fact.

| Phase | Meaning | Derived from |
|---|---|---|
| `pre_draft` | The league has not drafted | the snapshot status `pre_draft` (Yahoo and Sleeper state it, ESPN's `draftDetail.drafted` is false, FFPC's draft `complete` is false, MFL's draft results are empty), or a draft time in the future |
| `draft_day` | The draft starts within 24 hours or is in progress | a draft time within the next 24 hours, or status `drafting` |
| `in_season` | Drafted and the league's regular season is on | status `in_season` (or `complete` draft with the host's current week between 1 and the week before the playoffs start) |
| `playoffs` | The league's playoff weeks | the host's current week at or past the league's playoff start week, until the host says the season is complete |
| `offseason` | The season is over, or no current week and the draft is done | status `complete`, or a past season, or a drafted league whose host reports no current week |

The API answers, on every `ContextLeague` (the shell's switcher list and the selected league) and on `AttachedLeague`:

```yaml
phase: { type: string, enum: [pre_draft, draft_day, in_season, playoffs, offseason] }
phase_basis: { type: string, description: one sentence naming the fact the phase came from, in the site's words }
draft_at: { type: string, format: date-time, nullable: true, description: the host's draft time, null when the host does not say }
playoff_start_week: { type: integer, nullable: true }
waivers_open: { type: boolean, description: the host still runs waivers this week, false in and after the playoffs where the host closes them, else true }
```

And on `/me`, for the site itself:

```yaml
season:
  phase: { type: string, enum: [preseason, in_season, playoffs, offseason] }
  week: { type: integer, description: the NFL week in play, 0 before week 1 and after the season }
  basis: { type: string }
```

The site season comes from the kickoffs the API already reads for the in-season screens: week 1's first kickoff to the last regular-season game is `in_season`, the NFL playoffs are `playoffs`, after the Super Bowl until the first preseason board `offseason`, the rest `preseason`. The published board's `from_week` is not the source of the season phase (it says what the board covers), but the two must agree or the basis says why.

Honesty: ESPN and FFPC today hardcode `in_season` in their snapshots. Lane 53 reads the host's own flag for each (ESPN `draftDetail.drafted` and `draftDetail.inProgress`, FFPC's draft `complete`) so a pre-draft league on those hosts is never shown as in season. MFL without a draft fact answers `in_season` when the host's current week is 1 or more and `pre_draft` otherwise, and its basis says the host did not state the draft.

The phase is computed at read time from the stored snapshot, never stored itself, so a fresh read moves it at once. The context the shell boots from (the session copy) carries it, so the rail is right on first paint.

## 2. The rail

The rail is a function of one phase: the selected league's, else the site season (`preseason` reads as `pre_draft`, the rest by name). The Leagues item is gone. The switcher at the top of the shell is the only place a league is chosen, and its menu's last row is "Follow another league" (to `/league/new`), the account page keeps Your leagues.

| Phase | Phone, the five in order | Wide rail adds |
|---|---|---|
| `pre_draft` | Board, Players, Mock draft, Cheat sheet, Advisor | Our record, Account |
| `draft_day` | Advisor, Board, Players, Cheat sheet, Mock draft | Our record, Account |
| `in_season` | Lineup, Matchup, Waivers, Trades, Players | Rest of season, Our record, Account |
| `playoffs` | Lineup, Matchup, Trades, Players, Rest of season | Our record, Account, and Waivers returns to the wide rail while `waivers_open` is true |
| `offseason` | Board, Players, Mock draft, Cheat sheet, Advisor | Our record, Account |

Words: "Rest of season" is the board (`/board`) in season and after, and "Board" before the draft. "Lineup" is the start screen. "Matchup" is a screen of its own (§3). The rail item's label and icon change with the phase, the icon set gains `lineup`, `matchup`, `waivers`, `trades` where the existing set lacks them.

Where a rail item goes:

- Lineup, Matchup, Waivers, Trades open the selected league's screen (`/league/<id>/start|matchup|waivers|trades`). With no league followed, each opens `/league/new` with one line above the form naming the screen it leads to ("Follow your league to see your lineup each week."). Signed out in season, the rail still shows the in-season five, since the free followed league is the product's trust loop, each item then opens the follow page the same way.
- Mock draft, Cheat sheet, Advisor, Board, Players, Our record, Account keep their pages.
- In season, Mock draft and Cheat sheet are reached from the account page under "Next draft" and from the league page's pre-draft state. They never vanish, they leave the rail.

First paint: the shell is prerendered. The static HTML carries the rail for the site season at build time (the build runs hourly, so it is never more than an hour behind the calendar), and the boot script that already swaps in the session's context swaps the rail to the selected league's phase before the first frame it can, the way it already handles the switcher. No flash of the wrong rail on a repeat visit: the session copy holds the phase.

A member with two leagues in different phases sees the rail follow the switch. The switcher's menu names each league's phase in one word beside the name when the leagues differ ("Drafted", "Draft Sunday 7 pm", "Playoffs"), in the menu-words module, and nothing when they agree.

## 3. The league's pages

- The league page (`/league/<id>`) stays the team overview (standings, roster, moves, pool) and is where the switcher's league name goes. Before the draft it shows the draft time in the member's own time zone, the one verb Advisor on draft day, and the line "The site turns to your season after your draft." In the offseason it shows the final standing and the next-draft verbs.
- Matchup becomes a screen at `/league/<id>/matchup`, built from the MatchupPanel the league page has (both sides, the week's score so far, the kickoffs in the member's time zone), with the honesty lines the panel carries. The league page keeps a one-line matchup summary that links to it.
- The three in-season tabs on the league page become the four (Lineup, Matchup, Waivers, Trades) in the phases that have them, and are hidden before the draft.
- Nothing on these pages changes in words that already passed review, except where a tab name changes to its rail word.

## 4. What does not change

The board, players, mock draft, cheat sheet, advisor, record and account pages themselves. The in-season screens' decisions and verbs. The host writes and their switches. The budgets: the board's script 73,728 B, LCP 1,200 ms, the rail's change must stay inside them (measure the shell chunk before and after, icons are inline SVG paths already in the set's style).

## 5. Review

Lane 54 produces screenshots of the five rails at 1440 and 390 in both themes before the rest of the build, and the four personas walk each (the veteran: does the in-season rail put the Sunday decision first. The casual: one word per item, no jargon. The commissioner: the matchup names both teams right. The first-timer: what "Rest of season" means from the board's own basis line). The coordinator adjudicates from the report and the ledger, per the founder's delegation of 2026-10-15, nothing waits on the founder.

## 6. Lanes

- Lane 53 (API): the phase, the basis, `draft_at`, `playoff_start_week`, `waivers_open` on the context and attached league schemas, the site season on `/me`, ESPN and FFPC draft facts read honestly, MFL's rule, tests per host with recorded shapes, `make check-gen`, no migration (computed at read time).
- Lane 54 (web): the rail as a function of the phase, the Leagues item removed, the switcher's last row, the boot swap, the Matchup screen, the league page's pre-draft and offseason states, the tabs, the icons, the mockups and the persona walk, the budgets measured.
