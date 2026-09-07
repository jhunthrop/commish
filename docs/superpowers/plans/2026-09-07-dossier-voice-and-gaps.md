# Dossier Voice and Gaps — implementation plan

Spec: `docs/superpowers/specs/2026-09-07-dossier-voice-and-gaps-design.md` (with the founder
amendment of 2026-09-07 to §3.5, fetched from main as commit `a45f99b` here).
Ledger: `.superpowers/sdd/dossier-voice/progress.md` (gitignored), one line per task and per ruling.

Concurrency: a second engineer holds the peek-document round. `src/league-service/player.ts` is
untouched here. `src/capsules/collect.ts`'s writer path, `src/capsules/peek-facts.ts` and
`src/jobs/*` are touched only where a task cannot avoid it, and then additively.

---

## Task 1 — Target share has a denominator (§3.1)

**Where:** `src/projections/laws/populations.ts`, `fillFromPlayByPlay` and its docblock.

The gap-season fill sums play-by-play targets per player and leaves `teamTargets` at zero, so
`targetShareOf` returns `null` for every 2025 player and the Role module prints "not tracked for
him" for the whole board.

The denominator is derivable from the rows already read: a team-week's targets are the sum of that
week's target rows across the players `player_week_teams` places on that team that week — exactly
what the published feed's own `team_targets` column carries. `bestTeammateTargetShares` already
reads `playerTeamsAsOf` week by week for the same reason (a traded player belongs to two teams in
one season), so the fill joins team the same way rather than by a season-of-record team.

Rules:
- A player's targets AND his denominator are accumulated over the same weeks: the weeks in which he
  has a play-by-play row and that week's team is known. A week with no team edge contributes to
  neither, so a share can never be his targets over somebody else's denominator.
- A team-week whose target sum is zero contributes zero to the denominator, and a player whose whole
  denominator is zero keeps `targetShareOf` at `null`. Never a divide.
- Carries are unchanged: a carry needs no team.
- The docblock's "NO TEAM TARGETS" paragraph is replaced by the derivation and its honesty rule.

**Test** (`populations.test.ts`): three receivers on one team over two weeks, each share asserted,
the three shares summing to one; a zero-target team-week yields no share, not a throw.

**Verification:** read Nabers' and McCaffrey's 2025 target share off the dev database with a
throwaway script under the scratchpad, record both values in the ledger.

---

## Task 2 — The tier clause tells the truth (§3.3)

**Where:** `src/projections/decide/tiers.ts` (new predicate), `src/projections/decide/draft.ts`,
`src/projections/preseason/board.ts`, `src/league-room/outlook/verdict.ts`.

