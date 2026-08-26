# Draft Room Composition Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the composition-pass findings from the draft-room design review (`docs/research/2026-08-26-draft-room-design-review.md`, on branch `review/draft-room`): R1 (the room wire), E5+E6+E7 (the TV board composed as a TV surface), E4 (laptop density), E3 (mobile on-turn pool access), R3 (anchored tour), E8+E10 (dock and chat quieting), R4+R5 (persona-adjudicated taste calls).

**Architecture:** Pure client-side composition — no schema, route-shape, or backend changes. Every fact rendered already rides the existing snapshot + SSE (`useDraftRoom`); the wire is `view.picks` re-presented, the TV surface re-arranges facts the rail/board already own, the tour anchors to elements already carrying test ids.

**Tech Stack:** Next.js 15 / React 19 / Tailwind v4 tokens (design v3 "Sunday Standard"), vitest + happy-dom, Playwright e2e on port 3102 (`E2E_BASE_URL=http://localhost:3102`, `NEXT_DIST_DIR=.next-e2e`).

**Spec:** The review doc's findings table + prioritized remediation, extracted to `.superpowers/sdd/2026-08-26-draft-room-composition/review.md`. The founder approved executing the composition pass 2026-08-26 ("Let's do the draft room design review fixes"); taste calls remain delegated to the controller via personas (memory: design-calls-delegated).

## Global Constraints

- Design v3 "Sunday Standard" six rules bind every change, sweep-enforced: color is meaning (green=money, red=live/clocks); one typeface, weights ≤600 (`no-uppercase.source.test.ts` forbids caps); hairlines not boxes; ONE ink action per view (`bg-text-primary` only via `button.tsx`/`button-link.tsx` primary variant — every new button here is secondary/ghost); only true things move (`accent-budget.source.test.ts`).
- The room's own laws from the fix pass: **nothing reflows when state changes** (fixed-height bands, overlay/reserved slots); **a surface with nothing to say renders nothing** (E11 — no placeholder sentences); copy rules (`copy-rules.ts` FORBIDDEN_VOCABULARY: never "autopick", never "AI"; the one safety-net phrase is "the room picks for you from your queue").
- `src/draft-room/**` never value-imports `@/mock-draft` (client boundary) — mock words arrive as props.
- No new backend reads: everything renders from `useDraftRoom`'s existing snapshot/SSE data.
- Verification policy v4: changed-files vitest + `npx tsc --noEmit` + eslint per task; e2e (mobile-360, design-v2, mock-draft) once at the closing checkpoint; no full-suite runs mid-pass. The 8 `trades.test.ts` wall-clock failures are known drift — not this pass's concern.
- Stage files by explicit path, never `-A`. Worktree only (`.claude/worktrees/phase4p5-mock-drafts`, branch `worktree-room-composition`); NEVER touch `/Users/jh/code/fantasy` working tree.

---

### Task 1: The room wire — R1 (the premium move)

**Files:**
- Create: `src/draft-room/components/pick-wire.tsx`
- Create: `src/draft-room/components/pick-wire.test.tsx`
- Modify: `src/draft-room/components/room-shell.tsx` (mount under the rail)
- Modify: `src/draft-room/components/tv-board.tsx` (mount, larger scale)
- Modify: `src/draft-room/state/config.ts` (`DRAFT_ROOM_CONFIG.wire = { maxItems: 6 }`)

**Interfaces:**
- Produces: `PickWire({ view, teams, playersById, variant })` — `variant: "room" | "tv"`, defaulting `"room"`.
- Consumes: `DraftStateView.picks` (CompletedPick[]), `teamsById`/`teamName` from `../lib/lookups`, `PositionBadge` from `@/components/ui`.

