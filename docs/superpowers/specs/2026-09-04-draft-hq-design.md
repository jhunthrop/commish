# Draft HQ — the premium draft preparation suite

**Status:** design for founder review · 2026-09-04
**Mocks:** scratchpad draft-hq set (hub, board, sheet, simulator, assistant, market, playbook), approved-pending
**Author's razor:** every number a manager sees can name the law that produced it. If a surface cannot cite evidence, it does not ship.

## 1. Vision and positioning

Draft HQ is a top-level product section (rail destination `Draft`) that makes Commish the best place on the internet to prepare for a fantasy football draft. The category's incumbents aggregate expert opinion; Commish measures laws against fourteen seasons and shows receipts. The positioning sentence, used everywhere and naming no one: **"Rankings measured from evidence, not averaged from experts. Nothing on this board is an opinion."**

Three structural advantages nothing in the category can copy quickly:

1. **The laws engine.** Backtested effect sizes with a prospective register (accuracy governance already in place: launch 2027, data year 2026 held out). Every ranking is explainable to the decimal.
2. **A real draft engine with need-aware bots.** The same engine that runs live rooms can simulate a full 15-round, 12-team draft headlessly in milliseconds. Instant Monte Carlo over whole drafts is our marquee feature and their impossibility.
3. **The rooms themselves.** Prep flows INTO drafting: the sheet follows you into the room, the assistant is the autopick brain arguing your side, the debrief feeds back into the sheet. Incumbents stop at a browser extension; we own both sides of the glass.

## 2. Information architecture

