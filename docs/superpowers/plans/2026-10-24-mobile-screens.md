# Mobile Screens Implementation Plan (phase 2 of the native apps)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repository tasks run as lanes: one worktree per task, a brief, a report, a review, the coordinator merges.

**Goal:** every screen of the product on both apps, in two tracks (in season first because it is October, then the draft experience), each screen built to the web's screen as its design outline, gated by the persona panel on its snapshots, reviewed, merged, and uploaded to TestFlight and the Play internal track.

**Architecture:** one lane per screen per platform; iOS leads by one screen and its approved snapshots are the mock Android builds to; both read the same API answers (game state from the API's `game_state` field, words from the generated word tables), share fixtures and parity files, and keep the pattern the foundation set (Model pure and tested, ViewModel with injected client, cache and clock, View or Screen reading the theme, snapshots as the mock).

**Tech Stack:** as the foundation plan: SwiftUI packages under `apps/ios`, Compose modules under `apps/android`, generated clients, `shared/` sources, `ios.yml` and `android.yml`.

**Spec:** `docs/superpowers/specs/2026-10-24-native-mobile-apps-design.md` (§3 screen inventory, §5.1 game state, §6, §7, §9). Foundation plan: `docs/superpowers/plans/2026-10-24-mobile-foundation.md`.

## Global Constraints

- All of the foundation plan's Global Constraints.
- A screen never computes game state: it reads `game_state` from the line (Lane 176). A screen lane that finds a line without the field stops that item and reports NEEDS_CONTEXT.
- A screen's words come from the generated word tables (Lane 175). A word the web builds with a function is built by the same-named function on the platform, tested against the web's output in `shared/fixtures/parity`.
- One verb per screen, pinned where the web pins it. Box scores, not prose: columns of numbers, the player biggest, the basis once in a footer.
- The player tap opens the player sheet (a native sheet) from every row that carries a player.
- Snapshots: 1x, light and dark, two sizes (iPhone 17 Pro and iPhone SE; Pixel 9 and a small phone), at most 300 differing pixels, each under 300 KB, recorded on CI's image; they are the mock the persona panel reads before the build is accepted.
- The persona file (veteran, casual, commissioner, first-timer; three lines each on the screen's snapshots and on the web's same screen at 390 for comparison) is written before the report. A persona who cannot complete the screen's one job is a FIX, not a note.
- Android follows the approved iOS snapshots for its screen: same sections, same order, same words, platform idiom for the controls. A difference is named in the report with its reason.
- Gates per lane as the foundation plan's Task C and D, plus a green `ios.yml` or `android.yml` run on the pushed branch (the Android lane opens a draft PR to trigger it).

## Review Focus

1. A line whose `game_state` is `kicked_off` must show live figures and never offer a lineup move for that slot; a test at the Sunday 18:56Z fixture clock proves it on the Start screen (Tasks S2, S3).
2. A waiver claim or a lineup move made offline must not pretend to succeed: the verb is disabled with the stamp's reason when the last answer is stale; tested with a throwing transport (Tasks S2, S4).
3. The player sheet opened from a row must show the same player the row named when the list refreshes underneath it; tested by refreshing the parent while the sheet is open (Task S6).
4. Rankings must keep their position numbers equal to the API's order even when a player is filtered out; tested against the order fixture (Task S7).
5. The mock room must survive a dropped socket without losing a pick: the reconnect test replays the action log from the last seen seq (Task D5).

---

## Track A: in season (iOS lane first, then the Android lane)

Each task is two lanes, `<N>i` and `<N>a`. The Android lane starts when the iOS lane's snapshots pass the persona gate and the review, and reads the iOS report and snapshots as its mock.

### Task S1: the shell and the player sheet frame
**Web outline:** `web/src/lib/ui/Shell.svelte` (the phone bar, the top bar with the league switch and search, the account way in), `web/src/lib/player/` shelf. **API:** `/leagues/attached`, `/me`, `/season`. **Produces:** the top bar with the league switch (B149: the way to the League home when the bar has no League tab), the site phase from `/season` when no league is followed, the player sheet container every later screen presents, search opening the Players screen. **Tests:** bar by phase against `shared/fixtures/parity/phone-rail.json`; the switch lists every attached league and the selected one first; the sheet presents and dismisses.

### Task S2: Start (the lineup)
**Web outline:** `web/src/lib/league/box/LineupTable.svelte`, `LineupStrip.svelte`, `PinnedVerb.svelte`, `lineup.ts`, `best-lineup.ts`. **API:** `/leagues/attached/{id}/lineup` (read and write), `/leagues/attached/{id}/moves/plan`, `/moves`. **Produces:** the lineup as a box score with each slot's starter and the bench, the game state word per line, the best-lineup swaps as the one verb ("Set your lineup" pinned above the bar), the write back to the host platform with the host's own words, the held state after kickoff. **Tests:** the fixture league at five clocks through the model; the verb disabled when stale; a swap round trip against a stub transport; the moves plan parsed when absent.

### Task S3: Matchup (Sunday live)
**Web outline:** `MatchupScreen.svelte`, `MatchupPanel.svelte`, `MatchupBug.svelte`, `TeamFigures.svelte`, `live-figures`, `matchup.ts`. **API:** `/leagues/attached/{id}/matchup`, `/scoreboard`. **Produces:** both sides' starters with live points and projections, the score bug, polling on the web's cadence while the screen is visible and stopped when hidden, the after-Sunday state. **Tests:** polling starts and stops with visibility; figures at the three Sunday fixture clocks; the week-done state.

### Task S4: Waivers
**Web outline:** `WaiverTable.svelte`, `PickupStrip.svelte`, `waivers.ts`, `stash.ts`. **API:** `/leagues/attached/{id}/waivers`, the claim write through `/moves`. **Produces:** the table (available players, the pickup rule from the API, FAAB where the host runs it), the claim verb, the order of claims. **Tests:** the pickup rule read from the API not computed; FAAB shown on the phone (Lane 174 persona note); the claim round trip.

### Task S5: Trades
**Web outline:** `TradeFinder.svelte`, `TradeBox.svelte`, `TradeBug.svelte`, `TradeStrip.svelte`, `trades.ts`, `trades-lineup.ts`. **API:** `/leagues/attached/{id}/trades`, `/trades/check`. **Produces:** the finder, the check with both sides' lineups before and after, the copy-to-share verb. **Tests:** the check parsed when absent; the share text equals the web's.

### Task S6: the player sheet and the player page
**Web outline:** the shelf (`web/src/lib/player/week-read.ts`, `card.ts`, `status-held.ts`), `/players/[slug]`. **API:** `/players/{player}/week`, `/leagues/attached/{id}/players/{player}`. **Produces:** the sheet with the week's read (held states and their sentences exactly as the web prints them), the figures, the status words, the full page reachable from the sheet for sharing, universal-link entry to `/players/<slug>`. **Tests:** every held-read case from the web's tests ported; the sheet keeps its player across a parent refresh.

### Task S7: Rankings and the record
**Web outline:** `/players` (the week's order), `/record`. **API:** `/order/week`, `/order`, the record route. **Produces:** the rankings with position chips and the week's game per row, the record page with what it grades. **Tests:** positions equal the API's order under filters; the record's summary sentence equals the web's.

### Task S8: Account
**Web outline:** `/account`. **API:** `/me`, `/devices`, `/devices/{id}`. **Produces:** leagues followed, devices with unpair, the push switches (stored now, delivered by phase 3), sign out. **Tests:** unpair removes the device; sign out revokes and returns to sign-in.

## Track B: the draft experience (starts when S2 is merged on iOS; runs in parallel with Track A)

### Task D1: Board
**Web outline:** `/board/[format]/[position]`. **API:** `/boards/{format}`. **Produces:** the tiers, format and position chips, the one verb, cached for offline. **Tests:** tier breaks equal the API's; chips keep their state across the sheet.

### Task D2: ADP, compare, clubs, schedule
**Web outline:** `/adp/[format]`, `/compare`, `/clubs/[abbr]`, `/schedule`. **Produces:** the four reference screens from the Board's pattern.

### Task D3: Sheet
**Web outline:** `/sheet`, `/sheet/print`. **API:** `/sheets`, `/sheets/{id}/rows`, `/sheets/{id}/import`, `/sheets/{id}/exports`. **Produces:** notes and tags per player, import, export through the share sheet (print becomes share). **Tests:** a row edit round trip; export produces the web's format.

### Task D4: Companion
**Web outline:** `/companion/new`, `/companion/[id]`. **Produces:** the second screen for a draft on another platform: the pick coming up, survival odds, one verb. **Tests:** the companion's state through the engine from a fixture.

### Task D5: Mock room
**Web outline:** `/mock/new`, `/mock/[id]`, `/mock/[id]/report`, `/mock/share/[code]`. **API:** `/mocks`, `/mocks/{id}/picks`, `/undo`, `/autopick`, `/finish`, `/queue`, `/card`, `/report`, `/shared/mocks/{code}`; the room socket (`docs/superpowers/specs/2026-10-24-room-protocol.md`). **Produces:** the room with the clock, the wall of picks, the pool, the pick card, the report, shared mocks by code. **Needs first:** B144, the room service accepting the device bearer token on the socket upgrade (an API lane). **Tests:** reconnect replays the log from the last seq; the clock offset from the welcome; a pick round trip.

### Task D6: Lobby
**Web outline:** `/lobby/[id]`, `/lobby/[id]/report`. **API:** `/lobbies`, `/lobbies/join`, `/lobbies/{id}`, `/leave`, `/card`, `/report`. **Produces:** join, draft with people over the socket, the report. **Tests:** as D5 with people.

## Track C: the API and web lanes the tracks need

- **Lane 176** (running): `game_state` on every line.
- **B144:** the room service accepts the device bearer token on the WebSocket upgrade with the `session` scope. Before D5.
- **Push (phase 3):** registration, the outbox, the delivery job, the three producers, after S8.
- **The web reads `game_state`:** a web lane switches `lineState` to the field once the API serves it everywhere, so the three clients share one computation.

## Order and parallelism

S1i now (after Lanes 175 and 176 merge), then S2i; S1a starts when S1i is approved, and so on, one platform lane behind the other per screen. At most two iOS lanes and two Android lanes at once (the machine's load stays under 10). D1i starts when S2i merges. B144 is dispatched when D4i starts so it lands before D5i. Push after S8.
