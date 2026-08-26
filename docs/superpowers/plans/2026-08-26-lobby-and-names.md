# Lobby Flow and Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four founder directives (2026-08-26, verbatim in the ledger): (1) fewer open house leagues at once; (2) fill-triggered league creation instead of scheduled kickoffs that roll users to a new time; (3) appealing, fun house-league names; (4) mock-draft bot seats that feel like real opponents — fun seeded team names, owner names that don't read as strategy labels, and the Bot badge unchanged (the honesty law's carrier).

**Architecture:** Catalog-config change (the shelf is data) + two name generators (one for house spawns, one seeded per mock room) + a bot-roster display-name refresh. No schema changes. The reconciler already replaces leagues that leave the shelf; flipping rungs to `when_full` makes "a new league opens as one fills" the emergent behavior with zero new machinery.

**Tech Stack:** as the repo. Worktree `.claude/worktrees/phase4p5-mock-drafts`, branch `worktree-lobby-and-names` (from main @ 7b28b62). Test DB commish_test_p4, e2e port 3102.

**Spec:** the founder message, ledgered at `.superpowers/sdd/2026-08-26-lobby-and-names/progress.md` top.

## Global Constraints

- REPLAY LAW: bot user ids (`bot_park`, ...) and per-team rng streams are load-bearing — ids never change; only display names and team-row names do. `assignArchetypes` inputs (botSeed, sorted team ids) untouched.
- HONESTY LAW: the visible Bot badge (`TeamCard.isBot` → `MOCK_COPY.botBadge`/`botMarkerLabel`) is the carrier of "practice opponent" honesty and must remain on every bot seat in every surface. FORBIDDEN_VOCABULARY stands (never "AI"). Owner display names must be playful-neutral handles, NEVER real-person-plausible full names (no "Michael Johnson") — first-name-plus-initial or coach-style handles only, and never a strategy word (no "Zero RB", "Sleeper", "Chalk", "Contrarian", ...).
- Rung KEYS are load-bearing (`leagues.house_rung` rows, `HouseRungName` narrowing): `sitandgo_12` retires via `openAtOnce: 0`, its key and label stay for existing rows.
- Sunday Standard copy rules: sentence case, no caps-lock names, no em-dashes in user-facing copy.
- Determinism: mock team names derive from the room's own `botSeed` via `rngFor` streams so tests can pin them and two rooms differ; house names derive from `edition` (pure, no rng — the factory has no seed).
- Verification policy v4. Stage by explicit path. Never touch /Users/jh/code/fantasy working tree.

---

### Task 1: Fill-triggered shelf, dialed back, with fun house names

