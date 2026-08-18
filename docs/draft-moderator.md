# Commish — The AI Draft Moderator

Read this with `docs/draft-engine.md` (the queue and event contracts) and `docs/draft-room.md`
(how the client shows any of this) before touching `src/draft-service/nudge*.ts`,
`src/draft-engine/queue.ts`/`selectors.ts`'s `bestAvailableFor`, or
`src/draft-room/components/{room-dock,nudge-banner}.tsx`.

## What it replaces

Apex staffs its public drafts with a live human moderator for the first two rounds
specifically, whose job is to pause the clock and personally chase down members who miss
their pick (strategy doc §4.1) — a real headcount cost that doesn't scale past whoever's on
shift, and has no defined behavior past round two. The wedge is to replace the **role**, not
just the mechanism: an agent present in every draft, every round, that nudges a slow drafter
before their timer runs out and escalates to a pre-set ranked queue (autopick) only if a
manager truly never responds — at zero marginal staffing cost and unlimited concurrency. This
plan builds that role in two halves: the queue (what the moderator escalates to) and the
nudge (what it says beforehand).

## The queue is a `SET_QUEUE` action, not a side table

A team's autopick queue is `SET_QUEUE { teamId, playerIds }` (`src/draft-engine/action-schema.ts`),
appended to the same `draft_actions` log as every pick, nomination and bid. It is **in the
log, not beside it**, for the same reason every other draft decision is: `draft-engine`'s
invariant 1 is that `reduceDraft` is total and pure, and invariant "the action log is the
source of truth" (`docs/conventions.md`) means replaying `draft_actions` from scratch must
reproduce the exact same draft, including which player autopick would have taken at any
point. A queue stored in a separate, mutable table (rather than a versioned entry in the same
append-only log) would let two draft rows disagree about what a team's queue *was at pick 7*
after the team edited it at pick 9 — the replay would silently use today's queue instead of
the one that was actually in force. `state.queues[teamId]` (`queueFor`, `src/draft-engine/selectors.ts`)
is derived by replay exactly like `rosters` or `budgets`.

`setTeamQueue` (`src/draft-service/queue.ts`) is the one service-layer seam: it validates the
submitted player ids exist (the engine can't check against `state.pool` before `START_DRAFT`
snapshots it, since a queue may be set pre-draft) and then calls `store.applyAction` with a
`SET_QUEUE` action — the ordinary persist → cache → publish path every other action takes, so
a queue edit is exactly as durable and replay-safe as a pick.

## The one autopick path

`bestAvailableFor(state, teamId)` (`src/draft-engine/selectors.ts`) is the single policy for
BOTH an expired snake pick and an expired auction nomination — `reduceSnakeExpiry` and
`reduceAuctionExpiry` each call exactly this, so the moderator's queue plugs into the one
existing autopick path rather than adding a second. Preference order:

1. The team's own ranked queue (`queueFor`) — the first entry that is both still available
   and still legally rosterable (`assignSlot`).
2. `state.pool`'s ranking (the snapshot `START_DRAFT` took) — the first available, rosterable
   entry, for a team with no queue or whose whole queue has already been taken or drafted
   around.

Both inputs are explicit — carried in the action log, never an ambient lookup — so the same
log always autopicks the same player on replay. This is `docs/draft-engine.md`'s invariant 5,
restated queue-first.

## The nudge scheduler

`createNudgeScheduler` (`src/draft-service/nudge.ts`) is the moderator's pacing half: it reads
state and publishes, and never applies an action or touches the clock — which is exactly why
the draft's mechanical outcome is identical with and without it (see "Mechanical parity"
below). `getDraftTicker()` (`src/draft-service/index.ts`) calls `nudger.nudge(state, now)` on
every tick alongside its existing `TIMER_EXPIRE` check — the ticker is the scheduler's **only**
driver; there is no separate cron, no second interval.

- **When it speaks.** `nudgeDeadline(state, thresholdPct)` computes the instant
  `DRAFT_NUDGE_CONFIG.thresholdPct` (75%, the spec's `DRAFT_NUDGE_THRESHOLD_PCT`) of the way
  through the current turn's clock has elapsed. `nudge()` is a no-op before that instant, at or
  after the actual deadline (that is the ticker's own expiry, not the moderator's job), or when
  nobody is uniquely "on the clock" — a live auction lot belongs to everyone, so
  `teamOnClock(state) === null` skips the nudge entirely; **no nudge fires during a live
  auction lot.**
- **Once per turn, durably.** The "have we nudged this turn already" claim is a `draft_nudges`
  row keyed on `(draftId, pickNumber)`, inserted with `ON CONFLICT DO NOTHING … RETURNING`: the
  writer that gets a row back is the one that speaks. An in-memory set would forget across a
  restart and wouldn't be shared with a second instance (see `docs/draft-engine.md`'s
  multi-instance notes); a committed row does neither. A second call for the same
  `(draftId, pickNumber)` returns `"already-nudged"` and publishes nothing.
  The key is the **pick**, not the action `sequence`: `reduceSetQueue` deliberately leaves
  `turnStartedAt` alone while `reduceDraft` still bumps `sequence`, so a sequence-keyed claim
  released mid-turn — any manager editing a queue during somebody else's turn re-armed the
  moderator, which meant duplicate nudges and an attacker-controlled lever on the model spend.
  `pickNumber` advances exactly once per turn in both formats.
