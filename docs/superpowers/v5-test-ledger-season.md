# Sunday v5 — season surfaces: knowingly-broken test files

Tests are DEFERRED for the v5 route conversion. This file is the record of what the conversion
broke, one line each, so the pass that re-greens the suite has a list rather than a search.
`npx tsc --noEmit` is clean on every production file; everything below is a `*.test.*` file.

## Inherited from `main` (broken before this branch, listed so nobody re-diagnoses them)

- `src/league-room/components/league-row.test.tsx` — `position` became a required prop on `LeagueRow`.
- `src/league-room/components/league-row.hydration.test.tsx` — same required `position` prop.

## Broken by this branch — type errors (`tsc` names them)

- `src/league-room/components/standings-table.test.tsx` — `helpLevel` prop gone; `TeamStandingsRow` fixtures need `rank`/`previousRank`; the Record head is now "W-L-T" with no `InfoTip`.
- `src/league-room/components/league-terms-panel.test.tsx` — `helpLevel` prop gone; format reads "Snake draft"; the scoring rule prints beside the label; three `InfoTip`s gone.
- `src/league-room/components/league-members-panel.test.tsx` — `helpLevel` prop gone; the house line reads "Run by Commish, not by a manager playing in it".
- `src/league-room/components/lineup-editor.test.tsx` — `helpLevel` prop gone; the `lineup-lock` and `bench` `InfoTip`s gone; the Save button is wrapped in a `<div>`.
- `src/league-room/components/create-league-form.test.tsx` — `helpLevel` prop gone; the `superflex` tip became the roster-shape field's own `hint`; the `sit-and-go` tip gone.

## Broken by this branch — runtime assertions (these still typecheck; they will fail on run)

- `src/help/glossary.source.test.ts` — **the highest-value fix, because it encodes a founder ruling.** Ten terms lost their only `term="…"` caller when the no-tips ruling landed: `bench`, `draft-slot`, `house-league`, `lineup-lock`, `median-game`, `release-seat`, `sit-and-go`, `stake-tier`, `standings-record`, `superflex`. Each needs either a `TermLink` on `/league-rules` or an `UNSURFACED` entry stating why, in the shape `playoffs` already has.
- `src/league-room/components/activity-feed.test.tsx` — rows are banded by day (`ChapterBand`), the row prints the time only rather than a full date, and the `queue` `InfoTip` is gone.
- `src/league-room/components/matchup-panel.test.tsx` — the `matchup` `InfoTip` is gone from the eyebrow; `Side` takes a `weekStatus`.
- `src/league-room/components/matchup-strip.test.tsx` — a settled week prints no "N to play" marker (`remainingToPlay`), and the marker is `LiveMarker`, not `Pill`.
- `src/league-room/components/live-matchup-week.test.tsx` — the games-final `Pill` moved into the lower third; a `LowerThird` now renders at the foot.
- `src/league-room/components/trade-inbox.test.tsx` — the three band headings became `ChapterBand` markers ("Needs your answer" / "Waiting on them" / "Settled"); "Put an offer together" is a `secondary` pill; a `LowerThird` renders at the foot.
- `src/league-room/components/trade-card.test.tsx` — the "Needs your answer" `Badge` is gone (the chapter band above the card carries it).
- `src/league-room/components/home-board.test.tsx` — the single-league card is `emphasis="quiet"`; a `LowerThird` renders at the foot of both branches.
- `src/league-room/components/league-home.test.tsx` — no `helpLevel` reaches the panels; the header line drops the record and the seed; the standings and the chat share one grid; a `LowerThird` renders last.
- `src/league-room/components/release-seat-control.test.tsx` — the `release-seat` `InfoTip` is gone.
- `src/league-room/components/slot-preference-panel.test.tsx` — the `draft-slot` `InfoTip` is gone; `helpLevel` is no longer a prop.
- `src/league-room/components/invite-landing.test.tsx` — `helpLevel` is no longer a prop.
- `src/app/app/(public)/join/[code]/page.test.tsx` — the `readPreferences` read is gone (its only consumer was the retired `helpLevel`).
- `src/app/app/(shell)/leagues/[leagueId]/activity/page.test.tsx` — the `queue` `InfoTip` is gone from the notices band; a `LowerThird` renders at the foot.
- `src/app/app/(shell)/leagues/[leagueId]/trades/page.test.tsx` — unchanged copy, but it renders `TradeInbox`, whose shape moved.
- `src/league-service/results.test.ts` (and any `read.test.ts` pinning the standings row shape) — `leagueStandings` now returns `rank` and `previousRank`, computed by a second `computeStandings` pass with the latest settled week held out.
