# Dossier Voice and Gaps

**Status:** founder direction 2026-09-07, from the McCaffrey page: "there's still a lot of gaps on the page. Why don't we have target share for any player? Why do we still show 'the short version while we write him up'? For every player we say 'last man in his tier', that doesn't mean they shouldn't be drafted. This needs to feel like a human made it and right now it still seems like a bot made it."

## 1. What is wrong, with the cause of each

| What the page shows | Cause, verified in code or data |
|---|---|
| "Target share: not tracked for him" on every player | 2025 is a gap season for the published weekly source, so target share comes from the play-by-play fill, and that fill deliberately leaves the team-target denominator at zero (`populations.ts:302`). No denominator, no share, for everyone. |
| "The short version while we write him up" on most players | 457 of 659 board players still carry the template capsule; only 202 have the written one. The regeneration of the rest was parked in early September and the nightly sweep at its batch size has not caught up. |
| "He is the last man in his tier" on many players, including McCaffrey, who is fifth of eight in his tier | Two faults. The tier-cliff reason fires when three or fewer players remain in a tier (`TIER_IS_THIN_AT = 3`) but the sentence says "last man" whenever the count is one, and the stored board reasons were computed under the OLD median-gap tier rule, which fragmented tiers into singletons; the board has not been re-persisted since the games-worth rule shipped, so the peek quotes tiers the board no longer draws. Under the new rule a 3.2 point step is inside a tier, not a cliff. |
| "up 12.440000000000001" and ". A real move" | The trend delta is printed unrounded (`role-module.tsx:24`) and the closing sentence is a separate span with a leading period. |
| "Team win total: not posted yet" | Win totals come from a committed, curated file (`data/win-totals/win-totals.csv`, sourced from nfelosrs). The file DOES carry 32 rows for 2026; the ingest that writes them into the observation store was never run against production (production holds no `vegas_win_totals` observations at all). |
| The verdict reads the same on every player ("let someone else pay it") | The lead is a template with three market branches and one tier clause. It is grounded, but it has no voice and it repeats. |

## 2. Goal

The peek and the player page read as if a sharp human analyst wrote them for this player: the lead is his sentence, not a branch; every module that can be filled from data we hold is filled; the numbers are formatted like a person would format them; and nothing on the page is stale relative to the board it sits beside.

## 3. Design

### 3.1 Target share from the play-by-play feed

The play-by-play player feed already carries targets per player per week. Team targets for a team-week are the sum of those across the team's players that week, which is exactly the denominator the published source provided. The gap-season fill computes it (`teamTargets` from the same rows, grouped by team and week through `player_week_teams`), and target share resolves for every player with a target. The fill's docblock loses its "no team targets" clause and gains the derivation. Honesty: a week whose team-target sum is zero (no pass attempts recorded) yields no share for that week, never a divide-by-zero or an invented figure. Test: a fixture with three receivers on one team asserts each share and that the shares sum to one.

### 3.2 The written capsule for everyone

Regenerate the capsule for every board player still on the template, once, now (about 460 players at the measured per-capsule cost, roughly a dollar), then raise the nightly sweep's batch so the board never drifts back to templates. The template fallback copy changes from a promise ("while we write him up") to a plain statement of what it is: "A summary from the numbers. The written read is on its way." The template text itself gets a persona pass so its sentences do not read as filled-in blanks (the red-zone clause "22.7% red-zone touch share is worth -6.4 points a game" states a law effect with its sign and no explanation; the template should say what the law found in words, as the written capsule does).

### 3.3 The tier clause tells the truth

- The reason fires only at a real tier break: `dropToNextTier` at least a game's worth of the player's own projection (the same share the tier rule uses, `TIER_BREAK_GAMES / GAMES_PER_SEASON`), never on a within-tier step.
- The sentence states the count it has: "Two left in his tier before a 20.9 point drop." "Last man" appears only when the count is one.
- The clause never leads the verdict. The lead is the market call or the per-game story; the tier clause follows when it exists.
- The board is re-persisted after 3.1 lands, so stored reasons, tiers, and the new touches and target shares agree with what the board draws. The persist diffs stored reasons before and after and the diff is recorded in the ledger (the peek-facts review asked for exactly this).

### 3.4 Numbers like a person writes them

The trend delta is one decimal. The closing sentence joins its predecessor with a space, not a leading period. A sweep across the dossier modules for any `${number}` interpolation without a formatter, each fixed at the source with a test that renders a value like 12.440000000000001 and asserts one decimal.