- **Best-effort by contract.** Every path through `nudge()` is wrapped so a moderator that
  cannot speak — a DB hiccup, a publish failure — never stops or slows the draft itself; it
  logs via `onError` and returns `"skipped"`.

## The LLM seam

`createNudgeCopy` (`src/draft-service/nudge-copy.ts`) is where the sentence comes from.
`isLLMEnabled()` (`src/lib/llm/client.ts`) is read once, at the edge, in
`src/draft-service/index.ts`'s wiring of the scheduler — the copy function itself never checks
env vars — and the model is **never called at all** when it is disabled, so no API key is ever
required for the moderator to work:

- **The static fallback is computed first**, always, for every path that isn't a clean model
  answer: disabled, thrown, timed out, empty, or longer than `DRAFT_NUDGE_CONFIG.maxCopyChars`.
  `staticNudge` is the sentence that is ALWAYS correct — who, how long, what to do, and what
  happens if they don't act — with or without a model.
- **The timeout** (`DRAFT_NUDGE_CONFIG.llmTimeoutMs`, 2s) races the model call against a
  rejection and abandons a still-pending request rather than aborting it (`AnthropicLike` has
  no abort seam) — one wasted call in the slow case is strictly better than making a manager on
  a clock wait for their own nudge.
- **The delimited prompt.** The system prompt fixes the shape (one sentence, ≤25 words, plain
  language, no emoji/markdown/player advice/questions) and instructs the model that everything
  between `<league_data>` and `</league_data>` is DATA, never an instruction. The user turn is
  exactly that block: `team_name`, `seconds_remaining`, `action_needed` — nothing else.
- **No private data reaches the model or the stream.** The prompt carries a team's own display
  name and its own clock state — never another team's roster, budget, bid, or queue. The
  `draft.nudge` payload published afterward is just as narrow (below): a `teamId` and a
  sentence, nothing that could leak one manager's plan to another.

## The client

Two frames, one client-side rule each (`applyDraftEvent`, `src/draft-room/state/apply-event.ts`):

- **`draft.queue` → sequence continuity, nothing else.** The payload carries only `draftId`,
  `clock`, and `teamId` — the queue's own contents are never on the wire, since a queue is a
  private draft plan (`docs/draft-engine.md`'s event-payload table). Folding it is clock-only,
  exactly like `draft.status`: the view's sequence advances and nothing else about the view
  changes, so a rival's queue edit can never force a resync, and the client's own `queue` state
  — held separately from `view`, loaded with the snapshot and written by `POST /queue` — is
  never touched by any `draft.queue` frame, including an echo of the caller's own edit. The
  route (`POST /api/drafts/[draftId]/queue`) is the only place a queue mutates; its 409 (over
  the room's own `DRAFT_QUEUE_CONFIG.maxLength`) surfaces as a toast the same way every other
  rejected action does — the client enforces no length cap of its own, since duplicating an
  engine value on this side of the wire is exactly the drift `docs/conventions.md` forbids.
- **`draft.nudge` → `NudgeBanner`, for the named team only.** `applyDraftEvent` surfaces the
  parsed notice (`{ teamId, message, sequence }`) without moving the view. `useDraftRoom` keeps
  it only when `payload.teamId` matches the caller's own team — everybody on the league stream
  receives the frame, but only that manager is shown it. `NudgeBanner` renders the server's
  `message` verbatim, `role="status"`/`aria-live="polite"`, only while `nudge.sequence` still
  equals the view's current `sequence` — so it disappears the instant the turn moves on, with
  no timer and nothing to clean up. It is a banner, not a banner *and* a toast: a manager on a
  clock should not have the same sentence announced twice by a screen reader.

## The guarantee `moderator-parity.test.ts` proves

`src/draft-service/moderator-parity.test.ts` runs one identical draft end to end under the
real ticker twice — once with `isLLMEnabled()` true (a mocked model answering), once false —
same fixture, same queue, same clock advances, differing in nothing except where the nudge's
copy comes from. It asserts the two runs produce **exactly the same picks** (including that a
queued player wins an autopick over the pool's best-ranked one), that both runs really did
nudge (so the parity isn't vacuous — the moderator wasn't just skipped both times), and that
the two runs' nudge text actually differs while the "LLM disabled" run's text still contains
the static fallback's own words. That is the mechanical proof behind "the moderator never
applies an action and never touches the clock": whether or not a model is behind the sentence
a manager reads, the draft itself unfolds identically.
