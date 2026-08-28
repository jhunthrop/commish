# Broadcast Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Founder, 2026-08-27: *"I like the cleanliness of the UI but it doesn't feel like 'fun'"* and then, decisively, *"it feels like a legal website and not a fantasy site."* This plan closes that. Three of the six Sunday Standard rules get amended — two of them scoped to the draft room only — and the room gains a voice, real typographic dynamic range, and a verdict on every pick.

**Spec:** `docs/design/2026-08-27-broadcast-register-spec.md`. The approved reference is the artifact at `claude.ai/code/artifact/4f42cb37-6916-4baa-a46d-6a00f8524888`, judged against FantasyPros and Flock screenshots the founder supplied. Read the spec before Task 1.

**Architecture:** No new data. Every number this plan renders is already computed — the "+11 steal" chip is the same board rank the results page already prints as "RB4 on the board", reframed from receipt to verdict. Changes are confined to `src/draft-room/**`, `src/mock-draft/config.ts` (copy), `src/design/tokens.ts` (position pigments only), and `docs/design-system.md` (the rule amendments).

**Tech Stack:** as the repo. Branch `worktree-broadcast-register` (from main @ `08cc768`), worktree `.claude/worktrees/broadcast-register`. If you run e2e, set `E2E_BASE_URL=http://localhost:3104` — another worktree may hold 3102.

## Global Constraints

- **The three rules that do NOT move:** one typeface at ≤600 weight; no caps outside the existing mono eyebrows; only true things move. Every ounce of new energy comes from colour, scale and shape — never from type shouting or invented motion.
- **The three that do, and their exact scope:**
  - *Rule 1, colour is meaning* — gains two meanings, product-wide: a **tier grade** and a **team's own colour behind a player's face**. Green still means money and red still means live; nothing else may claim either.
  - *Rule 4, hairlines not boxes* — bends for the **player pool row only**. Panels, tables, standings, and every surface outside the room keep hairlines.
  - *Rule 5, one ink action per view* — bends **inside the draft room only**, where drafting is the view. Outside it the rule holds exactly as written, and `e2e/page-audit.spec.ts` continues to enforce it on every audited route.
- `e2e/page-audit.spec.ts` asserts at most one visible ink action per audited page. The draft room is NOT in its route list today. **Do not add it, and do not weaken the assertion** — the carve-out is that the room is unaudited by that spec, not that the spec becomes lenient.
- Accessibility gates are not part of the amendment. `src/design/tokens.test.ts` (140 assertions) must stay green; any new pigment clears its own contrast threshold or it does not ship.
- No em-dashes in user-facing copy (global copy law). Persona panel review applies to every copy change.
- Never touch `/Users/jh/code/fantasy`'s working tree. Stage explicit paths.

---

### Task 1: The voice

**Files:**
- Modify: `src/mock-draft/config.ts` (MOCK_COPY), `src/draft-room/components/room-rail.tsx`, and any room string that explains where it should assert
- Tests: the copy sweeps in `src/integrity/rendered-copy.test.ts` and `no-uppercase.source.test.ts` must stay green

**Interfaces:**
- Produces: room copy in broadcast register. The canonical example, from the founder's own screenshot: `"This team must make its pick before time runs out."` is a compliance sentence. A fantasy product says **"You're on the clock"** and then stops talking.

- [ ] **Step 1:** Inventory every user-facing string in the draft room. Write the list into the task report before changing any of them.
- [ ] **Step 2:** Rewrite in register. Rules: assert, never explain; no sentence whose job is to justify the interface; keep sentence case; no em-dashes. A string that only exists to reassure a lawyer gets deleted, not shortened.
- [ ] **Step 3:** Update the tests that pin exact strings. Where a test asserts a sentence we are deleting, the test's own docblock must say why the sentence went.
- [ ] **Step 4:** Battery `npx vitest run src/draft-room src/mock-draft src/integrity` + tsc + eslint.
- [ ] **Step 5: Commit** `refactor(draft-room): the room asserts instead of explaining (founder: "it feels like a legal website")`

### Task 2: Dynamic range — the on-clock band

**Files:**
- Modify: `src/draft-room/components/room-rail.tsx`
- Tests: `room-rail.test.tsx`