**Files:**
- Modify: `src/matchmaking/house-catalog.ts` (rungs + name generator), `src/matchmaking/house-catalog.test.ts`
- Modify: `src/league-service/house-factory.ts` ONLY if `openAtOnce: 0` needs a guard (read `ensureHouseCatalog`'s shortfall arithmetic first — `Math.max(0, ...)` may already carry it), plus its test
- Sweep: e2e specs + any test fixtures asserting `"Open 12-team League N"` names, `openAtOnce` counts, or scheduled-house kickoff behavior (grep `League 1`, `openAtOnce`, `houseKickoffFor`)

**Interfaces:**
- Rungs become: `open_12: { startTrigger: "when_full", openAtOnce: 1, firstKickoffMinutes: 0, staggerMinutes: 0, ...CANON }`; `beginner_12` same shape (`when_full`, `openAtOnce: 1`); `sitandgo_12` keeps `when_full` but `openAtOnce: 0` with a docblock: retired — `open_12` IS the sit-and-go now; key/label preserved for existing rows.
- `houseLeagueName(rung, edition)` returns a fun name: a curated per-rung pool (`HOUSE_NAME_POOL`), indexed `(edition - 1) % pool.length`, suffixed with the edition when the pool has wrapped OR always suffixed — SETTLED: always `` `${pool[(edition-1) % len]} No. ${edition}` `` is ugly; instead: name = pool entry when `edition <= len`, else `` `${entry} ${roman-or-number}` ``. Simpler and SETTLED: `` `${entry}` `` for the first cycle and `` `${entry} ${Math.ceil(edition / len)}` `` after — uniqueness within a rung's lifetime is what matters (editions are monotonic). Pools (verbatim, per rung):
  - open_12 (12): "The Blitz Room", "Fourth and Long", "The Longshot League", "Prime Time Twelve", "The Two-Minute Drill", "Hail Mary Society", "The Red Zone Club", "Midnight Waivers", "The Flea Flicker", "Goal Line Stand", "The Audible", "Play Action Party"
  - beginner_12 (8): "The Rookie Room", "First Snap League", "The Learning Curve", "Fresh Legs League", "The Opening Drive", "Training Camp Twelve", "The First Down Club", "Kickoff Classic"
  - sitandgo_12 (1): "Sit and Go Twelve" (legacy rows only)
- Kickoff-roll machinery: untouched code, now unexercised by house rungs — add one line to its docblock saying so.

- [ ] **Step 1: Failing tests** — catalog test: every rung is `when_full`; shelf width sums to 2; `houseLeagueName` draws from the pool, never contains "League" + bare edition, unique across 30 consecutive editions per rung, no uppercase-shouting, no em-dash; factory test: a rung with `openAtOnce: 0` spawns nothing and errors on nothing.
- [ ] **Step 2: Verify fail.** 
- [ ] **Step 3: Implement; run the affected suites (`src/matchmaking`, `src/league-service`) and sweep-fix every fixture/e2e assertion the grep surfaces (report each).**
- [ ] **Step 4: `npx tsc --noEmit` + eslint changed files.**
- [ ] **Step 5: Commit** `feat(lobby): the whole shelf is sit-and-go — two open leagues, filled means replaced, fun names (founder directive)`.

### Task 2: Bot seats that feel like opponents

**Files:**
- Modify: `src/mock-draft/config.ts` (`botRoster` display names + `MOCK_BOT_TEAM_NAME_POOL`), `config.test.ts`
- Create: `src/mock-draft/team-names.ts` + `team-names.test.ts` (seeded picker)
- Modify: `src/mock-draft-service/start.ts` (bot team insert uses seeded names), `src/mock-draft-service/creation.ts` (if it seats bots too — grep), their tests
- Modify: `src/data/seed/bot-roster.ts` (`onConflictDoUpdate` displayName so existing DBs pick up the rename), `bot-roster.test.ts`

**Interfaces:**
- `botRoster` ids UNCHANGED; names become playful-neutral owner handles with no strategy words, e.g.: `bot_park` → "Coach Parker", `bot_earlybird` → "Dana Q.", `bot_latenight` → "Marty the Commish", ... (implementer drafts all 24 under the Global Constraints naming rules; the test enforces: none contain "Bot" as the whole persona... SETTLED: keep "Bot" OUT of the display name entirely — the badge carries it; test asserts no name contains "bot"/"AI" case-insensitive, no strategy vocabulary list: ["zero rb","sleeper","chalk","contrarian","value","upside","floor","stack","streamer","spreadsheet","hunch","boom","bust","workhorse","committee","rookie","vet","homer","hometown","risk"]).
- `pickBotTeamNames(botSeed: number, count: number): readonly string[]` — `rngFor(botSeed, "team-names")` shuffles `MOCK_BOT_TEAM_NAME_POOL` (≥ 20 fantasy-team names: "Turf Burners", "The Waiver Wolves", "Fourth Down Fanatics", "Bench Mob", "The Garbage Timers", "Flex Appeal", "Championship or Bust"... implementer completes ≥20, no strategy leaks needed here — team names are flavor, strategy words allowed ONLY if they don't map to archetype keys; SETTLED: apply the same banned list to keep it simple), takes the first `count`. Deterministic per seed, collision-free per room.
- `start.ts` bot top-up (and any creation-time seating) names each bot TEAM from the picker in sorted-bot-id order (determinism), never `bot.name`.
- `ensureMockBotRoster`: `onConflictDoUpdate({ target: users.id, set: { displayName: ... } })` — the rename reaches every existing database on the next room creation; docblock updated (idempotent still: same values every call).

- [ ] **Step 1: Failing tests** — roster: 24 ids unchanged, byte-for-byte; every display name passes the banned-vocabulary + no-"bot" rules; picker: deterministic per seed, distinct names, differs across seeds, handles count = pool floor; start: bot teams get pool names in sorted order, never the owner display name; upsert: a pre-existing row's displayName is updated.
- [ ] **Step 2: Verify fail.** 
- [ ] **Step 3: Implement; run `src/mock-draft`, `src/mock-draft-service`, `src/data`, `src/draft-room` (the board renders owner names — fixture-pinned names may need sweeps; report each).**
- [ ] **Step 4: tsc + eslint.**
- [ ] **Step 5: Commit** `feat(mock-drafts): seeded opponent team names, coach-style owner handles, the Bot badge unchanged (founder directive)`.

### Task 3: Closing checkpoint

- [ ] Full battery: `npx dotenv -e .env.local -- npx vitest run src/matchmaking src/league-service src/mock-draft src/mock-draft-service src/draft-room src/data src/integrity` + tsc + `npx eslint .`
- [ ] e2e rebuild + `e2e/formats-and-lobby.spec.ts e2e/mock-draft.spec.ts e2e/whole-site.spec.ts` on 3102 (the lobby + mock surfaces this pass touches).
- [ ] Visual: screenshot the browse shelf (2 sit-and-go leagues, fun names) + a mock room board (opponent names + Bot badges) on the built app; persona check; ledger.
- [ ] Docs: `docs/decisions/formats-and-lobby.md` (the shelf flow change + why rolls went dormant), `docs/mock-drafts.md` (bot identity section). Merge: ff main, migrate nothing, verify dev server, close ledgers.
