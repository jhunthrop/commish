# Decisions — Phase 3.6, design v2

This is the closing decision record for Phase 3.6, written to the code that shipped rather than
to the plan that predicted it. `docs/design-system.md` and `docs/conventions.md` carry the rules
this phase now enforces; this doc carries the arguments for the handful of decisions that moved,
reversed, or cost something on the way to shipping. `docs/superpowers/plans/2026-08-23-phase3p6-design-v2.md`
and `docs/superpowers/plans/2026-08-23-phase3p6-addendum-whole-site.md` are the plan files, kept
for a reader who wants the full self-review; this doc does not restate what they already argue
correctly, and corrects the handful of places execution diverged from what they predicted.

## 1. The one-theme ruling, reversed, and what the reversal cost

The plan's own controller ruling 1 shipped **dark-only**: the approved mocks were dark, no
switcher existed, and an undesigned light palette was judged "a control wired to nothing." That
ruling held for less than one task. Mid-flight during Task 1, the founder overruled it directly:
the product's core moment is Sunday afternoon in a bright room, OS-light users deserve their
preference respected, and the standing no-MVP directive's end state has both themes, not one
shipped now and one promised later.

What shipped instead: **dark is the flagship identity**, exactly the approved mocks. **Light is
designed at the token level** to the same nineteen roles and the same contrast thresholds dark
uses — never a naive inversion. `ThemeProvider` (`system | light | dark`, `src/app/layout.tsx`)
was kept rather than removed, and the both-theme test harness was renamed `renderSurface`
(`src/components/ui/test-utils.tsx`) with its semantics preserved: it renders a component once
per theme and asserts each render independently, so a component test that says "axe-clean in both
themes" is proof, not a claim.

**What the reversal cost**, concretely, past the ruling itself: every contrast test in Task 1 had
to parameterize over both palettes rather than one (fourteen light-palette ratios were
independently recomputed during review and all matched); the light palette had to be *designed* —
the cool-hue bias translated to a near-white ground, the green family re-derived for light
surfaces, not formula-inverted from dark; and the controller's own arithmetic in the reversal
amendments undercounted the roles at twenty when the shipped set is **nineteen** (`COLOR_ROLES`,
`src/design/tokens.ts`) — caught and corrected during Task 1's review, not before.

**What did not ship, and is still future work:** the real theme switcher control. `ThemeProvider`
exists and both palettes are complete and tested, but nothing in the product today renders a
control that lets a signed-in user pick `light` over `system`. That control is scoped to the
addendum's Task 18 (the account room), which has not yet run as of this closeout — say so in the
future tense, not as shipped. Until it lands, every user is on `system`, which is the provider's
existing default.

## 2. The retone's contrast corrections — the two the mocks failed

Two values in the approved mocks did not clear WCAG on inspection, and both were corrected at the
token layer rather than by re-reading the mock as gospel:

1. **`textFaint`.** The mock's own `#6B7488` on `#161920`, used at 12px for card meta, step
   captions and table subtext across all three mockups, measures 3.75:1 — short of the 4.5:1 WCAG
   1.4.3 floor for normal text. The token moved to `#808A9E` (~5:1). The mock's original value was
   not discarded: it survives as the new `edge` role, where the bar is 3:1 (WCAG 1.4.11, an
   interactive boundary) rather than 4.5:1, and `#6B7488` clears that bar cleanly. Both values ship
   in the product today; each does the job it actually passes.
2. **The panel hairline.** `#111318` on `#0B0C0F` measures 1.05:1 — legitimate for a decorative
   panel separator (a `<div>` is not a "user interface component" under WCAG 1.4.11) and illegitimate
   for any interactive boundary. This is what forced the boundary concept in two: a decorative
   hairline (`line`, no contrast floor by design) and an interactive edge (`edge`, ≥3:1), so that a
   future "fix" of the hairline to 3:1 does not destroy the look, and a future reuse of the hairline
   on a control does not destroy the accessibility.

## 3. `border` renamed to `line`, and `edge` is new

`src/design/tokens.ts`'s `COLOR_ROLES` carries nineteen roles today (`surface`,
`surfaceElevated`, `surfaceRaised`, `surfaceInset`, `line`, `edge`, `textPrimary`, `textMuted`,
`textFaint`, `accent`, `accentText`, `accentGlow`, `positive`, `negative`, `negativeText`,
`warning`, `warningGlow`, `info`, `scrim`), each with a Tailwind alias in `src/app/globals.css`'s
`@theme inline` block (`--color-surface` through `--color-scrim`) — a verified 1:1 mapping, not a
subset. The old single `border` role split into two on purpose: v2 needs a decorative hairline
(`line`, <3:1, never a control boundary) and an interactive edge (`edge`, ≥3:1, WCAG 1.4.11), and
one name could not honestly carry both meanings. The rename was a compile-forced sweep across
every `border-border` utility in the codebase — a compile error at every call site once, rather
than a runtime contrast failure discovered later on whichever call site happened to be a control.