**Interfaces:**
- Consumes: existing `view` state — no new props.
- Produces: the on-clock moment owns the top of the room. Big countdown, the manager's name, the picks-until-yours count. Sports interfaces live on ~10x scale contrast; we are at ~2x, which is a document convention and the reason the eye has nothing to grab.

- [ ] **Step 1: Failing tests** — the countdown renders at display scale when it is the viewer's turn; the band is present only during `in_progress`; the TV variant is unaffected (it has its own sizes and its own no-clickable-controls invariant).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** The clock may pulse — rule 6 permits it because the clock is genuinely running out. Respect `prefers-reduced-motion` via the existing `usePrefersReducedMotion` hook.
- [ ] **Step 4: Green + battery.**
- [ ] **Step 5: Commit** `feat(draft-room): the on-clock moment owns the top of the room`

### Task 3: The verdict chip

**Files:**
- Create: `src/draft-room/lib/verdict.ts` + test (pure: board rank vs pick slot → steal | reach | even, with magnitude)
- Modify: `src/draft-room/components/player-pool.tsx`, `pick-wire.tsx`, `src/draft-room/components/mock-results.tsx`
- Tests: each renderer's own test

**Interfaces:**
- Consumes: the board rank already computed for the results page's "RB4 on the board" line — **find it before writing anything new**; it exists.
- Produces: `verdictFor(boardRank, pickNumber)` → `{ kind: "steal" | "reach" | "even"; delta: number }`. Green for steal, red for reach, muted for even — both already sanctioned meanings, no rule change needed for this task.

- [ ] **Step 1: Failing test** for `verdictFor`, including the boundary: what delta counts as "even" is a tunable in `src/mock-draft/config.ts` or `DRAFT_ROOM_CONFIG`, never a literal in a component.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** the function, then render it in the three places. This is the single highest-value change in the plan: it turns a receipt into a result at zero data cost.
- [ ] **Step 4: Green + battery** `src/draft-room src/mock-draft`.
- [ ] **Step 5: Commit** `feat(draft-room): every pick carries a verdict, not a receipt`

### Task 4: The pool row becomes a card, and every row can draft

**Files:**
- Modify: `src/draft-room/components/player-pool.tsx`, `src/design/tokens.ts` (position sticker saturation only, if the gates allow)
- Tests: `player-pool.test.tsx`, `src/design/tokens.test.ts`

**Interfaces:**
- Consumes: `pool-player-name` / `pool-player-team` testids exist and `e2e/mock-draft.spec.ts` + `e2e/league-lifecycle.spec.ts` read them — **keep both testids working** or those specs hang for their full budget (they did exactly that on 2026-08-27; see the commit).
- Produces: a card row with the team-colour block behind the player's face, and a Draft action on every draftable row.

- [ ] **Step 1: Failing tests** — a draftable row renders its own Draft control; the row is a card; the two testids survive.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** Team colour is a NEW sanctioned use of pigment (rule 1) and lives only behind a face — never on a surface, never on text. If a team colour cannot clear contrast against the face's initials, the initials change, not the ground.
- [ ] **Step 4: Green.** Battery `src/draft-room src/design src/components` + tsc + eslint. Then run the two e2e specs named above, at port 3104, to prove the testids still resolve.
- [ ] **Step 5: Commit** `feat(draft-room): the pool row is an object you act on, not a line in a ledger`

### Task 5: Record the amendments

**Files:**
- Modify: `docs/design-system.md`

- [ ] **Step 1:** Write the three amendments into the design system with their exact scope and the founder quote that caused them. A future reader must be able to tell that rules 4 and 5 bend *only* in the room, and why.
- [ ] **Step 2:** Note the two rules deliberately NOT amended and what they buy.
- [ ] **Step 3: Commit** `docs(design-system): the broadcast amendments — three rules move, three hold`

## Parked, and why

- **Tier grade bands** need real tiers, which need the projection engine. Parked until then; the rule-1 amendment above already covers them so no second ruling is needed later.
- **Custom team crests and colours** are a Pro feature in the tiering matrix, not a room change. Different plan.

## Self-review notes for the executor

- Task 1 is the cheapest and carries roughly half the felt improvement. Do not skip ahead to the visual work.
- If a change makes the room louder without making a true thing more legible, it is decoration and rule 6 rejects it. The founder's complaint was that the room reads as a contract, not that it lacks ornament.