### 3.5 Every sentence is written, every number is stated

**Founder amendment 2026-09-07:** "We should use the LLM to make every part of the player peek feel dynamic and alive like a real person is writing it. Unless it's simply displaying a stat."

The rule: a module that displays a statistic (a rank, a share, a range, a per-game figure, a game log) states it from the engine, formatted like a person would. A module that says something in a sentence gets that sentence from the writer. Today those sentences are templates with branches: the verdict lead, the per-game line ("Per game he projects like a RB8. The question is games"), the trend sentence, the why-group explanations, the story module, the books line, the tier clause, the absence notes. Each one becomes a named narrative slot.

**The narrative.** The capsule engine (`src/capsules/`) generates, per player, one structured artifact alongside the compact and full reads: a JSON object of named slots, each a short sentence or two: `call` (the lead), `perGame`, `trend`, `whyGroups` (one per evidence group, keyed by group id), `story` (last season, when a story exists), `books` (market and win total), `tier` (when a real break exists), and `absence` notes for the modules that have nothing (a rookie's missing history, a kicker's missing capsule) so even absence is said in a human voice. One prompt, one gateway call per player, the same facts ledger the reads use plus the market gap, tier standing, trend deltas and group effects the modules already compute.

**The validator holds every slot** to the rules the reads already obey: every name and number must appear in the facts (no invention), a word band per slot (the call at most 30 words, module sentences at most 40), no banned vocabulary, no em-dashes, no semicolons, no competitor names, no tips. A slot that fails validation is absent, and the module falls back to the templated sentence for that slot only. The template sentences stay as the honest floor; they are never shown when a validated slot exists.

**Alive, not stock.** A repetition check runs over the whole board after each sweep: any sentence (normalized) that appears on more than a configured share of players (`CAPSULE_CONFIG.repetition.maxShare`, start at 2%) is flagged, the offending players' narratives are queued for regeneration with the flagged sentence named in the prompt as one not to reuse, and the count is reported by the sweep. The prompt is instructed to write from the player's specific situation (the new play caller, the injury he is returning from, the tier he sits in, the market's disagreement) rather than a generic frame, and it is given two exemplars of the voice from the persona pass.

**Storage and events.** The narrative is stored with the capsule (one JSONB column, generated migration) with its `factsHash`, so it regenerates exactly when the reads do (the nightly sweep, the capsule-written event, the facts-written event) and the peek document round's writers pick it up as one more input. Modules read the slot through one accessor, `narrativeSlot(capsule, key)`, which returns the validated sentence or null; no module reaches into the JSON itself.

**Rendering.** Each module renders the slot when present, its template otherwise, and never both. The numbers a module displays stay exactly where they are; the writer never replaces a stat, it accompanies it.

### 3.6 Win totals for 2026

The committed file already holds all 32 teams for 2026. The immediate fix is operational: run the existing win-totals ingest against production once. The round then removes the manual step for future seasons: the ingest reads the file from its published location (nfelosrs) on the schedule the job system owns (a season-open fetch, then weekly until the season starts), keeping the committed copy as the validated seed. If the publisher has not posted a season, the module says exactly that and the page keeps "not posted yet", which is then true. No manual pulls ([[pfr-account-for-model-inputs]] rules them out).

### 3.7 Persona pass, on real players

Before merge, five players read end to end by the four personas (veteran, casual, commissioner, first-timer): McCaffrey, Nabers, a rookie, a kicker, a team defense. Each sentence that reads as a template, a bare law effect, or a repeated phrase is listed with the change made. The pass is in the ledger and the fixes are in the diff.

## 4. Non-goals

- Changing the projection model, the tier rule, or the market blend.
- New data sources beyond the play-by-play feed we hold and the win-totals publisher we already trust.

## 5. Testing

Target share fixture (3.1); the tier reason threshold and count copy (3.3); the formatter sweep (3.4); the narrative validator per slot (grounding, word band, banned vocabulary, rejection of an ungrounded number), the per-slot fallback, the repetition check flagging a sentence over the share and queueing regeneration, and the render choice for every module (3.5); the win-totals fetch shape assertion and the "not posted" path (3.6); the board re-persist diff recorded (3.3). Gates: tsc, eslint, targeted vitest, design guards, the copy rules on every new string.

## 6. Rollout

Regenerate the templates (one spend, approved by this direction), deploy, re-persist the board once by hand, run the peek-facts and document builds once so the new facts reach the pages, one verification read.
