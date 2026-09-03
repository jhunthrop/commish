# The League Rail, Taught to Speak — Design Spec (2026-09-03)

Founder-approved blueprint: `.superpowers/mocks/Main.dc.html` (three sizes),
`.superpowers/mocks/SundayRail.dc.html` (live flyout inside a room), and the four laws in
`.superpowers/mocks/canvas.json`. This spec maps those laws onto the code that exists.

## Where the leagues page actually is

The mission names `/leagues`; in this codebase `/app/leagues` is a redirect to `/app` (founder
ruling in `src/app/app/(shell)/leagues/page.tsx`: "one page, not two near-duplicates"). Reviving
`/leagues` as a second page would reverse that ruling, so **`/app` IS the rail's full-page form**
and the redirect stays. "The rail does not render beside its own page" therefore means: the rail
renders `null` on `/app` (the redirect from `/app/leagues` lands there too).

## Law 1 — identity by construction

- New pure function `monogramsFor(names: readonly string[]): readonly string[]`
  (`src/components/ui/monogram.ts`), built ON `shortNameFor` (`crest.tsx`) — the product's one
  mark rule stays the preferred form; this function only resolves collisions across the caller's
  own leagues.
- Candidate ladder per name, first unclaimed wins:
  1. `shortNameFor(name)` — "The Longest Shot" → "TL", "Dev Season League" → "DS".
  2. Word-skip: first letters of the first three lettered words ("The Longest Shot" → "TLS").
     Only for names with 3+ lettered words; skipped when it exceeds 3 chars.
  3. Appended digit: the 2-char prefix of the preferred form plus 2, 3, … 9 ("DS2"), then the
     1-char prefix plus 10, 11, … — always ≤ 3 chars.
- **Stability rule (deterministic, documented):** assignment runs in the input list's order and
  the list is the shell read's own league order (`myLeaguesOverview`: `leagues.createdAt` asc) —
  stable across urgency changes and renames of siblings. The function is pure over the current
  list: when a sibling leaves, every remaining league re-derives, so a league whose preferred
  form was freed upgrades to it ("DS2" becomes "DS"); a league whose candidates are unaffected
  keeps its monogram byte-identically, because the ladder and the order both stayed the same.
- Chip ground: unchanged — `crestTone(id)` (the existing deterministic color source). `Crest`
  gains an optional `mark` prop, documented as "only ever a value from `monogramsFor`"; every
  existing caller keeps deriving the mark from the name.

## Law 2 — urgency order + typed dots, from one cheap shell read

What exists: `shellData` (`src/components/app-shell/shell-data.ts`) already calls
`crossLeagueHome` once per navigation — 8 grouped queries total (membership, leagues, teams,
drafts, matchups, weeks/medians, stat_weeks, lineup_slots), **no score-cache MGET** (only `/app`
and `/api/home` pass `getScoreCache()`). That read already yields per league: `nextAction`
(kind+label), `weekStatus`, `record`, `matchup` (Postgres scores), draft `kickoffAt`/
`startTrigger`, `medianGame`/`medianScore`, `filledTeams`/`teamCount`.

Extension (honest, bounded — zero new queries):
- `crossLeagueHome` adds `myRank: number | null` to `HomeLeagueCard` — the index of the caller's
  team in the `computeStandings` result it already builds per league. "3rd of 12" is
  `ordinal(myRank)` of `filledTeams` (standings rows == teams rows by construction).
- `RailLeague` gains `monogram` and `stateLine` (one sentence, words). `ShellData` shape
  otherwise unchanged. The rail order is computed by a pure comparator, tested on its own:
  needs-you first (within: `join-draft` before `fix-lineup`, the attention queue's own
  precedence), live second, quiet after the divider; ties keep the input order (createdAt asc —
  the stable secondary order). Dots keep the channel law: amber (`bg-accent`) = needs-you,
  red (`bg-negative`) = live — both already correct in today's rail.

State line ladder (pure, `src/league-room/lib/rail-line.ts`, two tiers):
1. needs-you → `nextAction.label` ("Fix your lineup", "Join the draft").
2. live → **shell tier: "Live now"** (degraded honestly: margins need the score cache the shell
   read deliberately skips — recorded here as the degraded-line decision). **rich tier** (page
   render and flyout-open fetch, both of which carry cache-backed scores): "Live · you lead
   84.2 to 71.6" / "· you trail …" / "· tied at …"; missing scores fall back to "Live now".
3. draft scheduled → "Drafts when the room fills" (`when_full`) or "Drafts {formatDraftAbsolute}".
4. quiet with a standing → "3rd of 12" plus, when true: " · next: vs {opponent}" (week still
   scheduled) or " · won/lost {mine} to {theirs}" (week final, scores present).
5. otherwise → `nextAction.label` if any ("Invite managers"), else the seat fact
   "{filledTeams} of {teamCount} seats filled". No filler, no invented numbers, no em-dashes.

