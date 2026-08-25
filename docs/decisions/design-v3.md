# Decisions — Phase 3.7, design v3 "Sunday Standard"

This is the closing decision record for Phase 3.7. `docs/design-system.md` carries the rules this
phase now enforces; this doc carries the founder's own words, the delegated design calls made on
his behalf, and the accounting against the audit that ordered this phase in the first place.
`docs/superpowers/plans/2026-08-24-phase3p7-design-v3.md` is the plan file, kept for a reader who
wants the full self-review; this doc does not restate what it already argues correctly.

## 1. The founder's three verdicts

**Rejection.** Reviewing the Phase 3.6 "mint-on-ink" identity in the merged product — the same
identity `docs/decisions/design-v2.md` records as a genuine, deliberate design language — the
founder's verdict was direct: **"I don't like this at all."** No further diagnosis was requested;
the standing "no-MVP, end-state architecture" directive and the design-calls-delegation ruling
(2026-08-24) together meant the next move was a new direction to approve, not a defense of the
old one.

**Approval.** The Sunday Standard mock (`sunday-standard.html`, archived verbatim at
`docs/research/sunday-standard.html`) was built and presented against that rejection. The
founder's verdict: **"this is better."** This is the binding approval this entire phase executes
against — the plan quotes it as "binding," and every rule below traces back to this one mock.

**The mid-phase correction.** Reviewing the merged Cluster B build — the front door and `/browse`
rebuilt to the mock's card language — against the live product, the founder found the card grid
itself the wrong shape: **"horizontal row elements instead of these cards - my eyes don't know
where to focus."** This is not a rejection of Sunday Standard; it is a correction inside it, and
it reopened a plan item the audit had explicitly deferred (Direction 2, "a lobby table") as its
own founder order. Task 13 — not in the original plan — shipped it; see §5 below.

Three verdicts, three different scopes: the first threw out a whole palette identity, the second
approved its replacement wholesale, the third reshaped one surface's layout inside the approved
identity without touching the palette, the type ramp, or the six rules at all.

## 2. The six rules

The Sunday Standard mock is not a set of hex values; it is six rules, legislated into the product
by tests where a rule can be swept and by review where it cannot:

1. **Color is meaning.** Green is money and seats filling, red is live and clocks, everything
   else is ink and paper. The mock's six named colors: paper/graphite `#FBFBFA`/`#0D0D0F`, ink
   `#1A1A1E`/`#F4F4F6`, quiet `#6B6B70`/`#98989F`, hairline `#E8E8EA`/`#242428`, money
   `#0B6B43`/`#3ECF8E`, live `#D6453A`/`#FF6B5E` (`negative` retuned to `#C23228` in daylight
   during Task 1's fix round — see `docs/design-system.md`'s palette table for the shipped
   values and the WCAG correction).
2. **One face, earned weights.** Geist only; hierarchy from size and weight, never a second
   typeface. Display weight converged 700 → 600 repo-wide (self-ruling S4).