- Rail gains `Draft` (Leagues · **Draft** · Rooms · Wallet). Prepare in Draft, perform in Rooms. Mock drafts remain in Rooms; Draft's Simulator links into them.
- Sub-nav within the section: **HQ · The Board · My Sheet · Simulator · Assistant · Market · Playbook.**
- Routes under `/app/draft/*` in the `(shell)` group: `/app/draft` (HQ), `/board`, `/sheet`, `/simulator`, `/assistant` (demo/education surface; the live assistant lives in the room), `/market`, `/playbook`.
- Everything is league-aware where a league is selectable: a persistent league context picker (defaulting to the user's next-drafting league) recomputes boards, sims, playbooks under that league's exact scoring and roster rules. A user with no league gets the generic PPR/12-team default with a banner explaining what league context adds.

## 3. The Board — complete feature set

The rankings destination. Reads `src/projections/preseason/board.ts` output, recomputed per league settings.

**Views**
- Overall board; positional boards (QB/RB/WR/TE/K/DEF); rookie board (rookie-reason filter); keeper board for leagues with keeper rules (value = evidence pts minus keeper-round cost).
- Format controls: scoring (from league or PPR/Half/Standard presets), lineup shape presets (1QB/superflex/2QB, TE-premium), team count. League context sets all of these at once and labels the board "computed under {league}'s rules."
- **Auction values**: every board row carries a dollar value for auction leagues, derived from evidence points over replacement normalized to the league's budget (default $200). A `$ board` toggle re-sorts by value; the same values feed the room's auction assistant.

**Row anatomy**
- Rank, face, name (PlayerName → peek), position badge with positional rank, team, bye.
- Evidence points (per-game), **floor/ceiling** (p10/p90 from the availability + variance model, drawn as a compact range bar), market ADP, **Edge** (+/- vs market), strongest-law chip (compact form), `why` opening the full evidence drawer.
- Risk flags: availability (expected games with range), age-curve position, new-play-caller, changed-team — each an icon+word chip only when a law fires, never decorative.

**The evidence drawer (`why`)**
- Every law that fired for the player: headline, measured effect, magnitude, the seasons it was tested against, and its register status. The drawer is the product's soul; it is one press from every row everywhere (board, sheet, sim outputs, assistant, market).

**Utilities**
- Search, tier collapse, position filters, compare-two-players (side-by-side evidence), CSV export of any view, "Add to my sheet" per row and per tier.
- Tier bands computed from `tier_cliff` (players left, drop to next), labeled with the cliff cost.

## 4. My Sheet — complete feature set

The persistent personal cheat sheet. Server-side, one per (user, league) plus a default sheet; follows the user into every room.

**Editing**
- Drag-to-reorder with keyboard support; custom tiers with user-named headers; per-player freeform notes; tags: TARGET, AVOID-EARLY, NEVER-DRAFT (struck through in rooms, muted by the assistant).
- Seed and re-seed from: the evidence board, the user's mock history (existing `sheet-seed` logic), or CSV import (column mapping UI). Manual order always beats the board's; where they differ the row shows both numbers ("you: 6 · board: 5") — the sheet is yours, the evidence never goes silent.
- Multi-sheet: per-league sheets, a format-default sheet, duplicate/rename/delete. Print view (dense, mono, tier-banded, byes and dollar values included) for offline drafts. Export CSV.

**Intelligence on the sheet**
- "What your mocks say": behavioral insights computed from the user's mock history (first-TE round vs value window, most-drafted players auto-suggested as TARGETs, bye-stack warnings across their usual targets). Each insight carries a verb into the Simulator to test the pattern.
- Sheet health: positional balance vs the winning sim shapes for their slot; bye-collision projection; a flag when a NEVER-DRAFT would have been the clear value at their slot (honesty cuts both ways).

**Sync contract**
- The room's SHEET drawer tab reads this sheet live (replacing its client-local state); picks cross off in real time; edits in the room write back. One sheet, two surfaces, zero copies.

## 5. The Simulator — complete feature set (marquee)

Headless Monte Carlo over the real draft engine with need-aware bots, per league.

**Configuration**
- League (brings scoring/roster/team count), your slot (or "find my best slot" mode that runs all twelve), rounds, runs (100/1k/10k), room sharpness (how tightly the room drafts to market ADP: casual reaches, sharp takes the market in order, mixed sits between them; the room always drafts ADP and your own seat always drafts our board, founder ruling 2026-09-05), keeper pre-assignments for keeper leagues, snake or auction mode.

**Outputs**
- **What wins from your slot**: builds classified from the first six rounds (hero-RB, zero-RB, robust-RB, early-TE, late-QB, superflex-QBQB...), each with top-3 finish rate scoring every simmed roster under league rules with evidence projections. Baseline marked; confidence intervals shown at 100 runs, suppressed at 10k.
- **Who is really there at your picks**: per pick, realistic best available, survival odds (from actual sim distributions, not a single ADP), and the fallback plan when they're gone.
- **Exposure report**: across the runs where you followed the assistant, which players you land most — your de facto team before you draft it.
- **Pick-path explorer**: pin a hypothetical ("force QB at 2.06") and re-sim to see what it costs downstream — the "what if" machine.
- **Auction sim**: budget pacing curves that won, nomination strategies, price distributions per player under league budget.
- Save a sim report (named, dated, config-stamped); share into league chat as a card.

**Engineering reality**
- Sim service in `src/draft-service/sim/` reusing the engine + autopick scorer; runs execute in a job (the owned Postgres job system) with a per-user budget and cached results keyed by (league settings hash, board version, slot, sharpness, runs). 1k runs target ≤ 15s on Vercel; 10k runs queue and notify.

## 6. The Assistant — complete feature set

Lives in the live room's right rail (real and mock; the `/app/draft/assistant` page is a guided demo of it with a replayed room).

- **The call**: top three candidates ranked by need + value + laws (the autopick scorer, surfaced with its reasons in words). Every suggestion: effect, law, roster-fit sentence, and **make-it-back odds at your next pick** simmed live from THIS room's actual picks so far (a background micro-sim, not a stale ADP table).
- Run detection ("5 of the last 7 picks were RBs; your tier breaks after X"), tier-break countdown per position.
- Roster shape vs the winning shapes from your slot (sim-informed); bye-collision warnings pick-specifically ("he'd make it four"); stack suggestions (QB+pass-catcher correlations where a law supports them).
- Reach guard: when you hover/press a player far above value, the assistant says what the sims say it costs — once, quietly, never modally.
- **Auction mode**: live budget pacing vs winning curves, max-bid guidance per player from value + remaining budget dynamics, nomination suggestions (players you don't want, priced to drain rivals).
- Post-pick beat: one-line instant grade ("Best available. 3 sims in 4 land Bowers back at you anyway.") feeding the debrief.
- The assistant never auto-acts; it argues. Autopick remains a separate, existing system.

## 7. The Market — complete feature set

- **Edges table**: board rank vs market ADP with 14-day trend sparklines, one-line verdicts that always cite a law ("Age 28.6 on the RB curve costs -1.2 pts the market ignores"). Filters: position, direction, magnitude.
- **Value windows by room sharpness**: measured from this platform's own mock rooms, split by room pick-quality history ("sharp 2.04 · casual 4.01").
- **Watch alerts**: per-player threshold subscriptions ("tell me when his ADP passes 8"), delivered through the existing notices system.
- **The weekly brief**: an auto-generated preseason column from the week's ADP deltas and law agreement/disagreement — deterministic template prose over real deltas (no LLM, no fabrication), reviewed by the copy rules (no em-dashes, no competitor names).
- Data honesty: market ADP requires a real feed (existing market_anchor source) plus our own rooms' pick data. If the feed lapses, the surface says "market data as of {date}" — it never interpolates (no-mock-data rule).

## 8. The Playbook — complete feature set

- Strategy cards (hero-RB, zero-RB, robust-RB, late-QB, early-TE, superflex builds, auction budget splits), each backtested two ways: sims from your slot under your league's rules, and the historical register where applicable. Honest negatives stay ("a strategy that needs luck is a lottery ticket with homework").
- **The slot advisor**: per-slot book for your league — the plan that survived the most rooms, with survival rate; recomputes on slot press.
- Positional scarcity curves drawn from replacement-level data; the K/DEF floor stated plainly every year.
- League-quirk pages generated from settings that move values (2QB/superflex, TE-premium, deep benches): "your league starts 2 QB — here is the whole book on that."
- Every claim links to the sim that produced it (run-it-yourself verb) or the law that grounds it.

## 9. Cross-cutting: player capsules and draft grades

- **Capsules**: every player page gains an auto-written evidence summary over the player's fired laws, availability, market context. Same voice as the assistant. No hand-written hot takes, ever.
  AMENDED 2026-09-04 (founder-approved, Vercel AI Gateway provisioned): capsules are LLM VOICE OVER VERIFIED FACTS, mechanically validated.
  THE PERSONA (founder, same session): a fantasy football expert, never a scientist. Confident, punchy analyst prose in the product's voice ("He's the engine of that offense; the age cliff is real but the volume says one more year") — never lab-report register ("measured effect sizes indicate"). Uncertainty reads as an analyst's honest hedge, not a statistic. This persona binds every LLM-written surface that follows (capsules, weekly brief, grade blurbs).
  IN-SEASON FRESHNESS (founder, same session): capsules update whenever a player's facts change through the season — injury designations and news (the tank01 injury/news snapshots enter the fact sheet), role and usage shifts, market moves. Mechanism: facts-hash caching plus a scheduled sweep; new information moves the hash, the capsule regenerates. A capsule is never a preseason artifact that goes stale. The engine computes every fact deterministically; the model (config `CAPSULE_MODEL`, founder-selected default `zai/glm-5.3-flash` through the AI Gateway, `AI_GATEWAY_API_KEY`) receives only those facts and writes connective prose; a validator then requires every number and name in the output to appear in the input facts and enforces the copy rules (no em-dashes, no competitor names, length caps). One regeneration on failure, then the deterministic template — which remains the permanent floor, so a gateway outage or rate limit never blanks a page or fabricates a word. Outputs cache by input-facts hash; generation runs in the job system. Free-tier note: the gateway throttles this model until credits are added; the job's backoff absorbs it.
- **Draft grades**: after any draft (mock or real), every team gets a grade (value captured vs available, needs filled, bye/stack hygiene) and projected standings from evidence points. Room-wide grade board in the debrief; real leagues get it on league home the morning after. Grades cite their components; the register grades US at season's end on the same page (accountability loop).

## 10. Data model (new tables)

- `draft_sheets` (id, user, league nullable, name, created/updated) and `draft_sheet_entries` (sheet, player, rank, tier label, note, tag enum) — the sheet store.
- `sim_runs` (id, user, league, config hash, status, requested/finished, result jsonb summary) — reports and cache.
- `adp_snapshots` (player, source, format, adp, captured_at) — append-only market history feeding trends/windows/alerts (live-tables rule: append-only archive, current view derived).
- `market_alerts` (user, player, threshold, direction, fired_at nullable).
- Weekly briefs stored as generated documents (id, week, body, inputs hash) for permalinks.

## 11. APIs and jobs

- Read APIs per surface under `/api/draft/*` (board with settings params, sheet CRUD, sim create/read, market edges/windows, playbook per league+slot, capsule per player). All envelope-standard, league-membership-guarded where league-scoped.
- Jobs (owned Postgres job system, never cron/setInterval): nightly ADP snapshot ingest; weekly brief generation; sim execution; alert evaluation on snapshot ingest; post-draft grade computation on draft completion (hooks the existing completion event).

## 12. Accuracy governance and honesty constraints

- Every displayed number traces to: a law (register-governed), the availability model, the sim distribution, or a real market snapshot. No editorial numbers exist in the system.
- 2026 remains the pristine held-out year; boards/sims run on the prospective register's current laws; the register page links from every `why` drawer.
- No fabricated data anywhere: missing market feed degrades with a dated banner; missing projections exclude a player with an honest "not enough evidence" row state.
- Copy rules bind: no em-dashes, no competitor names, UX explains itself without tooltips.

## 13. Phasing (each phase ships whole)

1. **Foundation**: rail + HQ + The Board complete (league-aware, evidence drawer, auction values, exports) + My Sheet complete (store, editor, room sync, print) . The section is real and daily-usable.
2. **The engine**: Simulator complete (snake first, auction second) + sheet/mock insights + Playbook (sim-backed cards, slot advisor).
3. **The room**: Assistant in live rooms (the call, make-it-back, runs, byes) + post-pick beats + draft grades + debrief integration.
4. **The market**: snapshots, edges, windows, alerts, weekly brief + capsules on player pages.

Sequencing note: 2027 launch, 2026 data year — the suite must be complete and register-audited before launch; phases 1-2 this month give the register a full prospective draft season to grade.

## 14. Persona review (pre-registered)

- **Veteran**: lives in Board/Market/Simulator; needs CSV in and out, keyboard sheet editing, 10k runs. Served.
- **Casual**: HQ + the assistant ARE the product; never opens the playbook; needs the 2QB banner to do the thinking. Served.
- **Commissioner**: draft grades and the room-wide board make their league louder; wants the brief in league chat. Served (share verbs).
- **First-timer**: the assistant's plain sentences and the sheet's seeded start are the on-ramp; jargon stays behind `why`. Served.

## 15. Open questions — RULED 2026-09-04 (founder delegated; rulings recorded so the build runs unattended)

1. **Base vs paid: Draft HQ ships in the base product.** Per `docs/research/2026-09-04-draft-prep-market-tiering.md`: free is the acquisition weapon (league-aware board, sheet, mocks, in-room assistant all free); premium anchors later on Simulator depth (10k runs, pick-path, exposure), market alerts, and pro data at ~$39-49/season with a paid-league-membership bundle lever. BUILD CONSEQUENCE: no paywall UI in this program; heavy-compute surfaces read budgets from config with generous defaults; the premium boundary arrives with billing work, not here.
2. **Auction depth: snake first.** Auction dollar values ship on the Board in phase 1 (cheap, high value). The auction Simulator and auction Assistant move to phase 3 with the room work — auction leagues are the minority and snake sims maximize early value. Cost if wrong: auction managers wait one phase.
3. **Draft grades: league-visible by default, per-league opt-out.** The room-wide grade board is a shared moment and the commissioner-automation market's kind of loud; a league that hates it turns it off in league settings. Mock-draft grades stay private to the manager always. Cost if wrong: one setting flip.