Design (settled here, not by the implementer): one hairline-topped band, one line, mono voice — the front-door `Wire`'s idiom (`src/league-room/components/wire.tsx`) at room scale. Newest pick first, `DRAFT_ROOM_CONFIG.wire.maxItems` items, each `#<pickNumber> <TeamName> — <PlayerName> <PositionBadge>` separated by `·`. All quiet (`text-text-muted`) with the player name in ink (`text-text-primary font-semibold`) for the NEWEST item only — the wire whispers history, it does not compete with the celebration. No animation (only true things move — the celebration already owns the landing moment). Auction picks render identically (a completed pick is a completed pick). Room: `text-xs`, under the rail, above the stage, inside a fixed-height band (h-8, single line, `overflow-hidden`) so its appearance never reflows the board — rendered ONLY when `view.picks.length > 0` but the band's slot is reserved from draft start (empty band pre-first-pick is acceptable: fixed-height law beats nothing-to-say law inside the room frame; resolve by reserving the h-8 slot always and leaving it empty until picks exist). TV: `text-base`, same band between spotlight and board.

- [ ] **Step 1: Write the failing tests** — renders the last `maxItems` picks newest-first with team + player + position; renders an empty reserved band (`data-testid="pick-wire"` present, no text) when `picks` is empty; only the newest item's player name carries ink; no uppercase text; renders at most `maxItems` even deep in a draft. Use `src/draft-room/test-fixtures.tsx`.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement `PickWire` + mounts in room-shell (between rail and stage row) and tv-board (between spotlight and board).**
- [ ] **Step 4: Run `npx dotenv -e .env.local -- npx vitest run src/draft-room` + `npx tsc --noEmit` + eslint on changed files.**
- [ ] **Step 5: Commit** `feat(draft-room): the room wire — last picks as one quiet mono line (review R1)`.

### Task 2: The TV surface — E5 + E6 + E7

**Files:**
- Modify: `src/draft-room/components/room-rail.tsx` (TV countdown goes time-hot; rail quiets on TV)
- Modify: `src/draft-room/components/tv-board.tsx` (spotlight folds in the countdown + last pick)
- Modify: `src/draft-room/components/draft-board.tsx` (TV variant compresses far-future rounds)
- Modify: `src/draft-room/state/config.ts` (`DRAFT_ROOM_CONFIG.tv = { hotThresholdMs: 30_000, futureRoundsShown: 2 }`)
- Test: `src/draft-room/components/room-rail.test.tsx`, `tv-board.test.tsx` (create if absent), `draft-board.test.tsx`

**Interfaces:**
- Consumes: `useCountdown`/`Countdown` (`@/components/ui/countdown`), the rail's existing deadline math.
- Produces: rail prop or internal rule — on `variant="tv"`, countdown `tone="hot"` when `remainingMs <= DRAFT_ROOM_CONFIG.tv.hotThresholdMs` (rule 1: clocks are red; the party clock goes hot for everyone in the final seconds). `DraftBoard` tv variant: rows beyond `activeRound + futureRoundsShown` collapse to ONE quiet rule line `<N> rounds ahead` (mono, muted, hairline-topped) — the room variant keeps its existing sliver recede untouched.

E6 composition (settled): the TV spotlight band becomes the TV's one dense fact-band — left: avatar + "Now picking" + team name (as today); center/right: the big countdown (`size="lg"`, the time-hot rule above) moved INTO the band, plus the last pick landed (`#<n> <Player> <PositionBadge>` quiet). The TV rail keeps league name + connection + phase but drops its corner countdown on `variant="tv"` (one clock per screen, in the band where eyes are).

- [ ] **Step 1: Write failing tests** — (a) rail on tv variant renders no countdown of its own; (b) spotlight band contains the countdown and it carries `text-negative` when remaining ≤ 30s and not before (drive `remainingMs` via fake deadline props/clock); (c) board tv variant renders exactly `activeRound + 2` round rows plus one `rounds ahead` line whose number is right, and the room variant still renders every round.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify (same battery as T1 Step 4).**
- [ ] **Step 5: Commit** `feat(draft-room): the TV board composed as a TV surface (review E5, E6, E7)`.

### Task 3: Laptop density + mobile on-turn access — E4 + E3