3. **No capitals anywhere.** Enforced by `src/design/no-uppercase.source.test.ts`.
4. **Hairlines, not boxes.** Structure from thin rules and space.
5. **One ink action per view.** One solid pill, everything else quiet. The two pill spellings are
   enforced by `src/design/accent-budget.source.test.ts`; the per-view *count* is
   component-test-and-review-enforced (see `docs/design-system.md`'s "Pill discipline" section).
6. **Only true things move.** Real events animate; chrome never does.
   `prefers-reduced-motion` honored globally and deliberately.

## 3. The two sweep tests as law

`no-uppercase.source.test.ts` and `accent-budget.source.test.ts` join `no-raw-color.source.test.ts`
as the third and fourth source-level sweeps this product runs — the same walker
(`sourceFilesIn`, `src/design/test-support.ts`), the same seven swept directories, each banning
one class of regression a hundred future components would otherwise reintroduce one call site at
a time:

- **The caps charter** bans the literal, case-sensitive string `uppercase` outside
  `position-badge.tsx` and `crest.tsx` (self-ruling S6 — acronym/initials data, not styled
  shouting).
- **The accent budget** bans `bg-accent` as a fill outside five sanctioned data primitives
  (`meter.tsx`, `seat-meter.tsx`, `celebration.tsx`, `avatar.tsx`, `budget-table.tsx`), and bans
  `bg-text-primary` — the ink pill's own fill — outside `button.tsx`/`button-link.tsx`
  (self-ruling S2).

Both tests were written red-first (TDD, per the plan's global constraints), landed green against
the fully swept codebase, and a build in this phase cannot reintroduce the audit's own findings
(43 uppercase sites, 11 hand-rolled CTA fills) without the sweep failing loudly.

## 4. Self-rulings S1–S10

Delegated design calls, made per the standing design-calls-delegation ruling (2026-08-24) rather
than queued for the founder — each names the call and the reasoning, recorded here per the
standing rule that a delegated call gets a record even when it never needed founder sign-off.

- **S1 — role survival:** `warning` and `info` keep their roles and get retuned values; the
  six-color rule governs what the public surfaces *use*, the nineteen-role set stays frozen.
  `negative` and live are one red family, jobs separated by context exactly as `accent`/`positive`
  already are.
- **S2 — ink pill spelling:** the solid pill is `bg-text-primary text-surface` — ink on ground
  needs no new role, and the accent-budget sweep bans the spelling outside the two button
  primitives.
- **S3 — display tracking** moves to −0.028em on display sizes only; body tracking untouched.
- **S4 — weight 650 → 600:** `font-semibold` everywhere the mock says 650; no arbitrary-value
  weights. Closed repo-wide in Task 9 (five residual sites the audit's own inventory missed);
  `font-bold` is zero occurrences across every swept directory, proven by grep, not claimed.
- **S5 — yard-line pitch** lives as a plain CSS value in `globals.css` beside the mock reference;
  it is one class's geometry, not feature code, so the raw-color/raw-px sweeps (which walk
  `.tsx`, not `.css`) have no opinion about it.
- **S6 — caps allowlist:** `position-badge.tsx` and `crest.tsx` only. StatPill, wordmark, TV
  labels and the "You" marker all go sentence case.
- **S7 — card facts:** five ledger rows (Drafts, Entry, Seats, Roster, Playoffs); Who folds into
  the format line. The mock's three rows plus the audit's veteran facts, reconciled in the denser
  direction.
- **S8 — hero copy:** mock headline and sub adopted verbatim; "No account is needed to look."
  kept as a detail line.
- **S9 — the wire is actor-free:** no member names on anonymous surfaces; deviation from the
  mock's literal ticker copy ("Marcus claimed a seat"), recorded. `seatClaimsQuery` never selects
  `actor_id`, so the projection cannot leak what it never reads.
- **S10 — one ink on the locker room** is the attention queue's top action (the surface's
  genuinely most urgent act, already sorted to the front by `attentionQueueItemsFrom`'s own
  urgency order); table rows are quiet.

**Founder-gated, not decided here (per the plan):** nothing in the plan required founder input to
execute; the hero headline change (adopting his own approved mock's copy) and the wire's
actor-free deviation (S9) were flagged for his awareness, not his approval.

## 5. Execution rulings recorded per task (the ledger's tail, condensed)

Design calls made during execution, each affecting what shipped and each worth a permanent
record independent of the task ledger they were made in:

- **Coarse time, not clock time (Task 7).** The mock's chips speak clock time ("drafts at 8:00
  PM"); the product speaks duration ("N hours until the next draft"). Clock-time phrasing is a
  timezone claim UTC storage cannot honestly keep — the ruling holds until a timezone feature
  exists, and is not revisited casually.
- **The wire is actor-free (Task 8, S9 above).** Recorded here again because it is the phase's
  clearest instance of "the mock's idea, not the mock's literal copy" — the pattern the next
  designer should reach for when a mock's copy assumes data this product deliberately does not
  disclose.
- **Badge authority, not substring matching (Task 5 fix round 1, closing E3).** A house league's
  title carries its rung by construction (`houseLeagueName` is the one namer of house leagues),
  so a house card/row never shows a redundant rung badge; a member league's stake badge always
  shows, because a member's own chosen name is arbitrary text a badge cannot safely infer from.
  The review that caught this rejected an earlier substring-matching implementation outright
  ("Free For All League" would have lost its stake badge to a name collision) — the fix keys on
  which query populated the row, never on parsing what a human typed.
- **The chosen-kickoffs gate (Task 8, carried from `proof.ts`).** `draft_tonight` (the wire) and
  the scoreboard's third chip both admit a kickoff only when a human chose it
  (`start_trigger = 'scheduled'`) or the fill trigger actually set it
  (`fill_fired_at IS NOT NULL`) — a `when_full` league's placeholder `kickoff_at` never reaches
  either surface dressed up as a real time. The asymmetry with `nextDraftAtQuery`'s identical gate
  is the honest one: advertising a placeholder is the exact class of lie rule 6 exists to refuse.
- **The caps and accent sweeps are law, not convention (Tasks 3 and 4).** Both landed test-first
  (red, listing every offender the audit had already inventoried by hand; green once the sweep
  swept clean), which is what makes §3 above true as an enforcement claim rather than a style
  preference: a future PR that reintroduces a hand-rolled uppercase class or a thirteenth
  `bg-accent` CTA fails CI, not review.

## 6. Audit finding → task closure table

Every finding the 2026-08-24 UX remediation audit (`docs/research/2026-08-24-ux-remediation-audit.md`,
merged from `audit/ux-remediation` unchanged) raised, and what closed it. The audit's own findings
use its per-section numbering (F1–F11 on the front door, S1–S4 signed-in, P1–P3 public reading,
W1–W6 width); the plan re-keyed the seventeen it acted on into one D/E/F scheme, reproduced here
verbatim from the plan, plus the one item the plan deferred and the founder later ordered.

| finding | closed by |
|---|---|
| D1 guided-caption repetition | Task 5 (+ legend, Task 6) |
| D2 accent budget | Tasks 4, 5, 6, 9 |
| D3 instance-dump front door | Tasks 6, 7 |
| E1 uppercase names/headers | Task 3 |
| E2 width / grid tiers | Task 6 (superseded on lg+ by Task 13's rows; the tier work stands below lg) |
| E3 badge and header redundancy | Tasks 5, 6 (badge-authority ruling closed in Task 5's fix round, §5 above) |
| E4 eyebrow fragmentation | Task 3 (+ 7's step numerals) |
| E5 amber when-full sentence | Task 5 |
| E6 hero responsive step | Task 7 |
| E7 InfoTip caption misalignment | Task 5 (dies with D1) |
| E8 hand-rolled CTA duplication | Task 4 |
| E9 uncontained review row | Task 10 |
| E10 inline tips in prose | Task 10 |
| E11 two green nav CTAs | Task 4 |
| E12 per-row table fills | Task 9 |
| F1 orphaned leading separators | Task 5 |
| F2 floating heading caption | Task 6 (collapsed further to one sentence by Task 13) |
| **Direction 2 — a lobby table** (deferred in the plan's own "Refused / deferred" section as a second IA change stacked on this one) | **Task 13, founder-ordered mid-phase** (§1 above) — the shelf renders `LeagueRow`s on `lg`+ viewports; `OpenLeagueCard` remains the sub-`lg` mobile form. See `docs/design-system.md`'s "The row shelf" for the shipped shape. |

All seventeen plan-scoped findings closed within Cluster A–C; the eighteenth item — the audit's
own deferred direction — closed by the founder's mid-phase order rather than by the plan that
deferred it, which is why it is recorded separately above rather than folded into the original
seventeen.

## 7. What this doc deliberately does not restate

`docs/design-system.md` carries the full token/caps/pill/wire/type/row-shelf rules v3 now
enforces, each pointing at the test that proves it or naming itself review-enforced.
`docs/decisions/design-v2.md` carries the arguments for what v2 shipped and is not restated here
except where v3 directly reopens it (the mint-on-ink rejection, §1; the position-pigment
re-derivation, `docs/design-system.md`'s "One pigment, two jobs"). Task 12's persona-checkpoint
verdicts, once run, are the next entry this document expects — appended below this line, not
folded into the sections above, so the record of what the panel found stays distinguishable from
what execution had already decided before they walked the product.

---

## 8. The persona checkpoint (Task 12, 2026-08-25)

Run against the rendered production build (`next start`, the e2e bundle), both themes, at 1440px
and 360px — screenshots of every station, never a claim from source alone. The phase-end battery
ran first (26/26 e2e specs green across both viewport projects, after one spec-layer fix — see
the task report), and the browser contrast pass rode the battery's own axe spec
(`e2e/design-v2.spec.ts`, "every v2 surface clears axe's color-contrast rule"): zero
`color-contrast` violations on `/`, `/browse`, the locker room and the draft room (plus the hold
interstitial, waiting room, league home, standings and a matchup week), light and dark.

**The panel** — veteran, casual, commissioner, first-timer, plus the phone user and the skeptic —
walked `/`, `/browse`, a league row, an open card at 360px, the wire, and the locker room against
the founder's bar ("most premium… beautifully simplistic but high information density… best app
I've ever seen") and the six rules.

**Verdicts by station:**

- **The front door (`/`).** Holds the bar in both themes. The floodlit hero, the three-step
  strip, the proof stats and the row shelf read as one object; color lands only where rules 1
  and 6 permit it (money green on "Drafting this week." and entry values, live red on ticking
  clocks and "On deck" dots). The veteran finds the shelf scannable top to bottom in one pass —
  the founder's rows correction, verified working at the checkpoint. The first-timer finds the
  three-step strip answers "what happens when I press this" before pressing anything.
- **`/browse`.** The full lobby carries the same row grammar with the four filter pills and one
  legend line; the commissioner's "Start your own league" escape is present without competing
  for ink (rule 5: one ink pill per rendering, on the featured row only, verified in the
  screenshots and by `public-league-list.test.tsx`'s own count assertion).
- **A league row.** Six columns, hairline-separated, exactly one spoken key per cell that needs
  one. The casual reads a row left-to-right as a sentence; the veteran compares columns
  vertically. One LOW noted, not actioned: a member league's stake badge beside its name repeats
  the Entry column's value in the row form — the standing badge-authority ruling (§5, Task 5 fix
  round) holds as written, and the panel judged the repetition tolerable against the cost of
  reopening a reviewed ruling mid-checkpoint. Recorded for the next design pass, not silently
  absorbed.
- **The open card at 360px.** The phone user's verdict: the ledger card is the strongest single
  surface in the product — name, live chip, five ledger rows, seat segments and one action in
  under a screen, nothing truncated, no horizontal scroll (also proven by `mobile-360.spec.ts`
  in the battery).
- **The wire.** Actor-free sentences (S9) read naturally; the skeptic specifically checked that
  every item names a league, a count or a coarse duration and none of it is fabricated filler —
  the honesty contract (`docs/design-system.md`) is visible in the rendered output, not just the
  docblock. Reduced-motion and static-row branches are test-asserted (`wire.test.tsx`).
- **The locker room.** The attention queue's top action is the view's one ink (S10); the board
  is quiet; and the open-leagues panel below it now follows the founder's rows order (see
  adjudication A below). With a heavy fixture dataset (60+ leagues) the table stays legible —
  density is the product working as briefed, not a defect.

**No DIRECTION-class findings.** Nothing the panel found requires founder input; the one noted
LOW above is recorded under a standing ruling.

**Adjudication A — the signed-in home's `OpenSeatsPanel` renders rows too (decided yes,
shipped).** The founder's order ("horizontal row elements instead of these cards - my eyes don't
know where to focus") named the card-grid *form* at desktop widths, not the page it happened to
be on. The signed-in home showed the same league twice-shaped — a row on `/browse`, a card on
`/app` — and stacked a card grid under a league *table*, the exact focus failure the order
diagnosed. `OpenSeatsPanel` now renders `LeagueRow`s on `lg`+ and keeps the card grid below
`lg`, through the same `open-league-shared.tsx` source (Task 13's split), so the two surfaces
can never disagree. One deliberate difference from the public shelf: no featured league — rule 5
gives this view's one ink action to the attention queue's top item (S10), so every panel CTA is
quiet in both renderings, asserted by `open-seats-panel.test.tsx`.

**Adjudication B — the tier-refusal sentence in the row's action column (decided: cosmetic
defect, fixed).** Reproduced in the rendered build: `LeagueRow`'s action column is a
`max-content` grid track, and `ENFORCEMENT_REFUSALS.join`'s 140-character sentence sized the
track to the sentence *unwrapped*, ballooning the CTA pill and crushing the other five columns
into stacks. Not acceptable at the founder's bar. Fix: the refusal paragraph in
`JoinPublicLeagueButton` carries `max-w-56`, so the sentence wraps inside its own column beside
the button that caused it — the row's columns hold, and a card reader sees no change (the card's
own width already governed there). Verified by re-render screenshot and the updated
`join-public-league-button.test.tsx`.

**EXECUTION fixes shipped at this checkpoint:** the two adjudications above (both TDD,
red-first), plus one spec-layer e2e fix from the battery (the App Router streaming-buffer
strict-mode race on the `/app` first-run fork — `onboarding.spec.ts` / `whole-site.spec.ts`
scope their text/label reads to `main`; diagnosis in the spec comment). Zero product regressions
found; the full suite re-ran 26/26 green after the fixes.
