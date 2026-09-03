# League Rail — Implementation Plan (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-league-rail-design.md`. Branch `worktree-league-rail`.
Each task lands committed with green gates (targeted vitest + tsc + eslint on touched files).

## Task 1 — monograms (law 1)
- `src/components/ui/monogram.ts`: `monogramsFor(names)` per the spec's candidate ladder and
  stability rule. Tests first (`monogram.test.ts`): plain initials, collision → word-skip
  ("The Longest Shot" beside "Tidal Legends" etc.), collision → digits (DS, DS2), 3-char cap,
  stability: removing a sibling frees the preferred form (DS2 → DS) and leaves unrelated
  monograms byte-identical.
- `Crest` gains optional `mark` prop (default: today's `shortNameFor`). Test in existing suite.

## Task 2 — the read (law 2 data)
- `HomeLeagueCard.myRank: number | null` in `src/league-room/contract.ts`; computed in
  `crossLeagueHome` from the standings it already builds (zero new queries). Service test.
- `src/league-room/lib/rail-line.ts`: `railStateLine(league, tier: "shell" | "rich")` ladder +
  `railUrgency` comparator (`compareRailLeagues` over state rank, then input order) +
  `railStateFor` — move/reuse `stateFor` semantics so shell-data and the page can never
  disagree. Tests: every ladder rung, both tiers, degraded live line, comparator order + ties.
- `shell-data.ts`: `RailLeague` gains `monogram`, `stateLine`; rail array now ordered by the
  comparator with monograms assigned in createdAt order BEFORE sorting. Extend
  `shell-data.test.ts` for the shape and order.

## Task 3 — the component, sizes 1+2 (law 3)
- `src/components/app-shell/rail-row.tsx`: `RailRow` (chip + name + state line), used by the
  flyout and the page.
- `league-rail.tsx` rebuilt: collapsed 56px vertical rail at `lg`+ (chips keep link + aria-name
  + aria-current + dot behavior), whole-rail flyout overlay on hover/focus-within, Esc +
  mouse-out close with focus return, `+` row with words, lazy `/api/home` fetch on open when a
  league is live (upgrades live lines via the rich tier). Renders `null` on `/app`.
  Horizontal strip below `lg` unchanged in behavior.
- `AppShell` grid `lg:grid-cols-[auto_1fr]`; rail owns its width. `UI_CONFIG.shell.railWidthPx`
  retired or repurposed (flyout width joins config).
- Tests: rewrite/extend `league-rail.test.tsx` — open on focus, close on Esc (focus returned),
  no layout-shift class (overlay is absolutely positioned), aria-expanded, lazy fetch called
  once and only when open+live, hidden on `/app`.

## Task 4 — the full page (law 3 size 3, law 4)
- `ButtonLink`/`Button` variant `live` (outline, red channel) in the primitive.
- `src/league-room/components/league-rows.tsx`: the page form — ordered rows (rich-tier lines,
  record + rank in the name line), single solid amber verb on the top urgent row, `secondary`
  for further needs-you rows, `live` outline WATCH LIVE for live rows, plain Open for quiet,
  divider, nothing else.
- `home-board.tsx`: n=1 and multi-league branches render `LeagueRows` (+ `CreateLeagueCta`,
  `OpenSeatsPanel` foot teaser as today); `AttentionQueue`/`LeagueBoard`/`BoardLowerThird`
  drop out of this page. Keep FirstRun/empty and pre-draft-hero branches.
- Tests: `league-rows.test.tsx` (urgent/live/quiet/empty states, exactly one solid verb,
  divider placement); update `home-board.test.tsx`, `page.test.tsx`; retire tests of removed
  wiring rather than deleting shared components still used elsewhere (verify usage first).

## Task 5 — gates + evidence
- Full targeted suite for touched dirs, then `tsc`, `eslint`, and the accent-budget/page-audit
  source tests if they cover these files. Screenshots (collapsed rail in a room, flyout open,
  `/app` page, both themes if quick) into `.superpowers/screenshots/` if Playwright + a seeded
  dev server are available; otherwise recorded as not captured.