The `accent`/`positive` collapse (the same green for "an action" and "a good outcome," deliberate
— see `docs/design-system.md`'s "One pigment, two jobs") is what moved `marker` (the WR position
pigment) off `accent`: sharing one hex between `leaf` (RB, `positive`/`accent`) and `marker` (WR)
would make the two position stickers indistinguishable. `marker` now doubles as `info` instead,
verified by the pairwise-sticker contrast test that exists precisely to catch this class of
collision.

## 4. The dense-scale mechanism, and the density default that took three tasks to settle

`src/components/ui/table.tsx`'s `TableProps.density` docblock, transcribed in full because it is
the authoritative record of a decision that moved twice:

> `dense` is the mocks' 11px vertical cell padding; `comfortable` keeps the table's original,
> more generous padding. Defaults to `dense`.
>
> DENSITY-DEFAULT DECISION, CLOSED (Phase 3.6, Task 12 Step 3c, completing the P3/Task 11
> follow-up): Task 3 shipped this default as `"comfortable"` with explicit opt-in specifically
> so flipping it could never silently densify `matchup-panel.tsx` and `budget-table.tsx` before
> their own retone. Task 11 converged `matchup-panel.tsx`, alongside `standings-table.tsx` and
> `league-board.tsx`, all three passing `density="dense"` explicitly. Task 12 converges the
> fourth and last consumer, `budget-table.tsx` — at which point every `Table` in the product
> wants `dense` and not one wants `comfortable`, which is the moment this default was always
> meant to flip: keeping `"comfortable"` as the default past that point would just be dead
> configuration nobody opts into. The call, made: **`dense` is now the default**, and the
> three now-redundant explicit `density="dense"` props (`standings-table.tsx`,
> `league-board.tsx`, `matchup-panel.tsx`) were dropped in this same commit — `budget-table.tsx`
> never carried one to begin with, so it needed no prop change at all, only this default. A
> future table that genuinely wants the old, roomier padding still can, via `density=
> "comfortable"` — the option stays, just no longer the default nobody chooses.

The type scale that backs the density itself is a separate, single-source mechanism:
`TOKENS.font.size` / `TOKENS.font.sizeDense` are emitted twice from one place —
`renderTokensCss` writes `size` on `:root` and `sizeDense` a second time inside
`@media (min-width: UI_CONFIG.shell.denseFromPx)` — so density is a property of the viewport,
expressed once in the generated stylesheet, and no component ever writes a responsive size
utility (`text-sm lg:text-xs`) at a call site. `generate-css.test.ts` asserts the two scales share
every key, so a size present in one and silently missing from the other cannot ship.

## 5. The shell's data seam

`src/app/app/(shell)/layout.tsx` is a route-group layout (the F8 reversal of the plan's original
ruling 8 — the UX coherence review found that rendering `AppShell` per-page instead of per-layout
made every intra-app navigation blank the chrome, since `loading.tsx` suspended the rail and top
bar along with the page content). The layout calls `shellData(db, user)` once per navigation —
one round trip, reused from what `crossLeagueHome` already reads — and renders `AppShell` around
`children`. `LeagueRail` is a client component and reads `usePathname()` directly for
`aria-current`, which is what let the data-seam move from "every page" to "the one layout"
without losing the navigation-state signal the original per-page ruling existed to preserve.

Three route groups decline the shell entirely, by living outside `(shell)`'s tree rather than by
a runtime branch: the draft room and the TV board (both under `src/app/app/(room)/drafts/...`,
because `RoomRail`'s own full-height header is the room's chrome and stacking two chromes would
break the no-page-scroll contract `docs/draft-room.md` documents), and `/app/join/[code]` (a
route a signed-out stranger can land on, where a signed-in shell around it would be chrome nobody
signed out can use). None of the three carve-outs changes a URL — a route group is invisible to
the path.

`loading.tsx` inside `(shell)` suspends only the content column, not the rail or top bar — the
concrete fix the route-group move exists to deliver. **Correction: no `loading.tsx` file exists
anywhere under `src/app` in this worktree as of this closeout** — a directory search confirms
zero. The four files the plan describes are a forward reference to the addendum's Task 21, which
runs after this task in the ruled execution order (A15 → … → P14 → A17 → A18 → A19 → A20 → A21 →
A22) and has not yet executed. State this in future tense only: the route-group structure that
would let those files suspend correctly is in place today; the files themselves are not.

## 6. The roll's start predicate, and why `drafts.start_trigger` stayed at two members

