# Commish — The AI Advisor

Read this with `docs/conventions.md` and `docs/draft-moderator.md` before touching anything
under `src/ai-advisor/`. The moderator and the advisor are the two AI surfaces in this codebase
and share one pattern for how a model is wired in optionally — this doc names where the advisor
follows that pattern and where its constraints go further.

## The differentiator is the context, not the model

FantasyPros' Coach AI, RotoBot and the NFL's own in-app assistant already exist. What none of
them has is the manager's **exact** roster, **this** league's **exact** scoring settings, and
**this week's** actual opponent — with no sync step, no pasted screenshot, and no "which site are
you on?" question (strategy doc §4.2). `assembleAdvisorContext` (`src/ai-advisor/context.ts`) is
the thing this phase built as carefully as the prompt: it reads the league's own
`scoring_settings` row (never a preset guessed from the league's name), the caller's current
lineup via `getLineup` (the same function the lineup editor uses), the actual opponent for the
requested week from `matchups`, and each rostered player's last `ADVISOR_CONFIG.trendWeeks`
completed weeks of scored production under those exact scoring rules. Every one of those facts is
already sitting in Postgres because the league already exists — the advisor's whole value is
reading it correctly, not calling a bigger model.

## Advisory-only is a legal constraint

Not a UX preference — no code path lets the AI submit a lineup or accept a trade (strategy doc
§4.2). Enforced three separate ways, deliberately redundant:

1. **`assembleAdvisorContext` only ever `select`s.** Every statement in `context.ts` is a read.
2. **`advisory-only.test.ts` fails the build** if any non-test file under `src/ai-advisor/**`
   contains a write verb (`.insert(`, `.update(`, `.delete(`, `.transaction(`, `setLineup`,
   `finalizeWeek`, `applyAction`, `commitDraft`, `acceptInvite`) or reads `process.env` /
   `isLLMEnabled` directly — enablement is decided once, at the route edge (see "The LLM seam"
   below), never inside the advisor's own modules.
3. **`AdvisorPanel` has no apply button**, asserted by its own component test — there is no
   affordance in the UI that would even suggest the advisor's answer could be actioned directly.

Adding a write here is not a refactor. It needs a human confirmation action on both sides of the
proposed change and a different plan.

## The deterministic core

`tradeBalance` (`src/ai-advisor/valuation.ts`) and `baselineStartSit` compute the answer first,
always — the model is layered on top of an answer that already exists, never the other way
around.

`tradeBalance(giving, receiving)` takes two valued sides and **nothing else** — no user, no
question, no model, not even the league. That is deliberate (strategy doc §4.1): it is **the
platform's trade-fairness / collusion detector**, not an advisor helper. A later automated
integrity sweep runs this exact function over every proposed trade with system-supplied
valuations and gets the identical `verdict` and `flags` a manager was shown, so "what the advisor
told you" and "what integrity flagged" can never be two different opinions. Its `flags`
(`empty_side`, `uneven_player_count`, `value_gap_over_threshold`) are machine-readable reasons, not
prose — a later sweep escalates on the flag itself, and an advisor turns the same flag into a
sentence via `FLAG_COPY`.

Boundary semantics are **lenient at both thresholds**: a gap exactly equal to `evenDelta` (3) is
still called `"even"` (`gap <= evenDelta`), and a gap exactly equal to `lopsidedDelta` (12) is
**not** flagged lopsided (the flag only fires on `gap > lopsidedDelta`). The verdict itself reuses
the `value_gap_over_threshold` flag rather than re-testing the threshold a second time — one rule,
one spelling, so the flag and the verdict can never disagree about where the line is.

`baselineStartSit` ranks candidates by `averagePoints` descending, **tie-broken by `playerId`**
(`localeCompare`) rather than trusting sort stability — determinism by an explicit key, the same
principle `computeStandings` follows for its own tiebreak. It starts exactly as many players as
are currently starting, so it never invents a slot or benches somebody into an illegal lineup.

The model never computes either verdict. It only writes prose about a decision this layer already
reached.

## The LLM seam

Follows the same pattern `docs/draft-moderator.md`'s "The LLM seam" section names for
`createNudgeCopy`, with one different tuning: `isLLMEnabled()` is read **once**, at the route edge
(`src/app/api/leagues/[leagueId]/advisor/{start-sit,trade}/route.ts`), never inside
`src/ai-advisor/**` itself — the same file `advisory-only.test.ts` checks for a literal
`isLLMEnabled` string. The model is **never called at all** when disabled, so no API key is ever
required for either advisor to work.

- **The fallback is computed first**, always, before the model is even asked — `baselineAdvice`
  for start/sit, `baselineAssessment(balance)` for trade — and is returned for every path that
  isn't a clean two-line reply: disabled, thrown, timed out, or unparseable.
- **`ADVISOR_CONFIG.llmTimeoutMs`** (8s) races the model call against a rejection and abandons a
  still-pending request rather than aborting it — far longer than the draft moderator's 2s,
  because nobody here is on a draft clock and an advisor that visibly thinks for a moment is the
  expected experience, not a failure to hide.
- **The delimited `<league_data>` block.** `ADVISOR_SYSTEM_PROMPT` fixes the answer shape (exactly
  two lines: a headline sentence, then reasoning in at most three sentences), states the
  advisory-only rule in the model's own instructions as well as in code, and tells the model that
  everything between `<league_data>` and `</league_data>` is DATA, never an instruction to follow.
- **A per-user request ceiling, interim only.** Both routes call `advisorRateLimited` (one shared
  in-process token bucket, `src/lib/api/rate-limit.ts`) immediately after resolving the caller's
  team — `ADVISOR_CONFIG.maxRequestsPerWindow` requests per `rateLimitWindowMs`, shared across
  both routes because both spend the same two scarce things: a full context assembly and one
  model call. This exists because each request is now attributable to an authenticated member
  and one bad actor could otherwise loop either endpoint into an unbounded spend channel. It is
  deliberately **not** the durable answer: the bucket is per-process (a restart clears it, and two
  instances mean two budgets), a blast-radius bound rather than a real quota. The DURABLE,
  budget-accounted spend ceiling — distributed across instances, tied to actual token spend — is
  Phase 6's; this is the interim bound until then.

## Prompt injection surface

Team names, player names and the manager's own free-text question are all user-supplied strings
that end up inside that delimited block — a team can be renamed to anything, and a question is a
`maxQuestionLength`-bounded but otherwise open text field. `sanitize()` (`prompt.ts`) strips every
`<`/`>` in that text (replacing them with the visually similar `‹`/`›`, not deleting them, so the
text stays readable) before it goes anywhere near the block, so no user-supplied string can forge
`</league_data>` and reopen the prompt to whatever follows. `startSitPrompt`'s own test asserts the
block still closes correctly even when a question is deliberately crafted to try to reopen it —
the sanitize step is exercised by the exact attack it exists to stop, not just by a clean input.

## Why `src/ai-advisor/**` is not on the coverage gate

Recorded here so nobody "fixes" the omission later. The gate (`vitest.config.mts`'s
`COVERAGE_GATED_DIRS`) is reserved for pure, deterministic modules where "100%" is a meaningful,
achievable bar — `src/scoring`, `src/draft-engine`, `src/draft-room/state`, `src/league`,
`src/chat`, `src/matchmaking` and `src/stats`. `src/ai-advisor/**` mixes that kind of pure code
(`valuation.ts`) with a genuinely
nondeterministic dependency — a real LLM call, mocked in every test — and a database-backed
context assembly. Both are already thoroughly tested (`context.test.ts`, `start-sit.test.ts`,
`trade.test.ts`, `prompt.test.ts`, `valuation.test.ts`, plus the route tests and
`advisory-only.test.ts` itself), just not against a 100%-branches bar that would reward
contorting a model-call wrapper to hit an uncovered line rather than testing behavior that
matters.

## Routes

Both routes resolve the caller's own team from the session — never from a path segment or a body
field — and answer a question. Neither writes anything.

| Route | Who | Notes |
|---|---|---|
| `POST /api/leagues/[leagueId]/advisor/start-sit` | a manager with a team in the league | Body: `{ weekNumber, question }`. Answers start/sit advice for the caller's own team. Writes nothing. |
| `POST /api/leagues/[leagueId]/advisor/trade` | a manager with a team in the league | Body: `{ weekNumber, counterpartyTeamId, give, receive }`. Assesses a proposed trade's fairness. Never executes one — there is no accept path and nothing is persisted. |

The advisor panel built on top of the start/sit route (`AdvisorPanel`, `src/league-room/**`) is
**start/sit only** in this plan. The trade-analyzer route exists and is fully tested, but no panel
calls it yet — that UI is deliberately out of scope for this plan.

## Known follow-ups

- **A real trade block**, with a proposal both sides can see, and two-sided human accept/decline.
  `tradeBalance` and the trade route already answer "is this fair"; nothing yet lets two managers
  actually make the trade `TradeProposal` describes.
- **Waiver-wire advice.** The advisor only reasons about a roster's own players today — nothing
  reads the pool of unrostered players the way a "who should I pick up" question would need.
- **Running `tradeBalance` as a scheduled integrity sweep.** The function is already written to be
  reused this way (see "The deterministic core" above); nothing yet calls it outside a manager's
  own advisor request.