- `tiers.ts` exports `isRealTierCliff(ownPoints, dropToNextTier)`: the drop is at least
  `TIER_BREAK_GAMES / GAMES_PER_SEASON` of the player's own projection, written as the same
  cross-multiplication `isTierBreak` uses so a non-positive projection reads as "no cliff" rather
  than a division by nothing. One predicate, because two emitters state the same claim: `draft.ts`'s
  pick reason (which keeps `TIER_IS_THIN_AT` on top of it) and `board.ts`'s stored board reason
  (which fires today on any positive drop, and is the emitter the peek's verdict actually reads).
  Ruling to record: the brief named `draft.ts` only; `board.ts` is included because the founder's
  own complaint is a stored board reason, and a threshold that lives in one of two emitters is a
  rule the product does not actually keep.
- `verdict.ts`: the count is spelled ("Two left in his tier before a 20.9 point drop."), "last man"
  only at one, and the clause stays a supporting clause after the market or per-game lead, which is
  the ordering the module already has and the tests will pin.

**Tests:** `tiers.test.ts` for the predicate at, just under and just over the threshold;
`draft.test.ts` and `board.test.ts` that a within-tier step fires no `tier_cliff`; `verdict.test.ts`
for the spelled count, the "last man" singular, and that the clause never leads.

---

## Task 3 — Numbers like a person writes them (§3.4)

**Where:** `src/league-room/lib/format.ts` (the existing display-format module),
`src/league-room/dossier/role-module.tsx`, `books-module.tsx`, `season-strip.tsx`.

- `format.ts` gains `formatTenth(value)` (one decimal, always) and `formatLine(value)` (a book's
  line: one decimal with a bare `.0` trimmed, so 9.5 stays 9.5 and 10 stays 10).
- `role-module.tsx`: the trend delta renders through `formatTenth`, so does each side of the trend
  sentence; the closing sentence joins with a space instead of a leading period (" A real move, not
  noise." becomes part of the flow rather than a span starting with ".").
- `books-module.tsx`: the props line and the team win total render through `formatLine`.
- `season-strip.tsx`: the receiving-yards value renders as a whole number.

**Test:** render 12.440000000000001 through the role module and assert "12.4" and a single
"12.4"-carrying sentence with no " ." seam; the books module with 9.5 and 10.

---

## Task 4 — The template says what it is (§3.2)

**Where:** `src/league-room/dossier/read-card.tsx`, `src/league-room/outlook/outlook.tsx`,
`src/capsules/template.ts`, `src/capsules/config.ts`.

- Both fallback lines become "A summary from the numbers. The written read is on its way."
- `template.ts`'s law sentence states the effect in words with its direction and what it is about
  ("Red-zone touch share this thin costs him 6.4 points a game") rather than a signed number with no
  explanation. Every other template sentence gets the same read-aloud pass. No em-dash, no
  semicolon, no tips.
- `config.ts`: `sweepGenerationBudget` rises from 25, with the arithmetic against the job's own
  timeout and the per-night cost stated beside it. `sweepPacingMs` falls to what the raised batch
  needs, keeping the 429 backoff track as the guard it already is.

**Test:** `template.test.ts` asserts the law sentence's words and direction; the read-card and
outlook tests assert the new fallback line.

---

## Task 5 — Every sentence is written, every number is stated (§3.5, as amended)

The largest task. A per-player NARRATIVE artifact: one JSON object of named slots, one gateway call
per player alongside the two reads, every slot validated by the grounding validator, per-slot
fallback to the template sentence, stored with the capsule.

**5a. The slot vocabulary** — new `src/capsules/narrative-slots.ts`, pure and client-safe (no
database, no `node:crypto`), holding:
- `NarrativeSlots = Readonly<Record<string, string>>` and the key builders: `"call"`, `"perGame"`,
  `"trend"`, `"story"`, `"books"`, `"tier"`, `whyGroupKey(groupKey)`, `absenceKey(module)`.
- `narrativeSlot(capsule, key): string | null` — the one accessor every module reads through.
  Returns null for a missing capsule, a missing narrative, a non-string, or an empty string.
- `normalizeSentence(text)` for the repetition check (lowercased, punctuation and whitespace
  collapsed), used by the sweep and by the tests.

**5b. Grounding, per slot** — `src/capsules/validate.ts` grows `validateNarrativeSlot(text, facts,
maxWords)` over the SAME internals `validateCapsule` uses (numbers trace to `numberLedger`, names to
`nameLedger`, banned vocabulary, competitor names, em-dash, semicolon, the unframed floor claim).
The mandated-tension check stays on the long reads only: a 30-word call cannot be asked to carry the
strongest downside and the call as well. Bands: `call` 30 words, every other slot 40.

**5c. The writer** — new `src/capsules/narrative.ts`:
- `narrativePromptFor(facts, context, avoid)` builds one user message: the same fact sheet
  `renderFactsForModel` gives the reads, plus the module context (market gap, tier standing, trend
  deltas, group effects and ids, the absences), the requested slot keys with their word bands, two
  voice exemplars drawn from the persona pass (Task 8), the instruction to write from THIS player's
  situation, and any flagged stock sentences named as sentences not to reuse.
- `generateNarrative(facts, context, deps, avoid)` makes ONE gateway call through a new
  `generateNarrativeBody` in `write.ts` (the same transport, retry and usage accounting; the
  degenerate-completion floor becomes a per-call parameter so a short artifact is not mistaken for
  an empty one), parses the JSON object (tolerating a fenced block), validates each slot, DROPS
  every slot that fails, and returns the surviving slots plus the rejections for the sweep's detail
  lines. A parse failure returns no slots, never a throw: the templates are the floor.
- The context is built once, beside the facts, from `PlayerFacts` itself — `evidence` law items gain
  a `groupKey` (the same key `groups.ts` renders with, which `facts.ts` already computes) so a
  why-group slot can be addressed by the key the module holds.

**5d. Storage** — `player_capsules` gains `narrative jsonb` (nullable). `store.ts` reads and writes
it, `PlayerCapsuleView` gains `narrative`, and `StoredPlayerCapsule` carries it for the sweep. The
migration is generated LAST (the journal is at 0081 and the parallel round may take 0082/0083).

**5e. The sweep** — `generate.ts` returns the narrative alongside the two sizes (its own failure
never degrades the reads' `source` flag); the sweep job passes it to `upsertCapsule`, counts the
slots written and the slots rejected in its summary, and after the run performs the repetition
check: every stored narrative sentence, normalized, counted across the board; any sentence over
`CAPSULE_CONFIG.repetition.maxShare` (2%) is flagged, its players' `factsHash` is cleared so the
next sweep regenerates them, the flagged sentence is recorded for the prompt's avoid-list, and the
count is in the summary. The check itself lives in `src/capsules/repetition.ts` (pure over rows) so
the job file's edit stays four lines.

**5f. Rendering** — each module renders its slot when present and its template otherwise, never
both, and never in place of a number:
- `outlook/verdict.ts`: `verdictLine(reasons, position, call)` renders the call as the lead when one
  exists, the market sentence otherwise; the market gap and the tier clause stay as the sub-line.
- `dossier/call-card.tsx` (`perGame`), `role-module.tsx` (`trend`, and the absence note),
  `books-module.tsx` (`books`), `season-strip.tsx`/`story-module.tsx` (`story`),
  `why-groups.tsx` (one slot per group id).
- `dossier-composition.tsx` resolves each slot through `narrativeSlot(body.capsule, key)` and hands
  modules a plain `sentence` prop, except `WhyGroups`, which takes the capsule and resolves per
  group.

**Tests:** the validator per slot (a grounded call passes, an ungrounded number fails, 31 words
fails, a banned word fails); the parser (fenced JSON, a non-object, a non-string slot); the render
choice for every module, both ways; the repetition check flagging a sentence over the share and
naming the players it queues. No gateway call anywhere: fixtures only.

---

## Task 6 — Win totals fetch on the job system (§3.6)

**Where:** `src/projections/vegas/ingest.ts`, `src/jobs/defs/win-totals-job.ts` (new),
`src/jobs/registry.ts`, `src/jobs/schedules.ts`.

- `ingest.ts` gains `fetchPublishedWinTotals(deps)`: reads the publisher's own committed file
  (`raw.githubusercontent.com/greerreNFL/nfelosrs/main/nfelosrs/Manual Data/win_totals.csv`, the
  provenance `data/win-totals/README.md` records), asserts the shape (the columns the parser needs,
  at least one row, 32 rows for a season it claims to cover), normalizes the two team-code
  divergences the README documents, and returns rows. A season the publisher has not posted returns
  no rows for that season and the caller says exactly that: the module keeps "not posted yet", which
  is then true.
- The committed CSV stays the validated seed: the job ingests the fetched rows for the product
  season only, and the committed file remains what `ingestVegasWinTotals` reads.
- The job is registered exactly the way `capture-harvest-job.ts` is (definition, registry entry,
  schedule entry): a season-open fire and a weekly fire until kickoff, self-skipping after kickoff.

**Tests:** the shape assertion against a fixture, the "not posted" path, the team-code
normalization, and the job's skip-after-kickoff path. No network in tests.

---

## Task 7 — `--diff-reasons` on the board persist (§3.3)

**Where:** `scripts/preseason-persist.ts`.

A mode that builds the board exactly as a persist would, reads the stored reasons for the same
season and source (`boardReasons`), and prints per reason code how many players would gain the
reason, lose it, or keep it with a changed payload, plus a total — then exits without writing.
Never run against production here; the coordinator runs it after merge and records the diff.

**Test:** `preseason-persist.test.ts` covers the diff counter as a pure function over stored and
fresh reason maps.

---

## Task 8 — Persona pass on real players (§3.7)

McCaffrey, Nabers, a rookie, a kicker and a team defense read end to end off the dev database
through the composed body, as the veteran, the casual manager, the commissioner and the first-timer.
Every sentence that reads as a template, a bare law effect or a repeated phrase is listed with the
change made, in the ledger and in the diff. The two best sentences from this pass become the voice
exemplars in the narrative prompt (Task 5c).

---

## Task 9 — Gates

`npx tsc --noEmit -p .`, `npx eslint src scripts`, targeted vitest per task, and at the end
`npx vitest run src/capsules src/league-room src/projections/decide src/projections/laws
src/projections/vegas src/design`. The known pre-existing failures named in the brief are ignored,
and the report states the counts.

---

## Order and commits

1 → 2 → 3 → 4 → 5 (a-f) → 6 → 7 → 8 → 9, one commit per task (Task 5 in two or three), the
migration generated at the very end so its number lands after the parallel round's.
