# Commish — Engineering Conventions

**Read this first** before working on any step of the build plan (`plans/00-roadmap.md`). It is the single source of truth for how this repo is laid out and the rules every step assumes. `docs/design-system.md` is its visual counterpart for anything user-facing.

## Directive: no MVP

The founder's standing direction (2026-08-17): *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away. If a plan step still says "prototype-only" or "stub", read it through this directive.

## Stack (pinned)

| Concern | Choice | Notes |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript strict | `"type": "module"` in `package.json` |
| Database | **Postgres 17** via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver), reached through **PgBouncer in transaction pooling mode** | Pure-JS wire protocol, no native compilation. `prepare: false` is unconditional (transaction pooling gives a client a different backend between transactions). Nothing may rely on session state: no `pg_advisory_lock`, no session `SET`, no `LISTEN`/`NOTIFY`. See `docs/decisions/data-layer-hardening.md`. |
| Real-time | **Redis 7 Streams → Server-Sent Events** | The one and only real-time mechanism. See below. |
| Auth | **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`) — hosted sign-in/up, sessions, MFA, OAuth | We do not roll our own auth. Local `users` row keyed by the WorkOS user id holds app-owned fields. |
| Validation | Zod v4 (`z.email()`, not the deprecated `z.string().email()`) | At every boundary. Zod schemas will also drive OpenAPI generation for native clients (Phase 7). |
| Tests | Vitest + happy-dom + @testing-library/react + vitest-axe | jsdom was dropped (broken ESM/CJS transitive deps across two major versions). |
| Local infra | `docker-compose.yml`: postgres (5432), postgres-test (5433, tmpfs), pgbouncer (6432 → postgres), pgbouncer-test (6433 → postgres-test), redis (6379, AOF everysec) | `npm run infra:up` |
| LLM | `@anthropic-ai/sdk` behind `src/lib/llm/` | Optional — every AI surface must degrade gracefully with no key. |

`docker-compose.yml` pins a top-level `name: fantasy`, so every git worktree of this repo
resolves to the **same** Compose project instead of a `<directory-name>_default` derived from
each worktree's own path — without it, an agent working in a worktree spins up its own
redundant postgres/redis stack on the same host ports. Run `docker compose up -d` /
`npm run infra:up` from any worktree; they all talk to one shared stack.

## Directory map

```
src/
  app/                    Next.js routes. API routes under app/api/**.
  app/app/(shell)/                v2 (Phase 3.6): the route-group layout that renders `AppShell`
                          once (`(shell)/layout.tsx`, `shellData(db, user)`, one round trip) around
                          every page that gets the rail + top bar — the locker room, `leagues/`
                          (list + create form, a league's home + lineup editor, its matchups page),
                          `admin/` and `profile/`. `loading.tsx` (whole-site addendum, Task 21)
                          suspends only the content column here, never the shell the layout is
                          already holding — matched by a `loading.tsx` in `(room)` (the room's own
                          bands) and `(public)/join/[code]` (the public geometry, F7), plus one
                          root `src/app/loading.tsx` for every public page above `/app`. See
                          docs/design-system.md's "Layout" section and docs/decisions/design-v2.md
                          §5 (which carries the same correction).
  app/app/(room)/drafts/[draftId]/       The live draft room (snake + auction) — v2: its own route
                          group, declining `(shell)` entirely, because `RoomRail`'s own full-height
                          header is the room's chrome (docs/draft-room.md).
  app/app/(public)/join/[code]/   The invite-link landing page — v2: its own route group, reachable
                          signed out, so it never receives the signed-in shell.
  app/draft/[draftId]/board/      The read-only large-format TV draftboard — also declines `(shell)`.
  middleware.ts           WorkOS AuthKit session middleware — runs on every non-static request.
  instrumentation.ts      Starts the dev draft ticker singleton once, server-side only.
  domain/                 Pure domain types + pure functions. NO I/O, NO Date.now(). readonly everywhere.
  draft-engine/           Pure draft reducer (snake + auction), clock schedule, selectors,
                          pause.ts (the overnight pause window, Phase 3.5 Task 4 — read only at
                          command/view time in selectors.ts, never by the reducer). 100% coverage.
  draft-service/          Durable replay-based draft store, commit seam, clock ticker, draft authz,
                          queue.ts (SET_QUEUE service seam), nudge.ts/nudge-copy.ts (AI draft
                          moderator — see docs/draft-moderator.md), order.ts (the draw plus the
                          Kentucky Derby slot-assignment step, Phase 3.5 Task 6), slot-preference.ts
                          (the draft-slot-preference table write/read, the KDS input to order.ts's
                          draw — see docs/draft-engine.md).
  draft-room/             The browser half of the draft: pure view reducer (state/, 100% coverage),
                          the useDraftRoom hook (hooks/), every room component (components/), and
                          id→display-name lookups (lib/). Imports from draft-engine are TYPE-ONLY —
                          no draft rule runs in React. See docs/draft-room.md.
  league/                 Pure league rules: schedule generation, standings, clinch, lineup
                          eligibility, invite codes, LEAGUE_CONFIG, roster-shape.ts (superflex,
                          Phase 3.5 Task 1 — describeRosterShape mirrors describeScoring) and
                          median.ts (the league median game, Phase 3.5 Tasks 2-3 —
                          leagueMedian/medianResultFor, folded into standings.ts's win/loss/tie
                          columns only, never pointsFor/pointsAgainst). NO I/O. 100% coverage.
  league-service/         League read/write service layer over Postgres: creation, invites,
                          schedule, lineups, results/standings, fill-trigger.ts (the sit-and-go
                          fill trigger, Phase 3.5 Task 7 — writes drafts.kickoff_at, never starts
                          a draft itself; runs inside join.ts's own transaction), authority.ts (the
                          LeagueAuthority discriminated union — member | house — and
                          isCommissionerOf, Phase 3.5 addendum Task 12), house-factory.ts (the
                          catalog reconciler — ensureHouseCatalog, spawnHouseLeagueInTx — Phase 3.5
                          addendum Task 13), roll.ts (rollUnfilledDraftInTx — the founder's "roll
                          until full" ruling, Phase 3.6 Task 7 — the third writer of
                          drafts.kickoff_at, guarded by a leagues FOR KEY SHARE preamble; see
                          docs/decisions/design-v2.md §6), release.ts (releaseSeat, Phase 3.6 Task 8
                          — the roll's own escape hatch, and the second writer of
                          drafts.fill_fired_at), seat-hold.ts (claimSeatHold/liveHoldsFor, Phase 3.6
                          Task 6 — the front door's ten-minute reservation, expiring by predicate
                          against seat_holds.expires_at, never by a sweeper), and trades
                          (trades.ts — propose/withdraw/reject/accept, trade-transfer.ts — the
                          roster move + locked-week materialization, trade-reversal.ts — the
                          operator's compensating transfer). Consumed directly by app/api/leagues/**
                          route handlers and by app/**/*.tsx Server Components.
  league-room/            The browser half of the league: the create/join/invite client
                          components and the trade surface (components/ — trade-composer.tsx,
                          trade-inbox.tsx, trade-card.tsx, reusing AdvisorPanel's shape), the
                          fetchJson deps seam (hooks/), and id→display-name formatting
                          (lib/format.ts). Imports from league/league-service are TYPE-ONLY — no
                          league rule runs in React; value-imports @/trades directly (pure,
                          browser-safe) for TRADE_CONFIG, describeAsset and isExpired.
  matchmaking/            Pure public-matchmaking rules: the browse filter, the cosmetic stake
                          tiers, MATCHMAKING_CONFIG.sitAndGo (the fill-trigger grace period,
                          Phase 3.5 Task 7), house-catalog.ts (HOUSE_CATALOG, HouseRungName,
                          HOUSE_RUNG_LABEL, houseKickoffFor — the house-league shelf's own
                          declared vocabulary, Phase 3.5 addendum Task 13), roll.ts
                          (describeStartTiming, rollNoticeSentence, ROLL_REFUSALS,
                          PUBLIC_ROOM_SHORT_REFUSAL — the roll's own pure sentence layer, Phase 3.6
                          Task 7, the single authority every surface quotes rather than composing
                          its own start-timing sentence) and seat-hold.ts (SEAT_HOLD_COOKIE,
                          SEAT_HOLD_REFUSALS — SEAT_HOLD itself, the ten-minute duration, lives in
                          this directory's own config.ts, Phase 3.6 Task 6), and
                          PublicLeagueSummary, the field-by-field privacy boundary of the app's ONE
                          unauthenticated league read — seventeen fields as of Phase 3.6 (v2)
                          (heldSeats, rosterSummary, playoffWeeks, kickoffRolls joined the Phase
                          3.5 addendum's medianGame, startTrigger, houseRung and draftAt). NO I/O.
                          100% coverage. Browser-safe, so src/league-room/** value-imports it
                          directly, the same way src/chat-room/** value-imports @/chat.
  identity/               Pure identity rules: AvatarRef parsing over the three ref cases
                          (avatars.ts, eight code presets — no upload, no object store),
                          HelpLevel + the two-field PreferenceState (preferences.ts), the
                          first-run path fork (first-run.ts) and the notification catalog +
                          deliverableChannels() (notifications.ts). NO I/O. 100% coverage.
  identity-service/       Profile read/write service over Postgres: updateProfile (the one
                          write path for displayName/experienceTier/avatarUrl, PATCH
                          /api/profile) and the user_preferences seed-then-write pair
                          (GET/PATCH /api/preferences).
  help/                   The ONE glossary registry (GLOSSARY, term()) and its HELP_CONFIG
                          tunables. NO I/O. Browser-safe for the same reason as @/chat and
                          @/matchmaking; InfoTip (src/components/ui/info-tip.tsx) is what
                          actually value-imports it.
  reviews/                Pure review-feed rules: ReviewView/ReviewsPage (contract.ts),
                          REVIEW_CONFIG and validateReviewDraft, the SAME rule the Zod
                          boundary and the composer's live character count both enforce. NO
                          I/O. 100% coverage.
  review-service/         Review read/write service over Postgres: listReviews (the
                          rating-never-SELECTed feed query), submitReview (insert-or-edit on
                          the userId unique index), reportReview and removeReview (the
                          no-re-stamp removal write). Consumed by /api/reviews/** and by
                          scripts/remove-review.ts.
  account-room/           The browser half of the profile/account surface: the profile form,
                          the avatar picker, the notification summary, the review composer
                          + feed, the theme switcher (Phase 3.6), and the wallet surface
                          (Phase 4, Task 12: wallet-panel, deposit-form, withdrawal-form,
                          kyc-panel, exclusion-panel, money-copy.ts — dark behind
                          moneyIsLive(), every figure a ledger query or absent). Reaches
                          @/identity-service, @/review-service and @/money-service only over
                          the wire; value-imports @/reviews directly (pure, browser-safe) for
                          the composer's live character count and @/money for the shared
                          refusal sentences, bounds and formatUsd. See "Client boundary" below.
  integration/            Cross-module proofs: a real draft, run through the real store, into
                          real standings, chat, advisor and browse reads. Test-only.
  chat/                   Pure chat fold + wire contract + CHAT_CONFIG. NO I/O. 100% coverage.
  chat-service/           Chat read/write service over Postgres: postMessage, paginated
                          listMessages, toggleReaction, each publishing on the league stream.
  chat-room/              The browser half of chat: the useLeagueChat hook, the deps seam and
                          every chat component. Mounted by BOTH the league room and the draft
                          room. Value-imports @/chat directly (pure, browser-safe); reaches
                          @/chat-service only over the wire — same ESLint client boundary as
                          draft-room/league-room. See docs/chat.md.
  ai-advisor/             The advisory layer: read-only league context assembly and the
                          start/sit + trade advisors over src/lib/llm. Writes NOTHING — a legal
                          constraint, enforced by advisory-only.test.ts. `valuation.ts`
                          re-exports src/trades/fairness.ts's tradeBalance identity-pinned
                          (Phase 3 Plan C moved the fairness core out — see docs/advisor.md
                          and docs/decisions/trades-and-fairness.md §2). See docs/advisor.md.
  trades/                 Pure trade layer: TRADE_CONFIG, the lifecycle/status vocabulary
                          (lifecycle.ts), the asset union + describeAsset (assets.ts), the wire
                          contract (contract.ts), and tradeBalance — the platform's ONE
                          trade-fairness / collusion function (fairness.ts), moved here from
                          src/ai-advisor (Phase 3 Plan C). NO I/O, no clock. 100% coverage.
                          Browser-safe: the seventh pure exempt directory, beside src/chat,
                          src/matchmaking, src/identity, src/help, src/reviews and
                          src/moderation. See docs/trades.md and
                          docs/decisions/trades-and-fairness.md.
  participation/          THE THIRD MEANING OF "TIER" (Phase 3 Plan D): participationTier
                          (tier.ts — newcomer/veteran, participationTierFor), TierComposition +
                          compositionCategoryFor (composition.ts, the coarse browse-card bucket
                          the server reduces to before anything ships) and isVerifiedPlayer + the
                          verified-badge copy (verified.ts) — a computed, enforced participation
                          fact, compile-distinct from users.experience_tier (self-reported) and
                          leagues.experience_tier (self-declared). NO I/O, no clock, no database.
                          100% coverage. Browser-safe: the eighth pure exempt directory, beside
                          src/chat, src/matchmaking, src/identity, src/help, src/reviews,
                          src/moderation and src/trades — public-league-list.tsx value-imports
                          TIER_COMPOSITION_LABEL directly. See docs/enforcement.md and
                          docs/decisions/enforcement-and-tiers.md.
  money/                  Phase 4, Task 1: the money vocabulary, pure and browser-safe.
                          MONEY_CONFIG (config.ts — the entry-fee ceiling, deposit/withdrawal
                          floors and ceilings, the tax-year-versioned reporting threshold, the
                          zero reconcile tolerance) and MONEY_REFUSALS, the one closed set of
                          refusal reasons balancedOrRefuse and prizeTableInvariant hand back.
                          MONEY_STATES + moneyIsLive (states.ts — the state-enablement config,
                          EMPTY BY DEFAULT per founder decision 7; neverEligible pins HI/ID/MT/
                          NV/WA, which have never permitted paid fantasy sports; CA sits on
                          neither list pending counsel reconciling the 2025 AG opinion with DFPI
                          guidance). The account vocabulary (accounts.ts — MoneyAccountKind's
                          eight kinds, accountSide, signedBalance, accountIdFor/parseAccountId).
                          The posting vocabulary (posting.ts — MoneyPosting, balancedOrRefuse,
                          the double-entry balance gate every money writer calls before it opens
                          a Postgres transaction). The prize-table invariant (prize-table.ts —
                          PrizeTable, prizeTableInvariant: prizes plus the platform's fixed rake
                          must equal the pot exactly, founder decision 10, never percent-of-pool).
                          NO I/O, no clock, no database. 100% coverage. Browser-safe: the ninth
                          pure exempt directory, beside src/chat, src/matchmaking, src/identity,
                          src/help, src/reviews, src/moderation, src/trades and
                          src/participation. See docs/superpowers/plans/
                          2026-08-24-phase4-money-foundations.md.
  money-service/          Phase 4, Task 3: the money vocabulary's Postgres half — server-only,
                          on the banned value-import list, 100% coverage (gate 23).
                          postMoneyTransaction (post.ts): the ONE writer of money_entries and
                          money_transactions. Balanced set gated by balancedOrRefuse before any
                          statement; leagues row lock FIRST when the posting names a league (the
                          global lock law); money_accounts rollup rows ensured and locked FOR
                          UPDATE in sorted account-id order; the balance floor refuses (never
                          clamps) for player-facing kinds under that lock; idempotency_key
                          replays answer the committed outcome (unique-index backstop caught
                          under a savepoint); state_of_entry and tax_year stamped on every leg
                          per founder decision 6; audit append in the same transaction, anchor
                          last (rulings 3 and 4). The reads (read.ts): walletSummary,
                          accountBalance, getUserAnnualNetProfit — every figure a SUM over
                          money_entries, never the rollup. test-support.ts:
                          expectNoPostingTookPlace, asserted on every refusal path of every
                          money writer, plus the property harness. The writers around it
                          (Tasks 5-11): gates.ts (moneyGates — state enablement, KYC,
                          self-exclusion, receivable — the ONE choke point every money door
                          calls), deposits.ts (nothing posts until completion; the ACH-return
                          clawback with its platform_receivable shortfall; receivable
                          settlement), withdrawals.ts (debit at request; netting an owed
                          receivable before anything reserves — the Task 6 ruling),
                          entry-fee.ts (collectEntryFeeInTx/refundEntryFeeInTx, run inside
                          joinLeagueInTx/releaseSeat's own transactions), kyc.ts +
                          exclusion.ts (the two compliance flag writers, each chain-audited
                          per the Task 7 ruling), dissolution.ts (operator-only, pre-draft
                          only, every seat refunded in one transaction), settlement.ts
                          (operator-triggered payout against the STORED prize table, escrow
                          to exactly zero, holds for flagged winners; its hold outcomes are
                          the THIRD publisher of admin_action, beside grantAdmin and chat
                          moderation — superseding Phase 3 Plan B ruling 15's two-publisher
                          enumeration, per the Task 10 ruling), reconcile.ts (the four
                          drift checks, level-triggered, no scheduler) and schemas.ts (Zod
                          bounds derived from MONEY_CONFIG, never retyped). See
                          docs/money.md and docs/decisions/money-foundations.md.
  payments-provider/      Phase 4, Task 4: Seam A — the EXTERNAL money seam, server-only, on the
                          banned value-import list, 100% coverage (gate 24). contract.ts (the
                          PaymentsProvider interface: ensureAccount, initiateDeposit/
                          initiateWithdrawal with a required idempotencyKey, getTransferStatus
                          pending/completed/failed/returned, fee+ETA MethodDescriptors,
                          getPooledBalanceCents — external money motion ONLY, no ledger concept
                          crosses the seam in either direction), config.ts + registry.ts
                          (PAYMENTS_PROVIDER selection, fail-fast on an unknown name; only mock
                          exists — real rails are founder-gated and must pass the contract suite
                          first), contract-suite.ts (the suite every implementation passes,
                          ACH returns-after-completion mandatory), mock/ (in-memory rail on an
                          injected Clock: pending settles on advance(), typed declines,
                          triggerReturn flips completed to returned and queues a signed
                          callback), ingest.ts (the ONE ingestion point: HMAC verify, Zod-strict
                          parse, typed PaymentsEvent out — Task 5's webhook route consumes it),
                          and the KYC seam beside it (Task 7, ruling 4's argument: different
                          vendor and timeline than the money rail, same registry machinery) —
                          kyc-contract.ts, kyc-registry.ts (KYC_PROVIDER selection, fail-fast),
                          kyc-contract-suite.ts and mock/mock-kyc-provider.ts. registry.ts also
                          holds getSharedPaymentsProvider(), the ONE process-wide instance every
                          wallet/admin money route reads (Task 12 — per-route instances made a
                          mock deposit invisible to reconciliation).
  scoring/                Pure fantasy-scoring engine: computeFantasyPoints/scoreLineup, every
                          preset (PPR/standard/K-DEF/TE-premium). NO I/O. 100% coverage.
  stats/                  The stats seam. provider.ts (the interface: listPlayers, listGames,
                          getGameStatLines, getWeeklyStatLines, and the request-cost table),
                          config.ts + registry.ts (STATS_PROVIDER selection, fail-fast on an
                          unknown name), test-support.ts (the contract every implementation
                          passes), mock/ (the fixed 2026 dataset) and tank01/ (the live adapter,
                          tested against committed fixtures). See
                          docs/decisions/stats-provider-adapter.md.
  stats-pipeline/         The live-scoring ingestion worker: the request-budget ledger, the
                          delta-diff snapshot, the affected-roster resolver, persistTick, the
                          score/reference caches and the worker loop itself. 100% coverage. See
                          docs/decisions/live-scoring-pipeline.md.
  gifs/                   The GIF seam. provider.ts (GifResult/GifProvider + GifSearchBody),
                          config.ts + registry.ts (GIF_PROVIDER selection, "none" → null,
                          fail-fast on an unknown name), test-support.ts (the contract every
                          implementation passes) and giphy/ (the real adapter, tested against
                          committed fixtures — mirrors stats/tank01/ exactly). Consumed by
                          GET /api/gifs/search and by the chat route's GET, which sets
                          ChatPageBody.gifSearchEnabled from createGifProvider() !== null.
  integrity/              Pure audit + moderation-queue rules: the hash chain (chain.ts —
                          linkEvent, verifyLinkedRun, computeEventHash, normalizeInstant), the
                          canonical rejecting encoder (canonical.ts), the member-visible activity
                          allowlist + renderers (activity-view.ts), the system-action visibility
                          table (system-actions.ts — SYSTEM_ACTION_VISIBILITY, the fourth
                          deny-by-default dimension; it subsumed the third,
                          SYSTEM_ACTION_SUMMARY_ALLOWED, a plain boolean now DERIVED from it —
                          Phase 3 Plan D), the notice copy registry (notices.ts —
                          NOTICE_TEMPLATES, distinct from identity/notifications.ts's topic
                          catalog), the dispute-queue vocabulary (flags.ts — FlagType,
                          ResolutionDecision, DECISION_OWNER), the admin-only field set
                          (queue-view.ts, the deliberate opposite number of activity-view.ts), the
                          three multi-account similarity heuristics (similarity.ts —
                          deviceSimilarity/ipCorrelation/behavioralSimilarity,
                          multiAccountSuspicion) and INTEGRITY_CONFIG. NO I/O. 100% coverage. See
                          docs/decisions/audit-and-integrity.md and
                          docs/decisions/operators-and-moderation.md.
  integrity-service/      Audit + moderation read/write service over Postgres: AuditLogger
                          (record/recordAll, the one way anything writes an audit event),
                          verifyChainIntegrity/verifyFullChainIntegrity,
                          notifyAffectedMember/deliverNotice/listNotices/markNoticesRead
                          (listNotices returns the newest INTEGRITY_CONFIG.notices.inboxSize
                          (20) rows and takes no cursor — the cap is stated on the inbox
                          surface, history past it is backlog HIGH, see
                          docs/research/2026-08-23-backend-gaps-backlog.md row 1),
                          listLeagueActivity (the member-visible feed's read side), grantAdmin
                          (grant-admin.ts, the ONLY writer of users.is_admin), raiseFlag/
                          resolveFlag/listPendingFlags/flagDetail (flags.ts, the dispute queue's
                          own read/write seam), sweepLeagueForMultiAccounts/canonicalPairId
                          (multi-account.ts, the detector) and evaluateTradeBeforeExecute/
                          raiseTradeFairnessFlag/sweepUnflaggedTrades (trade-fairness.ts, the
                          in-transaction score and the after-commit flag — Phase 3 Plan C, see
                          docs/decisions/trades-and-fairness.md §6). Consumed by src/draft-service/**,
                          src/league-service/**, src/review-service/**, src/identity-service/**,
                          src/chat-service/**, src/lib/auth/**, src/app/** and
                          scripts/verify-audit-chain.ts, scripts/grant-admin.ts,
                          scripts/sweep-multi-account.ts, scripts/correct-stat-week.ts. See
                          docs/decisions/audit-and-integrity.md and
                          docs/decisions/operators-and-moderation.md.
  moderation/             The one closed report/removal reason vocabulary (config.ts —
                          MODERATION_CONFIG.reasons) and its two renderers (removal.ts —
                          removalPhraseFor for reviews, chatRemovalPhraseFor for chat). Pure,
                          I/O-free, browser-safe — the single source both a review report and a
                          chat report pick from; src/reviews/config.ts re-exports it so the diff
                          at every existing consumer is zero. NO I/O. 100% coverage. See
                          docs/decisions/operators-and-moderation.md §8.
  db/                     schema.ts (Drizzle, pg-core: users, user_preferences, leagues
                          (season_completed_at, the one-way season-completion stamp, Phase 3
                          Plan D; entry_fee_cents/platform_fee_cents/payout_table, Phase 4),
                          teams, league_invites, scoring_settings, roster_slots, lineup_slots,
                          drafts, draft_slot_preferences, draft_actions, draft_nudges,
                          draft_picks, weeks, matchups, players, player_stat_lines, stat_weeks,
                          chat_messages, chat_message_reports, chat_reactions, reviews,
                          review_reports, audit_events, audit_chains, audit_chain_checkpoints,
                          member_notices, integrity_flags, session_signals, trade_proposals,
                          seat_holds, and Phase 4's money four — money_accounts,
                          money_transactions, money_entries (append-only by trigger, migration
                          0035) and payment_transfer_intents), client.ts (createDb/getDb),
                          test-db.ts
  lib/
    env.ts                envOr/envOrUndefined — the ONE place an optional env var is read with a
                          fallback. `.env.example` ships some vars as empty lines and dotenv reads
                          those as "", which `??` does not fall back on.
    auth/                 current-user.ts (server identity seam over WorkOS), user-sync.ts (profile upsert)
    leagues/              membership.ts — resolveLeagueMembership/requireLeagueMember, the one
                          seam every league route's auth+membership gate goes through.
    realtime/             publish.ts, subscribe.ts, sse.ts, redis.ts, publisher.ts, events.ts, config.ts
    api/                  respond.ts — the JSON envelope + parseJson boundary validation
    display/              id→display-name lookups (teamsById/playersById/teamName/playerName),
                          re-exported from src/draft-room/lib/lookups.ts. Draft-room-only: the
                          league room renders names straight off the server-shaped view instead.
    llm/                  client.ts (createLlmClient/getLlmClient/isLLMEnabled/
                          LlmUnavailableError) — shared Anthropic client. Optional: every
                          AI surface degrades gracefully with no key.
  data/seed/              the ONE seeding entry point (`npm run seed`); later steps add seeders here
  design/                 tokens.ts → generated tokens.css, ThemeProvider, motion/reduced-motion
                          hooks — see design-system.md.
  components/ui/          shared primitives (Button, Input, Card, Badge, PositionBadge, SlotChip,
                          PageTitle, Table, Celebration, Avatar, Modal, ToastProvider, Select,
                          Skeleton, EmptyState, ErrorState, Icon, Countdown — the ticking-clock
                          primitive, extracted at its third caller, Phase 3.5 Task 8, …, and v2's
                          five (Phase 3.6 Task 3, each extracted at its own second caller) — Panel,
                          Crest, SeatMeter, Meter, StatPill) — see
                          design-system.md.
drizzle/                  generated SQL migrations (committed)
docs/                     conventions.md (this), design-system.md, draft-engine.md, draft-room.md,
                          draft-moderator.md, league.md, research/, decisions/ (architecture
                          decision records — audit-and-integrity.md, operators-and-moderation.md,
                          enforcement-and-tiers.md, formats-and-lobby.md — Phase 3.5's toggles,
                          the median's storage split, the pause/skip asymmetry, the KDS snapshot
                          argument and the fill trigger, house-leagues.md — the Phase 3.5 addendum:
                          the nullable-commissioner schema, the authority union, the catalog
                          reconciler, design-v2.md — Phase 3.6's own closing record: the theme
                          reversal, the retone's contrast corrections, the roll's start predicate,
                          the seat hold's Postgres argument, design-v3.md — Phase 3.7's Sunday
                          Standard record, money-foundations.md — Phase 4's own closing record,
                          and the two FOUNDER-GATED application packs,
                          column-fbo-application.md + payments-gateway-application.md, prepared
                          but never submitted, each ending in a blank founder sign-off line),
                          money.md — the money system's own doc: the two seams, the four laws,
                          the posting flows, the closed-loop product law and THE MONEY-LIVE
                          CHECKLIST (the single place the money-live task starts from)
scripts/                  Operator-run CLIs, never imported by src/**: seed (npm run seed),
                          audit:verify (verify-audit-chain.ts), reviews:remove
                          (remove-review.ts), admin:grant (grant-admin.ts, the only door
                          users.is_admin opens through), integrity:sweep
                          (sweep-multi-account.ts, the multi-account detector's manual re-run),
                          stats:correct (correct-stat-week.ts, the post-final settlement
                          correction), trades:sweep (sweep-trade-fairness.ts, the
                          trade-fairness detector's manual re-run — see
                          docs/decisions/trades-and-fairness.md §6) and money:reconcile
                          (money-reconcile.ts, the ledger's four drift checks against the
                          bank and itself — level-triggered, no scheduler, see docs/money.md).
                          See docs/decisions/operators-and-moderation.md.
e2e/                      Playwright specs plus the sealed-session global setup (see README).
plans/                    the phase blueprints
```

## Rules

### Immutability
Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let` — see `eslint.config.mjs`).

### Timing — no ambient clock in domain/reducer code
Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).

### Identity — one seam, WorkOS underneath
- **WorkOS AuthKit owns authentication** (credentials, sessions, MFA, OAuth, password reset). We never store passwords or mint sessions.
- Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. Nothing else imports `@workos-inc/authkit-nextjs` for identity — the seam is what lets us swap or extend the provider later.
- `users.id` **is** the WorkOS user id. `/callback` upserts the local row on every sign-in (`user-sync.ts`); app-owned fields (`displayName`, `experienceTier`, `avatarUrl`) are never clobbered by a sync.
- `src/middleware.ts` (composable `authkit()`/`handleAuthkitProxy`): pages under `/app` redirect to hosted sign-in; **API and SSE routes never redirect** — they return a JSON 401 themselves.
- Routes: `/sign-in`, `/sign-up` (hosted, both accept `?returnTo=<path>` — validated fail-closed by `safeReturnTo`, `src/lib/auth/return-to.ts` — and forward it to `getSignInUrl`/`getSignUpUrl` as `returnTo`, which the SDK seals into the callback state and which beats the callback's own `returnPathname: "/app"` fallback), `/sign-out` (POST), `/callback` (unchanged `returnPathname`, plus an `onError` that redirects to `/sign-in/problem`), `/sign-in/problem` (the one screen a failed callback lands on), `GET /api/auth/me`. `SignInLink` (`src/components/app-shell/sign-in-link.tsx`) is the one way any surface renders "sign in".
- **The intent rule:** every sign-in entry point carries the visitor's own intent (`SignInLink`'s `intent` prop → `?returnTo=`), so signing in never loses their place — the two shelf-card links carry `/join/<leagueId>/hold` so a stranger returns to the hold for *that* league. Intent is validated where it redirects (`/sign-in/route.ts`), not re-validated at every link. The one recorded exemption: `SessionNotice` passes `usePathname()` unvalidated (the router's own state has no foreign origin to smuggle) — do not copy that exemption to a caller whose intent comes from a query string or prop. Full decision record and the WorkOS dashboard runbook: `docs/decisions/auth-front-door.md`.
- Env: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` (≥32 chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. Dashboard: Redirect URI `…/callback`, sign-in endpoint `…/sign-in`.

### Real-time — one mechanism
- **Writes are plain HTTP.** Validate → persist to Postgres → then `getPublisher().publish(...)`. Postgres is authoritative; publishing is best-effort and must never fail the write. `AuditLogger`'s append and `notifyAffectedMember`'s notice row are the one deliberate exception to "publishing is best-effort" — see `docs/decisions/audit-and-integrity.md`'s write-ordering ruling: both are inside the caller's business transaction and fail it, and only the Redis frame after that stays best-effort.
- **Delivery is Redis Streams over SSE, on ONE of two key formats.** A league's broadcast is `league:<id>:events`, read by everyone in the room. One user's own events are `user:<id>:events` (`REALTIME_CONFIG.userStreamKey`) — the second key format this product has, and the only one used today, for `notice.created`: a notice about one member ("we removed your review") must never be readable by their leaguemates, so it never rides the league broadcast, not even as a content-free frame (an early version of this did, and leaked which member got a notice to every league subscriber — fixed before it shipped, see the decision doc). Both keys are read with the SAME mechanism — plain `XREAD BLOCK` from a per-connection cursor, the standard `Last-Event-ID` resume, the same publisher. **Never `XREADGROUP`** — consumer groups partition entries across consumers; a draft room needs every viewer to see every pick, and a user's own stream needs every one of their own open tabs to see every notice.
- **Resume** is via the standard `Last-Event-ID` header (the SSE `id:` is the stream entry id). Full-state refetch is the fallback only when a gap outlasts stream retention.
- **Event types** are enumerated once in `src/lib/realtime/events.ts` (`draft.*`, `chat.*`, `score.update`, `notice.created`). Add there, nowhere else. `chat.message`/`chat.reaction` are published by `src/chat-service/chat.ts` and consumed by `useLeagueChat` (`docs/chat.md`); `score.update` is published by the stats-ingestion worker (`src/stats-pipeline/worker.ts`) once per league per tick that changed a player's stats or finalized a week — see `docs/decisions/live-scoring-pipeline.md`. It stayed reserved and unpublished through Phase 1; Plan B is what turns it on. `notice.created` is published by `deliverNotice` (`@/integrity-service/notify`) on the recipient's own user stream, after the transaction that wrote the durable `member_notices` row commits; the frame carries `{ noticeId, noticeType }` only, never the rendered words — `GET /api/notices` is where those come from. See `docs/decisions/audit-and-integrity.md`'s notice-primitive section.
- **Draft events** (`draft.pick`, `draft.nominate`, `draft.bid`, `draft.timer_expire`, `draft.status`, `draft.queue`, `draft.nudge`) ride the **league** stream — there is no per-draft stream. Their payload contracts live in `docs/draft-engine.md`. `draft.nudge` is the one exception to "derived from the action log": it is published directly by the nudge scheduler on the ticker's own schedule, not by `draftEventsFor`. See `docs/draft-moderator.md`.
- **On the browser side there are two consumers:** `useDraftRoom` (`src/draft-room/hooks/`) and
  `useLeagueChat` (`src/chat-room/hooks/`), both built on the SAME native `EventSource` for a
  given league — a draft room mounting the chat band shares one connection to
  `/api/leagues/[leagueId]/events` between the two hooks rather than opening two. The sharing
  lives in `src/event-stream/league-stream.ts`, a ref-counted manager both hooks' `openEventSource`
  factories go through by default; neither hook is aware the connection might be shared. The
  browser's own reconnect and `Last-Event-ID` are the whole reconnect mechanism — **no retry
  loop, no backoff timer, no polling.** A full refetch (`GET /api/drafts/[draftId]` for the
  draft, a chat page refetch for the chat band) is the documented fallback, and fires on a
  sequence gap or a reconnect. See `docs/draft-room.md` and `docs/chat.md`.
- No Socket.io, no managed realtime vendor, no second transport — ever.

### Draft state — the action log is the source of truth
An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure
reducer in `src/draft-engine/`. Any in-memory materialization is a cache and must be safe to
drop at any moment. Every accepted action is persisted before it is cached or published, and
`teamId` is always resolved from the authenticated session, never from a request body.
See `docs/draft-engine.md`. `draft_nudges` (keyed on `(draftId, sequence)`) sits beside
`draft_actions` for a different job: it is the AI moderator's durable once-per-turn claim, not
part of replay — see `docs/draft-moderator.md`.

Every accepted action is applied inside ONE transaction holding `SELECT … FOR UPDATE` on the
draft's own row, and the in-memory materialization validates itself against
`MAX(draft_actions.sequence)` before it is trusted. That is what makes "replay the action log"
the single-writer path across any number of app instances, not just across restarts. A row lock
and not `pg_advisory_lock`, because advisory locks are session-scoped and this connection reaches
Postgres through a transaction pooler. The in-process mutex in `src/draft-service/mutex.ts`
remains as an intra-process fast path, not as the safety mechanism.

### Client boundary
Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**` and
`src/account-room/**` is BROWSER code — the pure state reducer/formatters, the hooks, and the
client components that render the draft room, the league room, the chat surface and the profile
surface respectively. Each talks to its service layer ONLY over the wire (`GET`/`POST
/api/drafts/[draftId]*`, `GET`/`POST /api/leagues/**`, `GET /api/leagues/[leagueId]/events`,
`GET /api/gifs/search`, `PATCH /api/profile`, `GET`/`PATCH /api/preferences`,
`GET`/`POST /api/reviews/**`, `GET /api/notices`, `POST /api/notices/read`,
`GET /api/notices/stream`) — never by importing `@/draft-engine`,
`@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`,
`@/review-service`, `@/db`, `@/integrity`, `@/integrity-service`, `@/mock-draft`,
`@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`,
`@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES.
An ESLint `@typescript-eslint/no-restricted-imports` rule (`eslint.config.mjs`'s
`SERVER_ONLY_MODULE_GROUPS`, scoped to `src/draft-room/**/*.{ts,tsx}`,
`src/league-room/**/*.{ts,tsx}`, `src/chat-room/**/*.{ts,tsx}` and
`src/account-room/**/*.{ts,tsx}` only) enforces this — matched against a relative-path spelling of
the same module too (`../../draft-engine`), not just the `@/` alias. `import type` stays
allowed, since sharing a TYPE (e.g. `DraftStateView`, `LeagueSummary`, `ChatMessageView`,
`ProfileBody`, `ApiEnvelope`, or `ScoreUpdatePayload`/`TeamScore` from `@/stats-pipeline/contract`,
which `useLiveScores` — `src/league-room/hooks/use-live-scores.ts` — imports that way) costs
nothing at runtime and is how the client and server sides of the wire stay in sync.

`src/chat/**` is deliberately **not** in that blocked list: unlike `draft-engine`/`league`, it is
pure, I/O-free, browser-safe fold code (`mergeMessages`, `applyReaction`, `CHAT_CONFIG`), so
`src/chat-room/**` value-imports it directly — the same way ordinary domain utilities would be
shared. `@/chat-service` is not imported by `src/chat-room/**` at all (type or value); chat's
service layer is reached only over the wire, the same as every other service module above.

`src/matchmaking/**` is exempt for the same reason as `src/chat/**`: it is pure, I/O-free,
browser-safe rule code (`normalizeBrowseFilter`, `matchesBrowseFilter`, `stakeTierLabel`,
`MATCHMAKING_CONFIG`), so `src/league-room/**` value-imports it directly. Its Postgres half
lives in `src/league-service/browse.ts`, which the existing `@/league-service` ban already
covers. There is no `@/matchmaking-service`, because a second service directory for one query
would be a boundary to maintain rather than a boundary to enforce.

`src/identity/**` joins the same exempt set for the same reason: `parseAvatarRef`/`AVATAR_PRESETS`
(`src/identity/avatars.ts`), `HelpLevel`/`defaultPreferences` (`src/identity/preferences.ts`),
`firstRunPlan` (`src/identity/first-run.ts`) and `NOTIFICATION_CATALOG`/`deliverableChannels()`
(`src/identity/notifications.ts`) are pure, I/O-free rule code with no server module behind them.
`Avatar` (`src/components/ui/avatar.tsx`) is what actually value-imports `parseAvatarRef` today —
every room directory reaches it indirectly through that primitive, the same indirect path
`src/help/**` documents below — but the exemption is what keeps a future direct `firstRunPlan` or
`NOTIFICATION_CATALOG` import from `src/account-room/**` legal too.

`src/help/**` joins the same exempt set for the same reason: `GLOSSARY`/`term()`
(`src/help/glossary.ts`) and `HELP_CONFIG` (`src/help/config.ts`) are pure, I/O-free lookup
code with no server module behind them. Every room directory reaches it indirectly today,
through `InfoTip` (`src/components/ui/info-tip.tsx`) — the one component that value-imports
`@/help/glossary` — but the exemption is what would keep a future direct `GLOSSARY` import from
a room component legal too.

`src/reviews/**` joins the exempt set for the same reason and is reached DIRECTLY rather than
indirectly: `REVIEW_CONFIG`, `ReviewView`/`ReviewsPage` and `validateReviewDraft` are pure,
I/O-free rule code, and `ReviewComposer` (`src/account-room/components/review-composer.tsx`)
value-imports `validateReviewDraft` for its live remaining-character count — the SAME rule
`submitReviewSchema` (`@/review-service/schemas`) enforces at the API boundary, so the number a
manager watches tick down while they type can never be a different number than the one the
server accepts. `@/review-service` is the Postgres half and is on the blocked list above, reached
only over the wire from `src/account-room/**`, same as every other service module.

`src/moderation/**` joins the exempt set for the same reason: `MODERATION_CONFIG.reasons` (the one
closed report/removal vocabulary) and its two renderers are pure, I/O-free rule code, and the chat
report dialog (`src/chat-room/components/report-dialog.tsx`) value-imports it directly for the
reason picker's labels — the SAME closed set `reportMessageSchema` enforces at the API boundary.
It is deliberately **not** part of `@/integrity`, which is blocked (see below): two record types
(a review, a chat message) cannot share a vocabulary that lives inside either one's own directory,
and `@/integrity` reads `node:crypto` and Postgres besides, so it could not be exempt even if the
vocabulary did live there. `integrity`/`moderation` is the same server-machinery-vs-vocabulary split
`docs/decisions/operators-and-moderation.md` §8 names in full.

`src/trades/**` joins the exempt set for the same reason (Phase 3 Plan C): `TRADE_CONFIG`, the
lifecycle vocabulary, the asset union and `TradeProposalView` are pure, I/O-free rule code with no
server module behind them. The real browser VALUE-imports are `TRADE_CONFIG.maxAssetsPerSide`
(`trade-composer.tsx`) and `describeAsset`/`isExpired` (`trade-card.tsx`) — `TradeProposalView` is
an `interface`, reached through `import type`, which needs no exemption. The value-imports are
there for the same reason `ReviewComposer` value-imports `validateReviewDraft` — a client-side bound and a server-enforced
one must read the identical number. It is deliberately **not** part of `@/ai-advisor`, which is
blocked below same as `@/integrity`: `tradeBalance` moved OUT of the advisor directory specifically
because that directory is on the blocked list (`docs/decisions/trades-and-fairness.md` §2), and it
is deliberately **not** part of `@/domain` or `@/league-service` either — `src/domain/trade.ts`
keeps the pure Phase 1 `TradeProposal`/`isBalancedProposal` shapes the advisor already consumed,
and `src/league-service` stays on the blocked list below, reached only over the wire.

`src/participation/**` joins the exempt set for the same reason (Phase 3 Plan D): it is the
eighth pure directory on the list, not `src/domain` (which is under
`eslint-plugin-functional`'s immutability rules and holds types the whole product shares, while a
participation tier's labels and thresholds are one feature's vocabulary) and not `src/integrity`
(which is BLOCKED — see below). `TIER_COMPOSITION_LABEL` and `CompositionCategory`
(`public-league-list.tsx`) are the real browser VALUE-imports, the same "a client label and a
server-enforced rule must read the identical vocabulary" reason every other exempt directory is
on this list. It joins `flag-only.test.ts`'s `INTEGRITY_DIRS` in the same commit it joined this
list, because the directory that decides who is a veteran is exactly the directory somebody would
one day reach for an account action from.

`src/money/**` joins the exempt set for the same reason (Phase 4, Task 1): it is the ninth pure
directory on the list, holding `MONEY_CONFIG`, `MONEY_STATES`/`moneyIsLive`, the account vocabulary
(`MoneyAccountKind`, `accountIdFor`, `parseAccountId`), the posting vocabulary (`MoneyPosting`,
`balancedOrRefuse`) and the prize-table invariant (`PrizeTable`, `prizeTableInvariant`) — no
database, no clock, no I/O. A later task's wallet component and entry-fee creation form
value-import `MONEY_CONFIG.entryFeeCeilingCents` and `moneyIsLive()` directly, the same
"a client-side number and a server-enforced one must read the identical value" reason every other
exempt directory is on this list. Its Postgres half, `src/money-service/**` (Phase 4, Task 3:
`postMoneyTransaction`, the one writer of the money book of record, plus the wallet reads), is on
the BLOCKED list; the external-money seam, `src/payments-provider/**` (Task 4: the
`PaymentsProvider` contract, its registry, the mock rail and the webhook ingestion point, which
holds the signature verification and `node:crypto`), is on the BLOCKED list beside it. A wallet
component value-imports `@/money` and reaches every figure over the wire;
`import type` is how `WalletSummary` crosses.

`src/integrity/**` and `src/integrity-service/**` join the BLOCKED list instead — unlike
`@/chat`, `@/matchmaking`, `@/identity`, `@/help`, `@/reviews`, `@/moderation`, `@/trades`,
`@/participation` and `@/money`, neither half of the audit spine
is exempt, because neither half is actually browser-safe: `src/integrity/**` is pure but reads
`node:crypto` (`chain.ts`'s `createHash`), which has no browser polyfill in this stack, and
`src/integrity-service/**` is Postgres-backed outright. Client code needs neither as a value —
`ActivityRow` (`@/integrity/activity-view`) and `NoticeView` (`@/account-room/contract`) reach
`src/league-room/**`/`src/account-room/**` only as `import type`, because a notice carries the copy
it delivered and an activity row arrives from the service layer already rendered. See
`docs/decisions/audit-and-integrity.md`.

`@/mock-draft` joins the BLOCKED list too (Phase 4.5, Task 1) — not the exempt set, even though
`MOCK_CONFIG` and `MOCK_COPY` (`src/mock-draft/config.ts`) are just as pure and I/O-free as
`@/money`. Two reasons keep it off the exempt side: `MOCK_CONFIG.strategy` (temperature, reach
depth, run-reaction thresholds) is a bot's own playbook, and shipping it into the client bundle as
inspectable data would let a member solve the bot rather than practice against it; and the room's
copy (the practice banner, the bot marker, the swept-room and empty-lobby sentences) reaches a mock
room the same pre-rendered way `NoticeView`/`ActivityRow` do, never a live client-side
`import { MOCK_COPY }`. `src/mock-draft/config.ts`'s own docblock argues this in full.
`src/mock-draft-service/**` (a later task, gate 26) is this directory's Postgres/Redis half and
stays exactly as blocked as `@/integrity-service` always has — one boundary, not two.

A second, simpler layering rule sits beside this one: nothing under `src/**` may import from
`scripts/**` or `e2e/**`. Build tooling and the browser suite may depend on source; source may
not depend on either. Enforced by its own `no-restricted-imports` block in `eslint.config.mjs`.

The rule is deliberately **not** applied to `src/app/**`: pages and layouts there are Next.js
Server Components (`page.tsx`, `layout.tsx`) and route handlers (`route.ts`), which are
allowed — and already do, in this codebase's existing draft and league routes — import
service-layer code (`@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`)
directly; that is the idiomatic Next.js pattern, not a boundary violation. A page can't be
told apart from a client component by its filename alone, so a glob covering `src/app/**`
would either miss real client code elsewhere or wrongly flag a legitimate server import. Any
client interactivity a page needs is a `"use client"` component imported FROM
`src/draft-room/**`, `src/league-room/**`, `src/chat-room/**` or `src/account-room/**`, not
inlined into the page file.
See `docs/draft-room.md` for the draft room's full fetch → SSE → apply → gap → refetch contract.

### API responses
Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. Error strings are user-facing plain language — never raw DB/exception text.

### Config over magic numbers
Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them (`LEAGUE_CONFIG`, `REALTIME_CONFIG`, `DRAFT_QUEUE_CONFIG`, `UI_CONFIG`, …). No inline literals for tunables.

### Tests
- **Test-first.** Every step's tests are written before its implementation.
- Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/scoring`, never by a guessed filename.
- Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`) because they share that DB.
- Coverage threshold: 100% for `src/scoring/**`, `src/draft-engine/**`, `src/draft-room/state/**`, `src/league/**`, `src/chat/**`, `src/matchmaking/**`, `src/stats/**`, `src/stats-pipeline/**`, `src/identity/**`, `src/help/**`, `src/reviews/**`, `src/gifs/**`, `src/identity-service/**`, `src/review-service/**`, `src/integrity/**`, `src/integrity-service/**`, `src/league-service/**`, `src/draft-service/**`, `src/moderation/**`, `src/trades/**`, `src/participation/**`, `src/money/**`, `src/money-service/**`, `src/payments-provider/**` and `src/mock-draft/**` (configured in `vitest.config.mts` with `coverage.include`, so unimported files count as 0%) — twenty-five gated directories, each with both an `include` entry and its own `thresholds` block; an `include` entry with no `thresholds` block measures nothing. The first twelve are pure; `src/identity-service`, `src/review-service`, `src/integrity` and `src/integrity-service` are gated because a whole-branch review found every HIGH finding living in the service layer, which no gate measured — `src/integrity`/`src/integrity-service` are the write path for the audit record this codebase's trust model depends on. `src/league-service` and `src/draft-service` (gates 17 and 18) are gated for the identical service-layer reason; `src/moderation` (gate 19) is pure and gates for the reason every pure directory does; `src/trades` (gate 20) is pure and holds the one fairness function the write path calls inside a transaction, moved out of the coverage-ungated `src/ai-advisor/**` for exactly that reason (`docs/decisions/trades-and-fairness.md` §2); `src/participation` (gate 21, Phase 3 Plan D) is pure and holds the third tier vocabulary that decides who is a veteran, joining two plans early gated `src/league-service`/`src/draft-service`/`src/integrity`/`src/integrity-service` in covering by construction every directory this plan writes into; `src/money` (gate 22, Phase 4 Task 1) is pure and holds the money vocabulary; `src/money-service` (gate 23, Phase 4 Task 3) is Postgres-backed and holds `postMoneyTransaction`, the one writer of the money book of record — the service-layer reason gates 13-18 exist, and more so; `src/payments-provider` (gate 24, Phase 4 Task 4) is Seam A, the external-money boundary — the webhook signature check, the strict callback parse and the mock's return-after-completion machinery are exactly the code whose unmeasured branch is a forged or misread callback; `src/mock-draft` (gate 25, Phase 4.5 Task 1) is pure and holds the mock draft vocabulary — `MOCK_CONFIG`'s tunables and `MOCK_COPY`'s honest, sweep-clean sentences — and gates for the reason every pure directory does, even though (unlike `src/money`) it sits on the BLOCKED side of the client boundary rather than the exempt side; see its own `config.ts` docblock and the client-boundary note above for why. See `docs/decisions/operators-and-moderation.md` and `docs/decisions/enforcement-and-tiers.md`. Verify with an **unfiltered** `npm run test:coverage` — a path-filtered coverage run reports the other gated directories at 0%.

**The gate count stays twenty-one through the Phase 3.5 addendum (house leagues) too.** Every module the addendum adds — `src/league-service/authority.ts`, `src/league-service/house-factory.ts`, `src/matchmaking/house-catalog.ts` — lands inside a directory already on the list above; `src/matchmaking` and `src/league-service` were both gated before this addendum existed, for reasons unrelated to it. No ninth pure-exempt directory and no twenty-second gate were needed because nothing new here is a directory-level concern — see `docs/decisions/house-leagues.md`.

**Phase 3.5 added no gate — the count stays twenty-one.** Every pure module this phase wrote lands inside a directory already gated: `src/league/roster-shape.ts`, `src/league/median.ts` (gate 4); `src/draft-engine/pause.ts` (gate 2); `src/draft-service/slot-preference.ts` and `order.ts`'s KDS extension (gate 18); `src/league-service/fill-trigger.ts` (gate 17). `src/domain` gained one union member (`SUPERFLEX` on `RosterSlotType`) but stays ungated on the same standing reasoning it always has (`docs/decisions/formats-and-lobby.md`'s cross-cutting section): it holds types the whole product shares, a 100% claim over it is separate work, and this phase's one addition there is pinned by tests in the gated directories that actually consume it.

**Phase 3.6 (v2, the design pass) added no new directory and no new gate — the count stays
twenty-one.** Every pure module this phase wrote lands inside a directory already on the list:
`src/matchmaking/roll.ts` and `src/matchmaking/seat-hold.ts`'s browser-safe half (`src/matchmaking`,
already gated), `src/league-service/roll.ts`, `release.ts` and `seat-hold.ts`'s
server-only half (`src/league-service`, gate 17), `src/league/config.ts`'s season boundary
(`src/league`, gate 4). `src/design/**` and `src/components/**` — where every new v2 token, every
new primitive (`Panel`, `Crest`, `SeatMeter`, `Meter`, `StatPill`) and the shell's data seam all
live — stay ungated, unchanged, the same hole ruling 24 of the v2 plan names rather than fixes:
bringing roughly 40 primitives to 100% branch coverage is real, separate work that does not belong
inside the phase rewriting all of them. Naming the hole here is better than a doc that implies it
is closed.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). It authenticates with a sealed WorkOS test-directory session (`scripts/lib/lab-session.ts`), the same seam the screenshot lab uses. There is no dev auth bypass and none may be added. Vitest excludes `e2e/**`, because its default include glob would otherwise collect `*.spec.ts` there. `playwright.config.ts` pins `workers: 1` and `fullyParallel: false`, so every run is one worker walking the suite in one deterministic, alphabetical file order — a real cross-spec ordering dependency, not a latent flake: `mobile-360.spec.ts`'s dispute-queue check depends on `league-lifecycle.spec.ts` having already run and resolved its own flag, sorting first only because its filename does. A spec relying on suite order names the file it depends on in its own comment, the way both of these do; running either spec in isolation (`npx playwright test mobile-360.spec.ts` alone) will not reproduce the count that spec asserts.
- Any step shipping a user-visible surface additionally requires: a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width.

### Copy sweeps
One rulebook, `src/integrity/copy-rules.ts` (`copyViolations`): no em or en dash, nothing accusatory, no passive construction. Four sweeps enforce it, and each covers a blind spot of the others:
- `src/integrity/notices.test.ts` sweeps the stored notice templates, registry-derived from `NOTICE_TEMPLATES`, so a new template is swept the commit it lands.
- `src/integrity/activity-view.test.ts` sweeps the composed activity headlines.
- `src/integrity/rendered-copy.test.tsx` sweeps what a person SEES, per SURFACE — the empty states, the pager labels, the aria-labels, the component's own voice. It is the strongest of the four and the one to prefer. It is also a hand-maintained list of `describe` blocks, and it now drives INTERACTION STATES rather than first paint alone (each decision branch of `ResolutionForm`, with and without a note, plus the submitted state) — the gap that let an em dash ship on a branch that never mounted.
- `src/integrity/room-copy.source.test.ts` and `src/integrity/script-copy.source.test.ts` sweep SOURCE, directory-derived, so a new file is covered the moment it exists: every `.tsx` under `src/chat-room` and `src/admin-room`, and every `console.*` literal under `scripts/`. Blind to composition by construction — a sentence assembled from three variables is invisible to them, which is why they add to the rendered sweep rather than replace it. Shared extraction lives in `src/integrity/test-support.ts`.
- `src/mock-draft/config.test.ts` sweeps `MOCK_COPY` itself, value by value, through `copyViolations` — the mock draft's own named-vocabulary object rather than a rendered surface or a directory scan, the same "check the copy at its one source" discipline as the other three. `copyViolations`'s own forbidden-vocabulary set grew a Phase 4.5 addition beside C3's: `"ai opponent"`, `"smart ai"`, `"learns from"`, `"machine learning"` — no mock-draft surface may claim intelligence or learning a bot does not have, enforced by the same rulebook and the same four-plus sweeps rather than a second implementation.

**Known limitations, accepted.** The source scans read literals, not renders, so runtime-composed copy is only covered where it is composed. Scripts are swept on their `console.*` output only: a script's `throw` and `Error` strings are developer-facing and deliberately out of scope. `src/app/app/admin/admin-routes.test.ts`'s route-tree tripwire is a TEXT GREP over file contents — a file under the admin tree that merely mentions `withAdmin(` in a comment passes ungated, and it reads only those two directories, so admin capability introduced elsewhere would not be seen (verified clean by hand at Phase 3 Plan B; `resolveFlag`, `flagDetail`, `listPendingFlags` and `grantAdmin` each have exactly one production caller, all gated or CLI).

### Migrations
`ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy, as in `drizzle/0001`); once deployed, add with a DEFAULT or backfill in a separate migration.

**Index rebuilds hold ACCESS EXCLUSIVE, and nothing in this repo uses `CONCURRENTLY`.** A `DROP INDEX` + `CREATE INDEX` pair (as in `drizzle/0029_draft_due_scan_index.sql`) locks the whole table for the duration of the rebuild, blocking every reader — including the draft ticker's every-tick scan. This is a repo-wide property, not a property of any one migration: drizzle-kit runs each migration inside a transaction and `CREATE INDEX CONCURRENTLY` cannot run inside one, so no migration here can express it. Acceptable today because no deploy has happened yet and every table is small. **Named for the deploy era:** once there is production data, an index rebuild on a hot table is a runbook step, applied by hand outside drizzle-kit (`CREATE INDEX CONCURRENTLY` under the new name, then `DROP INDEX CONCURRENTLY` the old one, then a no-op migration to bring the generated SQL back in line), never a migration run against a live database.

**Adding a validated CHECK constraint scans the whole table, same ACCESS EXCLUSIVE story as an index rebuild.** `drizzle/0032_house_leagues.sql` (Phase 3.5 addendum, Task 12) drops `leagues.commissioner_user_id`'s `NOT NULL` (metadata only — Postgres clears `pg_attribute.attnotnull`, no table rewrite, but still `ACCESS EXCLUSIVE` for the length of a catalog update) and adds `leagues_house_commissioner_ck` with a plain `ADD CONSTRAINT ... CHECK (...)`, which Postgres validates against every existing row before accepting it. Both are trivial today because no deploy has happened yet and `leagues` holds seed rows only. **Named for the deploy era:** once there is production data, a new CHECK on a hot table is a runbook step split across two migrations — `ADD CONSTRAINT ... CHECK (...) NOT VALID` (which only blocks NEW writes and takes no long scan) followed by a separate `VALIDATE CONSTRAINT` (which scans the table but takes a lighter `SHARE UPDATE EXCLUSIVE` lock, not `ACCESS EXCLUSIVE`) — never the single validated form run against a live table.

### Commits
Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.

### Environment
`.env.example` is committed; `.env.local` is gitignored. Required: `DATABASE_URL`, `REDIS_URL`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`; test-only: `TEST_DATABASE_URL`, `TEST_PGBOUNCER_URL`; optional: `ANTHROPIC_API_KEY`, `STATS_PROVIDER` (default `mock`), `TANK01_API_KEY` + `TANK01_SEASON` (only when `STATS_PROVIDER=tank01`), `MOCK_STATS_LIVE_WEEK` (only when `STATS_PROVIDER=mock`), `STATS_INGESTION_MODE` + `STATS_POLL_INTERVAL_MS` + `STATS_MONTHLY_REQUEST_BUDGET` (override `STATS_INGESTION_CONFIG`'s defaults), `PAYMENTS_PROVIDER` + `KYC_PROVIDER` (both default `mock` via `envOr`; only `mock` exists this phase — a real rail's name is founder-gated on passing the contract suite unchanged, and an unknown name fails fast, never falls back). Fail fast with a clear message when a required var is missing (see `db/client.ts`, `realtime/redis.ts`).

## Verification commands (every step)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