**Files:**
- Modify: `src/draft-room/components/draft-board.tsx` (`CELL_MIN_WIDTH.room` gains a denser step below `xl`: `min-w-28 xl:min-w-40`)
- Modify: `src/chat-room/components/league-chat.tsx` (or wherever the open/collapsed state lives): chat defaults COLLAPSED below `xl`, open at `xl+` — initial state from `window.matchMedia("(min-width: 1280px)")`, user toggle still wins afterward
- Modify: `src/draft-room/components/room-dock.tsx` (below-`lg` "Jump to the pool" ghost affordance in the dock when `canAct`)
- Test: `draft-board.test.tsx`, `league-chat.test.tsx`, `room-dock.test.tsx`

**Interfaces:**
- Consumes: the dock's existing `canAct`; the pool's existing container (give it `id="player-pool"` or reuse an existing testid as the scroll target).
- Produces: dock button `Jump to the pool` (`variant="ghost"`, `lg:hidden`, rendered only while `canAct`) that calls `document.getElementById("player-pool")?.scrollIntoView({ behavior, block: "start" })` honoring `usePrefersReducedMotion` (instant vs smooth).

- [ ] **Step 1: Failing tests** — (a) room-variant cell class carries the denser step; (b) chat initial collapsed state keys off the media query (mock matchMedia both ways); (c) dock renders the jump affordance only when `canAct`, and clicking it scrolls the pool target (spy on `scrollIntoView`); it carries `lg:hidden`.
- [ ] **Step 2: Verify they fail.** 
- [ ] **Step 3: Implement.** 
- [ ] **Step 4: Verify.** 
- [ ] **Step 5: Commit** `feat(draft-room): denser laptop board, auto-collapsed chat, on-turn pool jump (review E4, E3)`.

### Task 4: The anchored tour — R3

**Files:**
- Create: `src/draft-room/components/coach-marks.tsx` (+ test)
- Modify: `src/draft-room/components/room-tour.tsx` (anchored mode by default; existing modal kept verbatim as the fallback)
- Modify: anchor targets get stable ids/testids if missing: the rail countdown (`room-rail.tsx`), the dock queue (`room-dock.tsx`), the pool header (`player-pool.tsx`)

**Interfaces:**
- Consumes: `tourStops(actionLabel)` — the EXACT same four stops and copy (copy is sweep-pinned by `rendered-copy.test.tsx`; zero word changes). `usePrefersReducedMotion`.
- Produces: `CoachMarks({ stops, onDismiss })` where each stop is `{ heading, body, targetId }`. One stop visible at a time: a positioned popover (`position: fixed`, computed from `getBoundingClientRect`, clamped to viewport) pointing at its target, target lifted with a `ring-2 ring-text-primary` highlight; footer on EVERY stop: `Got it` (secondary — dismisses the whole tour; this is what the e2e specs and any impatient human click) plus `Next` (ghost — advances; absent on the last stop); Esc dismisses. The CLOSING stop (no target) centers. Fallback to the existing modal — same dismissal contract — when `prefers-reduced-motion`, or when any targetId is missing from the DOM (small screens where regions linearize count as present; missing means not rendered).