The founder's "roll until full" ruling could have been built as a single `when_full` trigger with
a not-before time, collapsing the existing two-member enum into one. It was not, because that
collapse would erase a real product distinction: a **scheduled** league's kickoff is a promise
twelve people planned their Sunday around, so filling early does not move it early
(`FILL_TRIGGER_REFUSALS.notWhenFull`); a **sit-and-go** league's kickoff is whenever the room is
ready, and has no promise to keep. `draftStartTriggerEnum` (`src/db/schema.ts`) is still exactly
`["scheduled", "when_full"]` — one predicate now governs `'scheduled'` starts (**full AND kickoff
reached**, not kickoff reached alone), and the two enum members still carry two different
promises rather than being flattened into one.

**The mechanism, `rollUnfilledDraftInTx` (`src/league-service/roll.ts`):** every `'scheduled'`,
public-matchmade draft whose kickoff has passed and whose room is not full gets its kickoff
pushed forward rather than started. `dueUnfilledScheduledDraftsQuery` is the negative space of
`autoStartDueDrafts`'s own due-drafts scan — the same population, split by fullness, one query
each. The write itself is guarded (`WHERE id = $1 AND status = 'scheduled' AND kickoff_at = $2`,
the exact kickoff this call read moments earlier), the same "the write is the exclusion, not a
lock" pattern `claimAutoStart` already established, because PgBouncer transaction pooling forbids
`pg_advisory_lock`.

