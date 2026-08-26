# Draft Room Product Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three founder directives (2026-08-26): player headshots in the room (Tank01's `espnHeadshot`, never stored until now); the room's right rail becomes YOUR ROSTER (slot-by-slot, filled and open); chat shrinks to a slim expandable strip (people don't chat much mid-draft). A fourth (bot pick quality) is PARKED pending the founder's verdict on a fresh post-restart room.

**Architecture:** One nullable `players.headshot_url` column + one mapping line + UI fallbacks (T1). The aside column becomes a stacked panel: roster on top (derived client-side from `view.picks` + `slotConfig` — data the room already holds), chat as a collapsed strip that expands in place (T2). No new API reads.

**Tech Stack:** as the repo. Branch `worktree-room-product` (from main @ 9a645f0), worktree `.claude/worktrees/phase4p5-mock-drafts`, test DB commish_test_p4, e2e port 3102.

## Global Constraints

- Sunday Standard six rules (sweeps enforce); room laws: nothing reflows on state change (the roster panel and chat strip live in the fixed aside column; expanding chat swaps panel content, never resizes the column); a surface with nothing to say renders nothing.
- Migration process law: applied migrations never amended — headshots ship as 0045; journal `when` monotonic.
- `players.headshotUrl` is NULLABLE and every renderer falls back to initials (`Avatar`'s existing image-or-initials contract) — defenses and any unmapped player have no image, forever, by design.
- Remote images: ESPN CDN via plain `<img>` with the same eslint carve-out + reasoning the chat GIF `<img>` documents (third-party CDN, fixed dimensions, no allowlist maintenance) — copy that comment's shape.
- Verification policy v4. Stage explicit paths. Never touch /Users/jh/code/fantasy working tree (the dev server now runs under the controller; restart it after merge — ticker changes don't apply here but the schema does).

---

### Task 1: Headshots — stored, ingested, rendered

**Files:**
- Modify: `src/db/schema.ts` (players: `headshotUrl: text("headshot_url")` nullable), `src/db/schema.test.ts` if it pins the column set
- Create: `drizzle/0045_player_headshots.sql` via `npx dotenv -e .env.local -- npx drizzle-kit generate --name=player_headshots` (schema-derived, NOT --custom)
- Modify: `src/domain/player.ts` (`Player.headshotUrl: string | null` — update EVERY constructor/fixture the compiler flags; fixtures may default null)
- Modify: `src/stats/tank01/map.ts` (`mapPlayerList`: `headshotUrl: str(record.espnHeadshot) || null`; team defenses map null), its test with a real-shaped payload
- Modify: `src/stats/mock/mock-stats-provider.ts` (mock players: null, or a data-URI-free placeholder — null; the UI fallback is the feature)
- Modify: `src/data/seed/seed-players.ts` (upsert includes headshotUrl — NOT excluded like adp; the seed re-run refreshes it)
- Modify: `src/draft-room/components/player-pool.tsx` (row: 24px round headshot before the name, initials-fallback), `tv-board.tsx` spotlight (the on-clock team's LAST pick face is already avatar'd for owners — add the player face beside the last-pick line at lg size), `pick-wire` NOT touched (a mono line stays a mono line)
- Tests: pool renders `<img src=headshotUrl>` when present and initials-fallback when null; map test parses espnHeadshot; seed upsert refreshes a stale URL

**Interfaces:**
- Produces: `Player.headshotUrl: string | null` end to end; a `PlayerFace({ player, size })` shared component in `src/draft-room/components/` (or reuse `Avatar` if its props fit a non-user face — read it first; Avatar takes `name`/`avatar` so reuse IS the move: `<Avatar name={player.name} avatar={player.headshotUrl} size="sm">`). SETTLED: reuse `Avatar`, no new component, unless Avatar hard-codes user semantics.
- The API pool route (`/api/drafts/[draftId]/players`) serializes players — verify headshotUrl rides it (it serializes the domain Player; the compiler will say).

- [ ] Step 1: failing tests (map, pool render both branches, seed refresh)
- [ ] Step 2: RED → implement (schema, migration generate, domain, map, seed, UI) → GREEN; `npm run db:migrate` + `db:migrate:test`
- [ ] Step 3: battery `src/stats src/data src/db src/draft-room src/stats-pipeline` + tsc + eslint
- [ ] Step 4: Commit `feat(players): headshots — Tank01 espnHeadshot stored and rendered with initials fallback (founder directive)`

### Task 2: The aside becomes Your Roster; chat becomes a strip

**Files:**
- Create: `src/draft-room/components/roster-rail.tsx` + test
- Modify: `src/draft-room/components/draft-room.tsx` (aside composition + chat collapse default), `room-shell.tsx` only if the aside prop shape moves
- Modify: `src/draft-room/components/room-dock.tsx` — the dock's `RosterStrip` ("Your roster" chips) is SUPERSEDED on lg+ by the rail; below lg the dock strip stays (the rail is far down the linearized page). Gate the dock strip `lg:hidden`… NO — SETTLED: keep the dock strip everywhere (it is one quiet line and the dock is the phone's roster); the rail is additive at lg+.
- Test: `draft-room.test.tsx` aside assertions

**Design (settled):**
- `RosterRail({ view, myTeamId, playersById, slotConfig })`: heading "Your roster" (eyebrow), then ONE row per roster spot in slot order (QB, RB, RB, WR, WR, TE, FLEX, K, DEF, then bench slots): filled → `Avatar` face + name + PositionBadge; open → quiet dashed placeholder row with the slot's own chip (`SlotChip`) and nothing else. Fill assignment derives from `view.picks` for `myTeamId` through the same slot-grouping logic `MockResults` uses (`mock-results.tsx` groups a finished roster by slot shape — extract/share that derivation into `src/draft-room/state/` rather than duplicating; DRY is the review lens here).
- A commissioner with no team (`myTeamId === null`): the rail renders the CHAT panel expanded instead (they have no roster; nothing-to-say law).
- Chat: a slim strip at the aside's bottom — one hairline-topped row, `League chat` ghost button + unread-free (no counts invented). Expanded chat REPLACES the roster panel in the same fixed-width column (toggle back restores). Default collapsed at every width (the founder's ruling supersedes the E4 xl-open default — remove the matchMedia initial-state effect and its tests; document the supersession citing this pass).
- The whole aside keeps `lg:w-88`; nothing reflows.

- [ ] Step 1: failing tests — rail renders every slot in order with filled/open states; open slots show the slot chip; faces render with fallback; commissioner sees chat; chat strip toggles panel content; chat defaults collapsed with no media dependency
- [ ] Step 2: RED → implement → GREEN (extract the shared slot-derivation; mock-results consumes it too, its tests stay green)
- [ ] Step 3: battery `src/draft-room src/chat-room src/integrity` + tsc + eslint
- [ ] Step 4: Commit `feat(draft-room): the right rail is your roster; chat is a strip (founder directive)`

### Task 3: Closing checkpoint

- [ ] Full battery (`src/draft-room src/chat-room src/stats src/data src/db src/integrity src/league-room`) + tsc + `npx eslint .`
- [ ] e2e rebuild + `e2e/mock-draft.spec.ts e2e/mobile-360.spec.ts e2e/design-v2.spec.ts` on 3102
- [ ] Visual: drive a solo mock on the built app; screenshot the room (roster rail filled/open, faces in pool, chat strip) at 1440 and 360; persona check; ledger
- [ ] Docs: `docs/draft-room.md` aside section + `docs/mock-drafts.md` if it names the chat aside; merge (ff main), `npm run db:migrate` on dev, RESTART the dev server (schema change), verify, close ledgers