- [ ] **Step 1: Failing tests** — anchored mode renders one stop at a time and advances; targets get the highlight ring class while their stop is active; reduced-motion renders the modal fallback with all four stops; a missing target falls back to the modal; dismissal calls `onDismiss` exactly once and closes locally even when `onDismiss` throws (parity with today's contract).
- [ ] **Step 2: Verify they fail.** 
- [ ] **Step 3: Implement.** 
- [ ] **Step 4: Verify** (`src/draft-room` + `src/integrity/rendered-copy.test.tsx` must stay green — the stop copy is pinned).
- [ ] **Step 5: Commit** `feat(draft-room): anchored coach-mark tour, modal kept as the reduced-motion fallback (review R3)`.

### Task 5: Quieting — E8 + E10

**Files:**
- Modify: `src/draft-room/components/room-dock.tsx` (queue chip ←→× controls)
- Modify: `src/chat-room/components/message-list.tsx`, `reaction-bar.tsx` (reactions + Report)
- Test: `room-dock.test.tsx`, `message-list.test.tsx`, `reaction-bar.test.tsx`

Mechanism (settled): reveal-on-intent ONLY where a hover capability exists — the Tailwind arbitrary variant `[@media(hover:hover)]:opacity-0` plus `group-hover:opacity-100 group-focus-within:opacity-100` (with `transition-opacity` gated by reduced-motion), so touch devices keep every control always visible (a phone has no hover; hiding controls there breaks E8's own keyboard/AT requirement in its touch form). Buttons stay in the DOM, focusable, full accessible names — opacity only, never `display`/`visibility` (focus must land and reveal them).

- [ ] **Step 1: Failing tests** — chip controls and reaction/report controls carry the hover-gated opacity classes and remain in the accessibility tree; focus-within reveals (class assertion); no control lost below `lg`.
- [ ] **Step 2: Verify they fail.** 
- [ ] **Step 3: Implement.** 
- [ ] **Step 4: Verify.** 
- [ ] **Step 5: Commit** `refactor(draft-room): dock and chat controls reveal on intent, always-on for touch (review E8, E10)`.

### Task 6: Persona-adjudicated calls — R4 + R5

**Files:**
- R4 mock: `.superpowers/sdd/2026-08-26-draft-room-composition/r4-tallies-mock.html` (static, both options at 12-team density) — adjudication recorded in the ledger; implement in `draft-board.tsx` ONLY if ruled in
- R5: Modify `src/draft-room/components/bid-controls.tsx` (+ test)

R5 (settled): two `Button variant="secondary" size="sm"` steppers `+$1` and `+$5` between input and Bid; each sets `amount = min(maxBid, amount + step)`; disabled when `blocked !== null` or when `amount >= maxBid`; the input stays the precision path. No new copy sentences.

R4 adjudication procedure: render both options (tallies vs restraint) at 12-team mid-draft density in the static mock; run the persona panel (veteran / casual / commissioner / first-timer + the Ive lens) in the ledger; rule; implement only a PASS ruling. Default posture per the review: restraint may win — a NO ships nothing and closes R4 as adjudicated.

- [ ] **Step 1 (R5): Failing tests** — steppers clamp at `maxBid`, disabled while blocked, `+$5` from the floor lands `minBid + 5`.
- [ ] **Step 2: Verify fail → implement → verify.**
- [ ] **Step 3 (R4): Build the mock, run the panel, record the ruling in the ledger; implement only if ruled in (with its own test).**
- [ ] **Step 4: Commit** `feat(draft-room): one-tap bid steppers; R4 tallies adjudicated (review R5, R4)`.

### Task 7: Closing checkpoint

- [ ] **Step 1:** Full room battery: `npx dotenv -e .env.local -- npx vitest run src/draft-room src/chat-room src/integrity` + `npx tsc --noEmit` + `npx eslint .`.
- [ ] **Step 2:** Rebuild e2e bundle (`NEXT_DIST_DIR=.next-e2e npx dotenv -e .env.local -v STATS_PROVIDER=mock -- npm run build`) and run `E2E_BASE_URL=http://localhost:3102 NEXT_DIST_DIR=.next-e2e npm run e2e -- e2e/mobile-360.spec.ts e2e/design-v2.spec.ts e2e/mock-draft.spec.ts`.
- [ ] **Step 3:** Visual pass: screenshot the room (mid-draft, on-turn, TV, scheduled, 360px) via the lab script; persona checkpoint against the review's own walk; ledger the verdicts.
- [ ] **Step 4:** Update `docs/design-system.md` room section + the review doc's findings table statuses (R1/E3-E8/E10/R3-R5 closed, with one-line dispositions); commit docs.
- [ ] **Step 5:** Merge: ff `main` to the branch head after the battery, verify the founder's dev server, ledger the close in the lane ledger + meta-loop.