**The KEY SHARE preamble.** An early shipped version took no lock at all before writing, and an
opus reviewer reproduced a real `SQLSTATE 40P01` deadlock between this function and a
commissioner's own `setDraftKickoff` reschedule on two live connections — the same
`leagues`/`drafts` lock-order cycle `lock-order.test.ts` had already closed once for a different
pair of writers. `rollUnfilledDraftInTx` now takes `leagues[X] FOR KEY SHARE` as its own first
statement, alone, before touching `drafts`. `KEY SHARE` does not conflict with another `KEY
SHARE`, so two racing rolls of different drafts both proceed past it uncontended (the guarded
`UPDATE` is the only exclusion between them); it does conflict with `setDraftKickoff`'s `leagues
FOR UPDATE`, so the two writer types now serialize at the same row, in the same order, before
either touches `drafts` — closing the cycle without reintroducing the second bug below.

**The due-ness refusal.** A first attempt at the KEY SHARE fix used `FOR UPDATE` instead, which
serialized two concurrent rolls of the *same* draft into two sequential successes rather than one
winner and one clean no-op — the actual bug this surfaced was not that racing is unsafe, but that
the function never re-checked whether the kickoff it was about to roll was still due. Between the
scan's read and this transaction, a commissioner's own reschedule can land; without a fresh
due-ness check, the second, unblocked caller would re-read a kickoff already moved into the future
by the first and roll it again, producing a false "the room was not full" notice at a target that
was never actually due. `rollUnfilledDraftInTx` now re-derives `row.kickoffAt.getTime() >
Date.parse(nowIso)` immediately before the write and refuses (`ROLL_REFUSALS.notDue`) if it fails.

**The public-league manual-press refusal.** The founder's "no draft ever fires below a full room"
ruling is absolute at the platform door, but the commissioner's own press keeps its pre-existing
two-team floor for **private** leagues only — there is no league-settings write path in this
product, so a literal application would strand a private commissioner whose twelfth friend never
signs up with no way to ever draft their own league. Public, matchmade leagues have no such
dead end (the roll and the shelf both exist to keep them moving), so a short-room manual press on
a public league is refused server-side, binding the ruling exactly where nobody chose the time and
nobody but the platform can press the button.

**Rolling replaces retirement for house scheduled rungs.** A house league's `'scheduled'` rung
that fails to fill by its target time rolls exactly like a member league's would — the roll's scan
narrows to public-matchmade leagues (`ENFORCED_LEAGUE_SQL`), which every house rung already is,
and `rollUnfilledDraftInTx` names no special case for a null-commissioner league. There is no
separate "retire and replace" path for a scheduled house rung that misses its window; the roll is
what keeps it alive instead.

**The deploy-era runbook note: a one-time transition overshoot, observed and self-healing.**
During the P7+P8 checkpoint the roll re-entered house leagues the pre-Task-7 reconciler had
already replaced, overshooting the affected rungs' shelf width by one league each (`open_12`
measured at 4 open against a target of 3; `beginner` at 4 against 2). This is not a standing
defect: the roll's steady-state behavior is correct — it holds a rung's shelf width exact once a
database has fully transitioned onto this task's code — and the overshoot is a one-time artifact
of a database that already had stale, pre-replaced house leagues sitting around when the roll
started running against it for the first time. It self-heals as the extra, empty leagues fill
normally or as an operator trims them (cascade-safe: they carry zero teams). **Any database
carrying stale-replaced house leagues the first time this code runs against it will overshoot
shelf width once, harmlessly** — this is the runbook line for whichever deploy is the first to
carry this task's code against a production or other long-lived database.

## 7. The seat hold's Postgres argument

The seat hold lives in `seat_holds` (Postgres), not Redis, and expires by predicate rather than by
a scheduled sweep: `liveHoldsFor` (`src/league-service/seat-hold.ts`) counts holds with
`expires_at > now()` and `consumed_at IS NULL` directly, the same level-triggered argument the
house reconciler already makes elsewhere in this codebase. Redis is this product's delivery
mechanism — it is never the record of a disputable fact — and seat capacity is the most disputable
fact a lobby has; a hold that could silently outlive its own record in a durable store would make
capacity a race between two systems of record instead of one.

**The cookie.** `POST /api/public/leagues/[leagueId]/hold` sets `seat_hold` as `httpOnly`,
`SameSite=Lax`, `Path=/` — verified directly in the route's own docblock: *"a path scoped to this
route would not survive to the top-level GET WorkOS redirects back to, or be readable by the join
door. `Path` is a scoping convenience, never a security boundary — httpOnly, `SameSite=Lax` and
the token's own opacity are what carry the security."* The token itself grants nothing beyond "the
right to find a seat still there" — it is not an identity, and the real join door still calls
`requireCurrentUser()` and re-runs tier eligibility for real.

**The launch gate.** The seat-hold route is a new unauthenticated WRITE keyed on the same
forgeable `X-Forwarded-For` header the product's four pre-existing unauthenticated *reads* already
accept as a cost-and-noise speed bump. `docs/decisions/identity-and-trust.md`'s "The
unauthenticated rate limiters key on X-Forwarded-For" section records this route as the fifth
consumer and states plainly that the read-route reasoning does not cover it, because this route
reserves real, shared capacity rather than merely serving a read — see that document directly for
the full argument; it is not restated here. The residual risk is accepted for local development
only, and the seat-hold route may not be publicly exposed until the platform-verified client IP
fix lands first.

## 8. Deferrals — the data fact each is waiting on

| Item | Decision | The fact it is waiting on |
|---|---|---|
| Win-probability model, live, per league | Deferred | No model exists in `src/`; per-player in-game state is not on the wire. The board renders margin instead. |
| Narrative "moments" feed (red zone, big plays) | Deferred | Requires live play-by-play ingestion plus per-matchup templating; the stats pipeline ingests box-score stats, not plays. |
| Live injury feed and season projections | Deferred | No injury feed and no projection engine exist. A wrong "OUT" tag is worse than no tag. |
| Live seat counts over SSE for signed-out visitors | Deferred | Would need a new anonymous SSE fan-out. What shipped instead: a server-rendered count with an "as of" line, and the seat hold making the count true rather than merely fresh (F20's verbatim disclosure, `seatCountsAsOfSentence`, `src/league-room/components/public-league-list.tsx`). |
| Practice-pick sandbox | Deferred | Needs an isolated draft simulation with a non-human drafter — `teams.user_id` is `NOT NULL`, the same schema obstacle Phase 3.5 already documented. |
| Per-manager season-history / "verified reviewer" tags | Refused (not deferred) | Re-opens a closed privacy ruling — `compositionCategory`'s coarse-reduction reasoning applies verbatim to a twelve-row room list. |
| Projection columns on the board and the pool | Deferred | Same missing engine as the injury/projection item above. |
| Bench points on the home board | Deferred | A new read path scoring every bench player across every league on the home screen — a feature request, not a design decision. |
| Cross-league conflict detection ("swap in both") | Deferred | Needs roster diffing across independent league instances plus a multi-league write path. Named as the single highest-value follow-on this phase identified. |
| Dynasty/keeper filters, waivers, trade-deadline card fields | Refused for this phase | None of these features exists in the product; a card field for an absent feature is a lie with a label on it. |
| Push notifications for sit-and-go fills | Deferred (founder gate) | No email sender and no push infrastructure exist. In-app notices only; the when-full copy promises exactly what in-app delivery can keep. |
| The real theme switcher control | **Shipping next**, addendum Task 18 | `ThemeProvider` and both palettes are complete; only the account-room control that lets a user choose has not landed as of this closeout — see §1 above. |

## 9. What this doc deliberately does not restate

`docs/design-system.md` carries the full token/type/layout/primitive rules v2 now enforces.
`docs/decisions/identity-and-trust.md`'s fifth-consumer paragraph is the seat-hold route's launch
gate in full and is cross-referenced above, not copied. `docs/decisions/enforcement-and-tiers.md`
§9 carries the full `kickoff_at` writer history including the roll's third write. `docs/decisions/
formats-and-lobby.md` and `docs/decisions/house-leagues.md` carry the roll's interaction with the
sit-and-go trigger and the house catalog respectively. This doc exists to argue the handful of
decisions that moved during execution, not to duplicate documentation that already lives closer to
the code it describes.