Not cheaply derivable, recorded: trade-offer lines ("a trade offer expires Friday 9 PM" in the
mock) — pending trades are not part of `crossLeagueHome`'s reads and would cost a per-league
query; omitted, not faked. The mock's "4 starters still playing" needs per-lineup stat rows the
shell read does not hold; omitted from rail lines (the room's matchup hero carries it).

## Law 3 — one component, three sizes

- **Collapsed (56px)**: `LeagueRail` rebuilt. Vertical chip rail at `lg`+ (chips = `Crest` with
  the league's monogram, 40px, keyboard-focusable links with full-name aria-labels — today's
  accessible-name rule kept verbatim), typed dots, divider between urgent and quiet, `+` chip.
  Below `lg` it stays the horizontal strip (chips as links, no flyout — hover does not exist
  there and a tap must keep being the one-tap jump).
- **Flyout (268px)**: hover or focus-within opens the WHOLE rail as an absolutely-positioned
  overlay (no layout shift); Esc and mouse-out close; Esc returns focus to the rail. Rows are
  `RailRow` (chip + full name + one state line), plain tap targets — **no solid verbs in the
  flyout**. The `+` row gets words: "Find or start a league". On open, if any league is live,
  ONE lazy `fetch("/api/home")` (the same lazy-on-open idiom as the peek card's history fetch;
  `/api/home` reads the score cache) upgrades live rows to margin lines; until it lands or if it
  fails, the shell's "Live now" stands — degraded honestly, never wrong.
- **Full page (`/app`)**: `HomeBoard`'s multi-league and n=1 branches are rebuilt as the rail's
  full form (`LeagueRows`): the same `RailRow` model plus per-row verbs and the record+rank in
  the name line. The ONE most-urgent league gets the page's single solid amber verb
  (`variant="verb"` — the amber budget's one solid); any further needs-you rows get the quiet
  outline (`secondary`) with the same real label; live rows get an outline WATCH LIVE in the red
  channel (new `ButtonLink` variant `live`, outlined `border-negative text-negative`, added to
  the primitive, never hand-rolled); quiet rows get a plain "Open" affordance. Divider between
  urgent (needs-you + live) and quiet. Foot: the open-lobby teaser reuses `OpenSeatsPanel`
  (the existing house-shelf read, already threaded by `AppHome`). "Create a league" stays
  (`CreateLeagueCta` + `StartOrJoinDisclosure`, unchanged). `FirstRunPanel` (empty) and the
  all-pre-draft hero branch keep their founder-approved shapes. The `/api/home` refresh loop
  keeps running, so live lines move.
- The rail hides on `/app` (pathname check inside the client component); `AppShell`'s grid
  column becomes `auto` so a null rail collapses to zero width — no gap, no layout shift
  elsewhere. The room's own left edge (`RoomSpine`, inside the content column) is untouched;
  rail + spine stack exactly as today.

## Law 4 — honesty accounting for the old board

The current `/app` matchup table (`LeagueBoard`: League / Your score / Opponent / Margin
(judged) / State / Action) folds or drops as follows:
- **Folded**: record + standing → the row's name line; your score + opponent + margin → the live
  and final state lines in words (real cache-backed numbers on the page render); state badge →
  the typed dot + the words of the line; action → the per-row verb.
- **Dropped, and why the room carries it**: the judged Margin percentile ("Top 8% of your
  leagues this week") — a cross-league percentile needs the table form and its stated
  population; the signed margin itself survives in words, and the room's matchup surface
  carries the full comparison. The median line ("League median 96.2") — the room's matchup
  week renders `MedianResultLine`; a one-line rail row cannot carry a third number honestly.
  `BoardLowerThird` — its counts restate what the divider and dots now say, and its top verb
  would be a second solid amber on a page whose budget is one.
- `AttentionQueue`/`LeagueBoard`/`BoardLowerThird` leave `/app`; `attentionQueueItemsFrom`'s
  needs-you derivation lives on as the comparator's needs-you set (same two kinds, same
  precedence). `HomeLeagueCard` (the card component) and `MatchupScoreboard` had no consumer
  left after the rebuild and are deleted with their tests (dead-code rule); the contract type
  `HomeLeagueCard` stays. `LEAGUE_ROOM_CONFIG.attentionQueueCap` retires with the queue.
- A quiet row's NON-urgent action (`set-lineup`, `review-week`, `invite-managers`,
  `open-draft-room`) no longer gets a button on `/app` — the mission's own row grammar gives
  quiet rows a plain Open. The action's words survive in the row's state line where the fact
  ladder reaches them ("Invite managers", "Drafts Thursday…"), and the room the row opens
  carries the actual control. `fix-lineup`/`join-draft` — the two acts that genuinely stall a
  league — keep real verbs, which is the honest line between "needs you" and "could be done".

## Hard gates

Sunday v5 tokens both themes (only token classes used); amber budget (one `verb` on `/app`,
none in the flyout); a11y (focusable chips with full-name labels, Esc close + focus return,
`aria-expanded` on the rail); immutable patterns; files < 800 lines; `tsc` 0; eslint clean.
Tests: `monogramsFor` (collisions, word-skip, digits, stability on sibling removal),
the urgency comparator, `rail-line` (both tiers, degraded live line), flyout open/close
(hover, focus, Esc, mouse-out, lazy fetch), `/app` page states (urgent/live/quiet/empty),
`shellData`'s shape (monogram + stateLine + order).
