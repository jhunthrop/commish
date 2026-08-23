# Phase 3.6 ADDENDUM — the whole site: the way in, the rooms nobody drew, and every capability made visible

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The founder read the committed design plan and ordered two extensions, verbatim and binding: *"I want it to encompass the whole site design. What screens have we not accounted for yet. I want it to do log in and everything."* and *"the plan should also make sure that all backend functionality is leveraged fully and implemented. It should also do persona reviews for us to flag backend gaps that we need to create."* This addendum extends `2026-08-23-phase3p6-design-v2.md` (Tasks 1 to 14) to the eleven surfaces that plan does not cover, starting with the front of the funnel it never designed: **the way in.** It also ships the discipline the second directive asks for, as a real task rather than a promise: every exported capability of every service module is walked, mapped to the surface that exposes it, and either shipped, deferred with a sentence, or turned into work; and every persona panel from here to the end of Phase 3.6 carries a second mandate, naming what a person tried to do that no backend supports.

**Architecture:** Five strands. **(1) The way in is designed AROUND WorkOS, never inside it.** The standing founder rule is absolute (*"We do not roll our own auth"*), so this plan designs nothing that takes a credential: it designs the signed-out entry points, the one intent-carrying sign-in link, the branded hosted page as a dashboard runbook, the arrival, the way out, and the moment a session dies under a page that is still on screen. The mechanism that makes the parent's seat hold survive a round trip through AuthKit **already exists in the installed SDK and is unused** (`getSignInUrl({ returnTo })`, sealed into the callback's state, which beats the callback's own fixed `returnPathname`); wiring it is one small task and the parent's Task 6 depends on it. **(2) The eleven unaccounted screens get the same language as the three, not a second one.** `#0B0C0F` ground, Geist and Geist Mono, `Panel`/`Crest`/`StatPill`/`Meter`/`Table density="dense"`, full-bleed frames and measured paragraphs. Nothing in this addendum invents a primitive the parent did not already justify, except the three the signed-out and skeleton states genuinely have no home for. **(3) The chrome that is copy-pasted becomes one component.** The signed-out header exists twice today, character for character, in `/reviews` and `/app/join/[code]`; the sign-in link exists three times, each dropping the visitor's intent on the floor. The founder's centralize-the-first-time rule applies to both, and the existing consumers are refactored in the same commit. **(4) Nothing built in Phases 1 to 3.5 stays invisible.** Task 15 is an inventory with a doc artifact and three enforcement tests, run FIRST because what it finds can reorder everything after it. **(5) Every gap a persona hits becomes a ledgered backlog row with a name on it**, not a shrug in a transcript.

**Tech Stack:** Unchanged from the parent. **This addendum adds no dependency, no environment variable, no migration, no realtime event type and no API route that writes.** Every screen here is server-rendered from reads that already exist.

**Spec:** The two founder directives above; the parent plan's three approved mockups as the visual specification, applied to surfaces the mockups do not draw; and the route audit in "What is already true" below, which was verified against `src/app` in this worktree rather than taken from prose.

**Depends on:** the parent plan `docs/superpowers/plans/2026-08-23-phase3p6-design-v2.md`, whose Tasks 1 to 4 execute first. Tasks here consume `AppShell`, `TopBar`, `Panel`, `Crest`, `StatPill`, `Meter`, `SeatMeter`, `Table density`, `renderSurface`, the v2 palette and the dense type scale as given. **Task 16 is the exception in the other direction:** the parent's Task 6 interstitial cannot return a visitor to their held seat without Task 16 Step 2, and Task 16 in turn cannot edit `top-bar.tsx` until the parent's Task 2 has performed the `app-header.tsx` → `top-bar.tsx` rename. Controller ruling 1 records the interleaved order that satisfies both.

**This addendum does not change the roadmap.** Phase 3.6 remains an interstitial design pass; Phase 4 (payments) remains next. The parent's Task 14 Step 3 records 3.6 once, and this addendum adds its own file name to that same line rather than a second row.

---

## Global Constraints

**The parent plan's entire Global Constraints section is incorporated here by reference and binds every task in this addendum verbatim** (`2026-08-23-phase3p6-design-v2.md`): the no-MVP directive, the pinned stack, the identity seam, the client boundary and its eight exempt directories, the API envelope, config-over-magic-numbers, test-first with real Postgres and Redis, the no-write-before-a-committed-refusal class, FK-lock enumeration, the 100% coverage gates read off `vitest.config.mts` rather than trusted from a plan, the e2e disciplines (the SSR fake, relative counts), the e2e-under-redesign rule, migrations, conventional commits, and `npm run typecheck && npm run lint && npm test && npm run build` after every step. **The parent's twenty-seven self-rulings and the controller's six rulings at the bottom of that file also bind**, in particular: dark-only (ruling 1 / controller 1), no new coverage gate and no ninth exempt directory (ruling 24), copy sweeps on every new component in the task that creates it, persona-panel discipline, and no mock data on a real surface.

Only what is **new** is stated here.

**A1. WorkOS AuthKit is the auth boundary and this plan never crosses it.** No credential input, no password field, no email-and-code form, no "continue with Google" button of our own, ever, on any surface in this addendum. What we design is everything on our side of the redirect: the entry points, the intent we carry into it, the arrival, the way out, and the failure. The hosted page's own appearance is configured in the **WorkOS dashboard**, which is a founder/ops runbook step, not a code change (Task 22 Step 3 writes the runbook). From code, the installed `@workos-inc/authkit-nextjs` exposes exactly these levers on the authorization URL, verified against `node_modules/@workos-inc/authkit-nextjs/dist/esm/types/interfaces.d.ts:91-106` and `auth.d.ts:3-7`: `screenHint` (`'sign-in' | 'sign-up'`), `returnTo` (sealed into the state as `returnPathname`), `loginHint`, `organizationId`, `prompt`, `redirectUri`, `state`, `maxAge`. **That list is the whole code-side surface.** Anything else a task wants to change about the hosted screen is a dashboard setting and gets written into the runbook instead of into a file.

**A2. There is no auth bypass and this addendum adds none.** The e2e suite authenticates through sealed real sessions minted by `e2e/global-setup.ts` (`MANAGER_A_STATE`, `MANAGER_B_STATE`, `MANAGER_ZERO_STATE`, `MANAGER_SIGNOUT_STATE`). **Every sign-in assertion in this plan stops at the AuthKit boundary:** a spec may assert that the click leaves our origin, that the destination carries our `redirect_uri` and a `state` parameter, and that a `returnTo` we set arrives at our own route as the right argument (asserted in a route unit test with the SDK module mocked, which is where that contract is actually checkable). **No spec may type into the hosted form, and no spec may stub the WorkOS domain.**

**A3. The operator console's authorization does not move.** `withAdmin` (`src/app/api/admin/_shared.ts`) is the one gate on both sides of the wire, it answers 404 and never 403 (ruling 14), and `admin-routes.test.ts` is the tripwire that proves every admin route goes through it **and that `requireAdmin` is called from nowhere else in `src`**. The parent's Task 2 moves that file with the pages it scans (`src/app/app/(shell)/admin/**`) and updates its path glob **in the commit that performs the move**; that is a structure change under the e2e-under-redesign rule and it is the only edit the file receives in Phase 3.6. Task 19 is a rendering change with a zero-diff authorization footprint, and its own step re-runs the tripwire **without editing it** and asserts the diff touched no gate. Every operator-facing string is user-facing copy for the copy sweeps: `INTEGRITY_CONFIG.notices.accusatoryTerms`, `passiveConstructions`, and the no-dash rule already cover `src/admin-room` through `room-copy.source.test.ts` and `rendered-copy.test.tsx`.

**A4. The review feed's design may not add a curation affordance.** The founder's claim on the front door is that reviews are unedited, good and bad. Newest-first is the only order this product ships. **No sort control, no rating filter, no "helpful" vote, no featured row, no default that could be read as a ranking.** Reporting a review stays (it is moderation, and it removes nothing by itself), and its copy keeps saying so.

**A5. The invite landing composes with the house rule and never dead-ends.** House leagues take no invites, so a code naming one cannot exist; a code that does not resolve reads as invalid, which is the same non-oracle discipline `invitePreview` already holds to. The landing renders a real state and a real action for each of: valid and open, invalid, expired, exhausted, already a member, league full, draft already started, tier-refused, and signed out. `EXPIRED`/`EXHAUSTED`/`INVALID` are the three sentences `src/league-service/invites.ts` already owns and this plan does not re-word them.

**A6. A dead session is a designed moment, not a raw error.** API and SSE routes return JSON 401 and never redirect (the identity constraint). Every client room's `fetchJson` therefore sees a 401 that today becomes a generic "we could not reach the server" line. Task 16 gives that one shared, quiet recovery, and the recovery carries the current path back through sign-in as intent.

**A7. Dual-mandate persona panels, everywhere, including the parent's final gauntlet.** Every persona panel in this addendum runs two mandates: **(1)** the usual UX verdicts, at the founder's bar; **(2)** **BACKEND GAP FLAGS** — each persona names, in their own words, what they tried to do that no backend supports ("I want waivers", "I want to message a manager directly", "I want my draft grade", "I want to report a manager from their profile", "I want to change the email I sign in with"). Every flag lands in `docs/research/2026-08-23-backend-gaps-backlog.md` with **persona attribution, a severity (HIGH/MEDIUM/LOW), and a suggested owner phase**. **Nothing on that list is implemented in Phase 3.6.** The parent's Task 14 Step 5 gauntlet is extended the same way by Task 22 Step 2, and the panel briefs quote the founder's bar as the acceptance criterion.

**A8. This addendum writes no `src/domain` file, adds no config file, adds no icon, and adds no coverage gate.** Every new pure module lands in a directory that is already gated (Task 15 and Task 16 each read the gate list off `vitest.config.mts` rather than trusting a number written here). The one place this rule bites is `safeReturnTo`, which lands beside `current-user.ts` in `src/lib/auth/` precisely because that is where the identity seam already lives.

**A9. Verification agents never write review artifacts and never commit.** Standing dispatch rule, repeated at every review dispatch here.

---

## What is already true (verified in this worktree, and two of these correct the brief)

| The brief or the parent plan assumes | Reality in the code today |
|---|---|
| There is no sign-in anything | **There are four auth routes and all four are `route.ts` handlers with no page at all.** `src/app/sign-in/route.ts` is `redirect(await getSignInUrl())`, `sign-up/route.ts` is its twin, `sign-out/route.ts` is a `POST` calling `signOut({ returnTo: origin })`, and `src/app/callback/route.ts` is `handleAuth({ returnPathname: "/app", onSuccess })`. There is no page to design in the middle; the design work is the entry points, the intent, the arrival and the failure. |
| Signing in preserves what the visitor was doing | **Only when the middleware sends them.** `src/middleware.ts` redirects a signed-out `GET /app/**` through `authkit()`, whose `authorizationUrl` already carries `returnPathname: getReturnPathname(request.url)` (`dist/esm/session.js:131`), so a deep link into `/app` does come back. **An explicit `/sign-in` link drops the visitor's intent entirely** and lands them on `/app`, and that link is what `/reviews`, `/app/join/[code]` and (after the parent's Task 5) the front door all render. The parent's seat-hold interstitial is on the losing side of exactly this. |
| Returning a visitor to their intent needs new machinery | **It needs one argument.** `getSignInUrl({ returnTo })` (`auth.d.ts:3-7`) seals `returnPathname` into the state, and the callback resolves `const returnPathname = returnPathnameState ?? returnPathnameOption` (`dist/esm/authkit-callback-route.js:76`) — the sealed state **beats** the `"/app"` we pass. The callback then uses only `parsedReturnUrl.pathname` and `.search` against our own request URL, so a hostile `returnTo` cannot leave our origin. We still validate our own input (A1's fail-fast rule), and we do it in one function. |
| `error.tsx` and `not-found.tsx` are bare defaults | **They are not bare.** Both are real `ErrorState`/`EmptyState` surfaces with considered copy, a digest reference, and a documented refusal to print `error.message`; `src/app/error-surfaces.test.tsx` asserts all of it. What is actually wrong with them is smaller and sharper: they render **no chrome at all**, they sit in a `max-w-lg` centered box the founder's brief deletes everywhere else, and **every action they offer points at `/app`**, which for a signed-out stranger who followed a bad public link is a bounce straight into hosted sign-in. |
| There is a loading state somewhere | **There is not a single `loading.tsx` in the repository.** Every page under `/app` is `export const dynamic = "force-dynamic"` and awaits its reads before returning a byte, so every navigation is a blank hold at the old page followed by a full swap. Task 21 decides the strategy and argues it against what the App Router actually does. |
| The signed-out chrome is a component | **It is a copy-paste, twice, character for character.** `src/app/reviews/page.tsx:15-31` and `src/app/app/join/[code]/page.tsx:35-49` contain the same `<header>` with the same wordmark link and the same `/sign-in` link. The founder's centralization rule has an exact name for this. |
| The profile page is one of the nine pages the shell absorbs (the parent's Task 2 Step 5, as amended) | **It is, and it is also the only place in the product a manager can change who they are** — `ProfileForm`, `HelpLevelForm`, `AvatarPicker`, `NotificationSummary`, `ReviewComposer` — and **nothing links a first-run manager to it.** `experienceTier` defaults to `beginner` in `syncUserFromWorkOS` and gates which leagues a stranger can see; no screen ever asks. |
| The notice inbox is the notices surface | **It is the ONLY one, and `listNotices(db, userId)` takes no cursor at all** (`src/integrity-service/notify.ts:184`) and caps at `INTEGRITY_CONFIG.notices.inboxSize` by ruling 22. Older notices exist in Postgres, are audit-anchored, and **cannot be read from anywhere in the product.** That is a backend gap, not a design gap, and Task 15 files it as one. |
| The glossary is wired | **Ten of its twenty terms have no caller in production code.** `term="…"` appears for `house-league`, `superflex`, `sit-and-go`, `lineup-lock`, `bench`, `draft-slot`, `queue`, `median-game`, `on-the-clock`, `verified-reviewer`. Unreferenced outside `info-tip.test.tsx`: `snake-draft`, `auction-draft`, `ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `stake-tier`, `matchup`, `standings-record`. |
| A member can see their own standing on the platform | **They cannot.** `completedSeasonsFor` and `participationTierFor` decide whether a stranger may join a tiered league (`tierJoinPrecondition`), and the refusal at the door is the first and only time a person learns the axis exists. `VERIFIED_BADGE_LABEL` renders in exactly one place, `review-feed.tsx`, about other people. |
| The advisor, the GIF picker, reactions, trade valuation and the KDS outcome are unsurfaced candidates | **All five are surfaced.** `use-trades.assess` calls `POST …/advisor/trade` and `TradeVerdict` renders it; `gif-picker.tsx`, `reaction-bar.tsx`, `report-dialog.tsx` and `removed-message.tsx` all exist; `tradeBalance`/`fairnessGap` reach members through `TradeVerdict` and operators through the held-trade detail; `SlotPreferencePanel` renders the post-draw outcome sentence (`resultSentence`, including the "slot N went to another manager" case). Task 15 confirms rather than assumes, but the plan does not budget work for them. |
| The commissioner's moderation window covers the product | **It covers member leagues only.** `ModerationSummary` renders for `home.isCommissioner`, and a **house league has no commissioner** (`HOUSE_AUTHORITY_REFUSALS`), so in the founder's core experience `leagueModerationSummary` renders for nobody. |

---

## File Structure

**New — shared chrome and shared behavior (`src/components/app-shell/`, shared UI, neither boundary-listed nor blocked):**

| File | Responsibility |
|---|---|
| `public-bar.tsx` | `PublicBar` — the signed-out header: wordmark home link, an optional `nav?: readonly NavLink[]`, an optional `action?: ReactNode`, and one `SignInLink`. Both optional props default to nothing, so `/reviews`, `/browse` and `/app/join/[code]` render it bare and the front door renders it with the approved mock's three nav links and its green CTA (F5). Replaces two verbatim copies in the same commit. |
| `public-footer.tsx` | `PublicFooter` — the signed-out footer: Terms, Privacy, Support and League rules, rendered by all four public surfaces (F19). Its own test carries the **every footer target resolves** assertion, which is why that assertion does not live on any page that renders it. |
| `sign-in-link.tsx` | `SignInLink` — the ONE way to render "sign in" anywhere in this product. Takes `intent` (the path to come back to) and renders `/sign-in?returnTo=…`. There is no other spelling after this task. |
| `session-watch.ts` | `fetchWithSessionWatch`, `onSessionLost`, `SESSION_LOST_EVENT`. A module-level emitter every room's `fetchJson` routes through, so one 401 reaches one recovery. Pure browser, no imports from `@/lib`. |
| `session-notice.tsx` | `SessionNotice` — the quiet top-bar strip that says the session ended, escalating to a `Modal` only when a user-initiated write is what failed. |
| `app-shell-skeleton.tsx` | `AppShellSkeleton` — the shell's geometry with no data, `aria-busy`, used by both `loading.tsx` files and never by a page. |

**New — routes and pages:**

| File | Responsibility |
|---|---|
| `src/app/sign-in/problem/page.tsx` | The only screen a failed callback is allowed to land on. Legal beside `sign-in/route.ts`: different segments. |
| `src/app/loading.tsx` | The public skeleton (front door, browse, reviews, hold interstitial): the `PublicBar`'s geometry and nothing else. |
| `src/app/app/(shell)/loading.tsx` | The signed-in **content column's** skeleton, inherited by every segment inside the shell group. The rail and the top bar are not in it, because the layout renders them and a layout does not suspend (the parent's ruling 8, as amended by F8). |
| `src/app/app/(room)/drafts/[draftId]/loading.tsx` | The room's own skeleton, because the room renders no shell and inheriting one would be a lie for 400ms. |
| `src/app/app/(public)/join/[code]/loading.tsx` | The invite landing's skeleton, in the **public** geometry, because that route is signed-out reachable through the middleware's exemption and the signed-in skeleton would promise a rail to somebody who has no leagues and no session (F7). |
| `src/app/app/(room)/drafts/[draftId]/error.tsx` | The room's own error boundary: the room's frame, `reset()` as the primary action, and no shell (F14). |
| `src/app/legal/terms/page.tsx`, `src/app/legal/privacy/page.tsx`, `src/app/support/page.tsx`, `src/app/league-rules/page.tsx` | The four trust pages the parent's Task 5 links to. **This task designs them; it creates only the ones the parent left as stubs, and never a second route for a path that already resolves.** |

**New — pure:**

| File | Responsibility |
|---|---|
| `src/lib/auth/return-to.ts` | `safeReturnTo(raw: string \| null): string \| null`. One validator, fail-closed, with the open-redirect shapes enumerated in its own tests. Lands in the directory `current-user.ts` already occupies; the task reads that directory's coverage gate off `vitest.config.mts`. |

**New — components:**

| File | Responsibility |
|---|---|
| `src/account-room/components/standing-panel.tsx` | A manager's own participation standing: seasons completed, tier, verified state, and what each one opens. About the reader only, never about anybody else (ruling 30). |
| `src/league-room/components/invite-landing.tsx` | The invite code's nine states, each with an action. Replaces the page-local composition in `src/app/app/join/[code]/page.tsx`. |
| `src/admin-room/components/queue-table.tsx` | The operator queue as a dense `Table`, replacing the card list. |

**Modified** (every `/app` path is written as the parent's Task 2 leaves it, inside its route group; no URL changes): `src/app/sign-in/route.ts`, `src/app/sign-up/route.ts`, `src/app/callback/route.ts` (an `onError` and nothing else), `src/app/reviews/page.tsx`, `src/app/app/(public)/join/[code]/page.tsx`, `src/app/app/(shell)/profile/page.tsx`, `src/app/app/(shell)/admin/queue/page.tsx`, `src/app/app/(shell)/admin/queue/[flagId]/page.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/global-error.tsx`, `src/app/app/(shell)/page.tsx` (the first-run step only), the four `hooks/deps.tsx` files (`account-room`, `league-room`, `chat-room`, `draft-room`), `src/account-room/components/*` (retone plus the two additions), `src/admin-room/components/*` (retone), `src/league-room/components/first-run-panel.tsx`, `src/help/glossary.ts` (no new term; callers only), `src/integrity/rendered-copy.test.tsx` (every new component, in the task that creates it), `src/components/ui/config.ts` (skeleton geometry only).

**New docs:** `docs/backend-surface-map.md` (Task 15's artifact), `docs/decisions/auth-front-door.md` (Task 22, including the WorkOS dashboard runbook), `docs/research/2026-08-23-backend-gaps-backlog.md` (Task 22, the founder-facing backlog).

**Modified docs:** `docs/conventions.md` (the auth routes line grows `returnTo`; the notices cap is stated), `docs/design-system.md` (the public bar, the skeleton, the loading strategy, the measured-paragraph pages), `docs/league.md` (the invite landing's states), `README.md`.

**New e2e:** `e2e/auth.spec.ts`, `e2e/whole-site.spec.ts`. **Modified e2e:** `e2e/onboarding.spec.ts` (structure, deliberately, in the task that moves it), `e2e/mobile-360.spec.ts` (the addendum's surfaces join the loop).

**New tests of record:** `src/help/glossary.source.test.ts`, `src/integrity/system-action-surfaces.test.ts`, `src/integrity/service-map.source.test.ts`.

---

## Task 15: The backend-leverage inventory

Founder directive 2, first half. This runs **before every other task in this addendum** because what it finds can reorder them, and it produces two things: a table in the execution ledger, and a committed artifact that does not rot.

**Files:**
- Create: `docs/backend-surface-map.md`
- Create: `src/help/glossary.source.test.ts`, `src/integrity/system-action-surfaces.test.ts`, `src/integrity/service-map.source.test.ts`
- Modify: `src/help/glossary.ts` (its docblock gains the allowlist's rule, no term added or removed)

**Interfaces:**
- Consumes: `SYSTEM_ACTION_CODES`, `SYSTEM_ACTION_VISIBILITY`, `NOTICE_TEMPLATES`, `GLOSSARY`, `sourceFilesIn` (`@/integrity/test-support`).
- Produces: `docs/backend-surface-map.md`, `UNSURFACED_GLOSSARY_TERMS` (in the test file, not in production code), three failing-first tests.

- [ ] **Step 1: Walk every module, mechanically, and write down what you find**

Fourteen modules, in this order: `src/league-service`, `src/draft-service`, `src/chat-service`, `src/review-service`, `src/identity-service`, `src/integrity-service`, `src/trades`, `src/participation`, `src/moderation`, `src/ai-advisor`, `src/stats` + `src/stats-pipeline`, `src/help`, `src/matchmaking`, `src/chat` + `src/identity` + `src/reviews` + `src/gifs`.

The method, so two people doing this get the same answer: for each module, list every `export` that is a **capability** (a function or a const table that decides product behavior — not a Zod schema, not a `*Input`/`*Result` type, not a `test-support.ts` export). For each capability, `rg` for consumers **outside its own directory and outside `*.test.*`**. Then classify:

- **SURFACED** — name the exact file that renders it to a human. A capability reached only by another service is surfaced by whatever surfaces *that*.
- **DEFERRED** — no human surface, and one sentence saying why that is correct, plus the phase that owns it. Scripts count as an operator surface only when the capability is genuinely an operator tool (`grantAdmin`, `verifyAllChains`, the three sweeps); a member-facing capability behind a script is a gap, not a deferral.
- **GAP** — no surface and no defensible reason. **Every GAP becomes either a step in one of Tasks 16 to 21 of this addendum, or a row in Task 22's backlog with a severity and an owner phase.** A GAP may not stay unassigned.

- [ ] **Step 2: The table, in the ledger and in the artifact**

`docs/backend-surface-map.md` carries one table with five columns and one row per capability:

| Module | Capability | Verdict | Surface, or the reason | Owner |
|---|---|---|---|---|

The planner already walked this tree and the rows below are **seeded findings, to be verified rather than trusted** — every one was read off the code in this worktree, and each is worth a minute of the executor's time to confirm before it becomes a task:

| Capability | Seeded verdict | The fact behind it |
|---|---|---|
| `listNotices(db, userId)` | **GAP → backlog, HIGH** | Takes no cursor (`notify.ts:184`) and caps at `INTEGRITY_CONFIG.notices.inboxSize`. A member's own audit-anchored record of what the platform did to them is unreadable past the cap, from anywhere. Fixing it is a service change (a cursor plus a page), which is why it is a backlog row and not a Task-18 step. |
| `GLOSSARY` (10 of 20 terms) | **GAP → Task 15 Step 4 plus Tasks 18/20/21** | `snake-draft`, `auction-draft`, `ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `stake-tier`, `matchup`, `standings-record` have no `InfoTip` caller in production. |
| `completedSeasonsFor` / `participationTierFor` / `isVerifiedPlayer` about ONESELF | **GAP → Task 18** | The axis that decides which leagues a person may join is invisible until it refuses them at a door. |
| `leagueModerationSummary` | **GAP → backlog, MEDIUM** | Commissioner-gated; a house league has no commissioner, so the founder's core product renders it for nobody. Who should see it in a house league is an authority decision, not a design one. |
| `verifyChainIntegrity` / `verifyAllChains` / `grantAdmin` / `sweepUnflaggedTrades` / `sweepSupersededHoldFlags` / `sweepLeagueForMultiAccounts` | **DEFERRED** | Operator tools with a real operator surface (the npm scripts). An operator console page for chain health is its own work with its own authz; backlog row, LOW. |
| `NOTIFICATION_CATALOG` / `channelStatus` / `deliverableChannels` | **SURFACED (read-only, correctly)** | `NotificationSummary` renders the catalog and says email is not connected. A toggle for a channel with no sender is the switch-wired-to-nothing this codebase refuses. Task 18 retones it and adds no control. |
| Member-raised questions | **GAP → Task 21 plus backlog, MEDIUM** | `reportReview` and `reportMessage` are the only two member-facing paths into the dispute queue. There is no way to raise a question about a trade, a draft, a league or a manager, and no page anywhere that explains what the queue is or when an answer arrives. Task 21's support page is the named entry the 3.5 loop deferred; a real report-a-league-thing flow is backlog. |
| Trade valuation, trade advisor, chat reactions, GIF picker, chat reporting, removed-message tombstones, draft queue, slot preference and its post-draw outcome, owed picks | **SURFACED** | Verified above; confirm and move on. |
| `SYSTEM_ACTION_CODES` (8) | **Verify each** | The parent's Task 14 Step 4 proves every code has a **publisher**. This step proves every code has a **reader**: an `activityRowFor` branch and a member-facing surface, or a notice template that reaches the member, or an explicit visibility of nothing-to-show with a reason. |

- [ ] **Step 3: Write the failing enforcement tests**

Three, and each one is cheap on purpose: an inventory whose only guard is a document is an inventory that is wrong within a phase.

```ts
// src/help/glossary.source.test.ts
/**
 * Ten of twenty terms had no caller when this test was written. The fix is not to delete them
 * (they are correct definitions of things this product genuinely has) and not to leave them
 * unenforced: it is to make "unsurfaced" a decision somebody makes on purpose, with a reason,
 * in a list a reviewer can read.
 */
const UNSURFACED: Readonly<Record<TermKey, string>> = {
  // filled in by Step 4 with the terms that genuinely have no honest home yet, each with why
};

it("keeps every glossary term either wired to an InfoTip or listed with a reason", () => {
  const used = new Set(
    sourceFilesIn(["src/app", "src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room"])
      .filter((file) => !file.path.endsWith(".test.tsx"))
      .flatMap((file) => [...file.text.matchAll(/term="([\w-]+)"/g)].map((m) => m[1]!)),
  );
  for (const key of Object.keys(GLOSSARY) as TermKey[]) {
    expect(used.has(key) || key in UNSURFACED, `Glossary term "${key}" has no InfoTip caller and no stated reason.`).toBe(true);
  }
});

it("never lists a term as unsurfaced while something actually renders it", () => {
  // The reverse direction, which is what stops the allowlist becoming a graveyard.
});
```

```ts
// src/integrity/system-action-surfaces.test.ts
it("gives every system action a reader, not just a writer", () => {
  // The parent's inert-deliverable sweep proves each code is PUBLISHED. This proves each one
  // reaches a person: an activity row, a notice template, or an explicit "nothing to show" with
  // its visibility as the reason.
  for (const code of SYSTEM_ACTION_CODES) {
    expect(readerFor(code), `System action "${code}" is written and never read.`).not.toBeNull();
  }
});
```

```ts
// src/integrity/service-map.source.test.ts
it("names every service module in the surface map, so a new one cannot ship unlisted", () => {
  // Deliberately MODULE-level, not export-level. A test that parses a markdown table of 300
  // exports is a test that breaks on a typo and teaches nobody anything; a test that fails the
  // day a fifteenth service directory appears with no row is the one that actually protects the
  // founder's directive.
  const documented = readFileSync("docs/backend-surface-map.md", "utf8");
  for (const dir of serviceDirectories()) expect(documented).toContain(dir);
});
```

- [ ] **Step 4: Wire what this addendum owns, list what it does not**

The ten orphan glossary terms are triaged here and wired in the task that owns their surface: `stake-tier`, `matchup` and `standings-record` belong to the parent's league space (Task 11) and are handed to it by name in this step's ledger note rather than duplicated here; `ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `snake-draft` and `auction-draft` are format vocabulary and land on the surfaces this addendum designs that actually say those words (the league-rules page, Task 21; the invite landing's terms, Task 20). Anything left over goes into `UNSURFACED` with its sentence. **A term with neither a caller nor a sentence fails Step 3's test, which is the point.**

- [ ] **Step 5: The reorder ruling**

If the walk finds a GAP that changes the shape of Tasks 16 to 21, it is recorded in this task's commit body and the affected task's **Files** block is amended in the same commit. A plan that discovers work and then executes the version of itself written before the discovery is a plan pretending to be a schedule.

- [ ] **Step 6: Commit**

---

## Task 16: The way in

The front of the funnel, and the largest hole in the parent plan: a visitor's intent survives the middleware and dies at every link we wrote ourselves. Nothing here takes a credential.

**Files:**
- Create: `src/lib/auth/return-to.ts` (+ its test)
- Create: `src/components/app-shell/sign-in-link.tsx`, `public-bar.tsx`, `session-watch.ts`, `session-notice.tsx` (+ their tests)
- Create: `src/app/sign-in/problem/page.tsx` (+ its test)
- Modify: `src/app/sign-in/route.ts`, `src/app/sign-up/route.ts` (+ new tests), `src/app/callback/route.ts`
- Modify: `src/app/reviews/page.tsx`, `src/app/app/join/[code]/page.tsx` (the two verbatim header copies die here)
- Modify: `src/account-room/hooks/deps.tsx`, `src/league-room/hooks/deps.tsx`, `src/chat-room/hooks/deps.tsx`, `src/draft-room/hooks/deps.tsx`
- Modify: `src/components/app-shell/top-bar.tsx` (the session strip's slot), `src/integrity/rendered-copy.test.tsx`
- Create: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `getSignInUrl`, `getSignUpUrl`, `handleAuth`, `signOut` (`@workos-inc/authkit-nextjs`), `TopBar`, `Modal`, `StatPill`.
- Produces: `safeReturnTo`, `SignInLink`, `PublicBar`, `fetchWithSessionWatch`, `onSessionLost`, `SessionNotice`.

- [ ] **Step 1: Write the failing tests, starting with the one that is an open-redirect test**

```ts
// src/lib/auth/return-to.test.ts
it("accepts a same-origin path and hands it back unchanged", () => {
  expect(safeReturnTo("/join/lg_bandits/hold")).toBe("/join/lg_bandits/hold");
  expect(safeReturnTo("/app/leagues/lg_bandits?week=3")).toBe("/app/leagues/lg_bandits?week=3");
});

it("refuses every shape that could send somebody somewhere else", () => {
  // The SDK's callback only ever applies `.pathname` and `.search` to OUR request url, so none of
  // these could actually leave our origin today. We refuse them anyway: a validator that relies
  // on a dependency's internals is a validator that breaks silently the day that dependency is
  // upgraded, and this is the one function in the product whose job is to be paranoid.
  for (const hostile of ["//evil.example", "https://evil.example/x", "http:/evil", "/\\evil.example", "javascript:alert(1)", "", " ", null]) {
    expect(safeReturnTo(hostile)).toBeNull();
  }
});

it("refuses a path back to the auth routes themselves, because a loop is not a destination", () => {
  for (const loop of ["/sign-in", "/sign-up", "/callback", "/sign-out", "/sign-in/problem"]) {
    expect(safeReturnTo(loop)).toBeNull();
  }
});
```

```tsx
// src/components/app-shell/sign-in-link.test.tsx
it("carries where the visitor is standing, so signing in does not lose their place", () => {
  renderSurface(<SignInLink intent="/join/lg_bandits/hold" />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Fjoin%2Flg_bandits%2Fhold");
  });
});

it("falls back to a plain sign-in when there is no intent worth keeping", () => {
  renderSurface(<SignInLink intent={null} />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });
});
```

```ts
// src/app/sign-in/route.test.ts — the SDK module is mocked, which is where this contract lives
it("asks WorkOS to come back to the visitor's own intent", async () => {
  await GET(new Request("http://localhost/sign-in?returnTo=%2Fjoin%2Flg%2Fhold"));
  expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: "/join/lg/hold" });
});

it("ignores an intent it would not trust, and still signs the person in", async () => {
  await GET(new Request("http://localhost/sign-in?returnTo=https%3A%2F%2Fevil.example"));
  expect(getSignInUrl).toHaveBeenCalledWith({});
});
```

- [ ] **Step 2: The intent, wired end to end**

`src/app/sign-in/route.ts` becomes:

```ts
export async function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  redirect(await getSignInUrl(returnTo === null ? {} : { returnTo }));
}
```

`sign-up/route.ts` is the identical shape over `getSignUpUrl`. **`callback/route.ts` keeps `returnPathname: "/app"` unchanged** and gains nothing but an `onError`: the sealed state already beats it (`dist/esm/authkit-callback-route.js:76`, quoted in this file's own new docblock so the next reader does not have to go find it), so `/app` is exactly the right fallback for a sign-in with no intent, and a task that churns a working callback to prove it was here has made the diff worse.

**One cross-task constraint, and it is load-bearing for the parent's Task 6:** the seat-hold cookie must still be sent when the browser lands back on `/join/[leagueId]/hold` from WorkOS. `SameSite=Lax` allows it (a top-level GET navigation), but a `Path` scoped to the hold's API route would not be readable by the interstitial page or by the join door. **The hold cookie's `Path` must cover `/join` and `/api/public/leagues`, and the simplest correct answer is `Path=/`.** Path is a scoping convenience, never a security boundary; `httpOnly`, `SameSite=Lax` and the token's opacity are what carry the security, exactly as the parent's Task 6 Step 3 already argues. This step writes that sentence into the parent task's ledger note and asserts it in `e2e/auth.spec.ts`'s hold journey.

- [ ] **Step 3: One sign-in link and one signed-out bar, and the copies die**

`SignInLink` is the only way to render a sign-in entry point after this step; the three hand-written `<Link href="/sign-in">` call sites (`reviews/page.tsx:25` and `:75`, `app/join/[code]/page.tsx:44`) are refactored onto it **in this commit**, each passing the page's own path as `intent`, and the front door's own entry points (the parent's Task 5) are handed the same component by name. `PublicBar` absorbs the two verbatim headers. Both are added to `rendered-copy.test.tsx`'s roster here.

- [ ] **Step 4: The arrival, and the failure**

A successful callback is a redirect and has no screen; what it must not do is dump somebody at a stranger's front door with no idea whether it worked, so the arrival is judged at the destination and the destinations are Task 17 and the parent's Task 6. A **failed** callback today renders whatever AuthKit's own error path renders. `handleAuth` gains an `onError` that redirects to `/sign-in/problem`, a real page with the product's chrome that says what happened in plain language, offers **try again** (a `SignInLink` carrying the same intent, read from the query string through `safeReturnTo`) and offers a way to the front door. No digest, no error text, no provider name. Never a dead end.

- [ ] **Step 5: The session that died under a page that is still open**

`fetchWithSessionWatch` wraps `fetch` once, and the four rooms' `BROWSER_DEPS.fetchJson` become one-line delegates to it. On a `401` with our own envelope shape it emits `SESSION_LOST_EVENT` and hands the response back unchanged, so every existing error path keeps working exactly as it does today.

`SessionNotice` listens, and the escalation is deliberate:

- A **background** read failing (the notices poll, a score refresh) renders a quiet strip in the top bar: *"You are signed out. Sign in to pick up where you left off."* with a `SignInLink` carrying the current path. It does not steal focus, does not trap a keyboard, and does not interrupt somebody mid-sentence in league chat.
- A **user-initiated write** failing escalates to a `Modal`, because the person just tried to do something and it did not happen, and telling them quietly would be telling them nothing. The modal names the thing that did not happen, in the caller's words, and offers the same link.

**It never says the work was saved, and it never claims it was lost when we do not know.** The one sentence it is allowed about state is the true one: *"Nothing you typed was sent."*

- [ ] **Step 6: The e2e, stopped at the boundary**

`e2e/auth.spec.ts`, three tests, none of which touches a hosted form:

1. From `/reviews` signed out, clicking **Sign in** leaves our origin for the AuthKit host, and the destination carries our `redirect_uri` and a `state` parameter. Asserted on the URL, click-and-verify, retried (the SSR-fake discipline).
2. `/sign-in?returnTo=<hostile>` still leaves for AuthKit and the hostile value appears nowhere in the outgoing URL.
3. Sign-out through the existing `managerSignOut` fixture still walks the whole WorkOS chain and lands back on our own origin, which `next.config.ts`'s CSP already has a documented test for; this re-runs it end to end after the chrome moved.

- [ ] **Step 7: Persona panel — the stranger at the threshold (dual mandate)**

Personas: the seat-hold visitor mid-signup, the returning manager on a new device, the skeptic who will not sign in before reading, the first-timer who does not know what "AuthKit" is, and the person whose session died during a draft.

UX questions: does leaving our site for a WorkOS page read as a handoff or as a hijack; does a returning visitor land where they were; does the session strip feel like a courtesy or a scold; does anybody think they need a password before they can look around.

**Backend gap flags:** what did each persona try that nothing supports (changing the email they sign in with, seeing their active sessions, signing out everywhere, deleting the account)?

- [ ] **Step 8: Commit**

---

## Task 17: First run, from the callback to a seat

The journey the product has never designed as a journey: a brand new account lands on `/app` and gets a fork, and the two facts that decide what leagues they can even see are set silently.

**Files:**
- Modify: `src/app/app/page.tsx`, `src/league-room/components/first-run-panel.tsx` (+ its test)
- Modify: `src/account-room/components/profile-form.tsx` (+ its test) — a compact variant, not a second form
- Modify: `e2e/onboarding.spec.ts`, `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `firstRunPlan`, `FirstRunPlan`, `ProfileForm`, `Panel`, `Crest`, `AppShell`.
- Produces: `FirstRunPanel`'s identity step. No new data, no new route, no column.

- [ ] **Step 1: Write the failing first-run tests**

```tsx
it("asks a brand new manager who they are, before it asks them to pick a league", () => {
  renderSurface(<FirstRunPanel plan={zeroLeagues} profile={fresh} />, ({ getAllByRole }) => {
    expect(getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Set up your manager profile");
  });
});

it("stops asking the moment they are in a league, with nothing to dismiss and nothing stored", () => {
  // Derived-only, exactly like the parent's attention queue (ruling 11). The identity step is
  // shown while `firstRunPlan` is non-null, which is precisely "this manager has zero leagues".
  // Joining is the dismissal; there is no seen-flag, no column and no snooze.
  renderSurface(<FirstRunPanel plan={null} profile={fresh} />, ({ container }) => {
    expect(container.textContent).not.toContain("Set up your manager profile");
  });
});

it("says what the experience answer actually does, because it decides which leagues they can see", () => {
  renderSurface(<FirstRunPanel plan={zeroLeagues} profile={fresh} />, ({ getByText }) => {
    expect(getByText("Some leagues are kept for newer players. Your answer here decides which ones you see.")).toBeInTheDocument();
  });
});

it("renders the same ProfileForm the profile page renders, not a second one", () => {
  // The founder's centralization rule, tested: a first-run copy of the name and tier fields is
  // exactly the page-local mapping that rule exists to stop, and it would drift within a phase.
});
```

- [ ] **Step 2: The identity step, composed rather than rewritten**

`ProfileForm` gains a `variant: "page" | "first-run"` that changes its heading and its density and **nothing about its fields, its validation, its endpoint or its success copy**. `FirstRunPanel` renders it as the first card, above the three paths `firstRunPlan` already orders. A manager who ignores it loses nothing: every field has a working default and the three paths are all still real, immediately usable controls (guidance is ordering, never removal, which is `first-run.ts`'s own existing rule).

- [ ] **Step 3: The seat-hold arrival**

A visitor who came through the parent's hold interstitial does **not** land here: Task 16's `returnTo` puts them back on `/join/[leagueId]/hold`, where the parent's Task 6 either seats them or shows them the race loser. This step's only job is to make sure `/app` is not the destination for that person, and to assert it: a first-run manager arriving with an intent is a bug in Task 16, and the test that catches it lives here because this is the page that would have wrongly rendered.

- [ ] **Step 4: The arrival for everybody else, in the shell**

`/app`'s first-run branch renders inside `AppShell` with an empty rail (there are no leagues yet), which is the one state the rail must not render as a broken row of nothing: it renders its "join or create" control alone, with the accessible name saying so. The parent's Task 2 owns the rail; this step owns its zero-league state and asserts it.

- [ ] **Step 5: Persona panel — the first ninety seconds (dual mandate)**

Personas: the first-timer who has never played fantasy, the veteran migrating from another platform, the friend who followed an invite link, the seat-hold visitor.

UX questions: does the identity step read as a form wall or as one useful question; does a veteran resent being asked; does anybody reach the fork without understanding what a league is; is the zero-league rail a bug on sight.

**Backend gap flags:** import my league from another platform, invite friends by email at signup, "play a practice draft first" (already deferred at the parent's D5 — a second persona hit strengthens its backlog row rather than reopening it).

- [ ] **Step 6: Update `e2e/onboarding.spec.ts` in this commit**

Two tests today. The fork's structure moves (the identity card is first), so the heading assertion `toHaveText(["Find an open league", "Join with an invite", "Start a league"])` moves with it, **deliberately and named in the commit body**, not loosened to a substring search. The copy assertions stay exactly as they are; if one breaks, this task changed copy it had no business changing.

- [ ] **Step 7: Commit**

---

## Task 18: The account room

`/app/profile` is the only write path this product has to who a person is, and it is a stack of five sections in an 896px column. It becomes a room, and it gains the one fact about themselves the product has been keeping from them.

**Files:**
- Modify: `src/app/app/profile/page.tsx`
- Modify: `src/account-room/components/profile-form.tsx`, `avatar-picker.tsx`, `help-level-form.tsx`, `notification-summary.tsx`, `review-composer.tsx`, `notice-inbox.tsx` (+ their tests)
- Create: `src/account-room/components/standing-panel.tsx` (+ its test)
- Modify: `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `readProfile`, `readPreferences`, `myReview`, `completedSeasonsFor`, `participationTierFor`, `isVerifiedPlayer`, `VERIFIED_BADGE_LABEL`, `Panel`, `Crest`, `StatPill`, `AppShell`.
- Produces: `StandingPanel`. No new route, no new service function.

- [ ] **Step 1: Write the failing account-room tests**

```tsx
// src/account-room/components/standing-panel.test.tsx
it("tells a manager their own standing, in seasons and in plain words", () => {
  renderSurface(<StandingPanel seasons={2} tier="experienced" verified />, ({ getByText }) => {
    expect(getByText("2 seasons finished on Commish")).toBeInTheDocument();
    expect(getByText("Every open league is available to you.")).toBeInTheDocument();
  });
});

it("says what a newer manager's standing opens, never what it costs them", () => {
  // The tier axis exists to keep newer players with newer players. Framed as a refusal it reads
  // as a punishment for being new; framed as what it is, it is the reason their first league is
  // not twelve veterans.
  renderSurface(<StandingPanel seasons={0} tier="new" verified={false} />, ({ getByText }) => {
    expect(getByText("Leagues kept for newer players are open to you.")).toBeInTheDocument();
  });
});

it("says nothing at all about any other manager", () => {
  // Ruling 30. This panel is about the reader. It is not the refused per-manager tag (D6) wearing
  // a different hat, and the test that keeps it that way is the one that asserts the absence.
  renderSurface(<StandingPanel {...anyProps} />, ({ container }) => {
    expect(container.textContent).not.toMatch(/other manager|in this league|compared/i);
  });
});

// src/account-room/components/notice-inbox.test.tsx
it("says how much history it keeps, rather than implying it keeps all of it", () => {
  // The inventory's HIGH: `listNotices` has no cursor and caps at the inbox size, so notices
  // older than the cap are unreachable. The design answer while that is true is one honest
  // sentence, not a scroll that quietly ends.
  renderSurface(<NoticeInbox />, ({ getByText }) => {
    expect(getByText(`Your last ${INTEGRITY_CONFIG.notices.inboxSize} notices.`)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: The room's shape**

Full-bleed under `AppShell`, two columns at `lg` and one below: **who you are** (crest-scale `Avatar`, `ProfileForm`, `AvatarPicker`) beside **how the product treats you** (`HelpLevelForm`, `NotificationSummary`, `StandingPanel`), with **what you told the world** (`ReviewComposer` plus the link to the public feed) below both, at measured-paragraph width because it contains prose somebody writes.

- [ ] **Step 3: The account facts, stated and not invented**

The page states the email that identifies the account, read from `CurrentUser.email`, as text and not as a field: **this product cannot change it, and a disabled input is a control that lies about being one.** One sentence says where sign-in is managed, and it does not link to a WorkOS-hosted page whose existence this plan has not verified. Changing an email, adding MFA, seeing active sessions and deleting an account are **four backlog rows** filed by this task's persona panel, not four controls invented here.

- [ ] **Step 4: `NotificationSummary` gains no control, and says why better**

The catalog stays read-only (its own docblock's argument holds and this plan agrees with it), retoned onto `Panel`, with the email line kept as a statement. The founder's rule against a switch wired to nothing is the whole design.

- [ ] **Step 5: Persona panel — the manager looking at themselves (dual mandate)**

Personas: the veteran auditing what the product knows, the first-timer who does not know what "help level" means, the reviewer who left one star and wants to change it, the privacy-minded skeptic.

UX questions: is anything here a control that does not do what it says; does the standing panel read as encouragement or as a scoreboard; can the skeptic tell what is public (their review, their display name, their avatar) from what is not.

**Backend gap flags:** change my email, delete my account, export my data, see my sessions, mute one league's notices, turn a topic off, read a notice from last month.

- [ ] **Step 6: Commit**

---

## Task 19: The operator console

Phase 3 Plan B's queue is where this product keeps its promises about fairness, and it currently looks like a list of index cards. It becomes dense and readable, and not one authorization check moves.

**Files:**
- Modify: `src/app/app/admin/queue/page.tsx`, `src/app/app/admin/queue/[flagId]/page.tsx` (+ their tests)
- Create: `src/admin-room/components/queue-table.tsx` (+ its test)
- Modify: `src/admin-room/components/held-trade-detail.tsx`, `resolution-form.tsx` (+ their tests)
- Modify: `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `withAdmin`, `listPendingFlags`, `flagDetail`, `queueRowFor`, `DECISION_PHRASE`, `Table` (dense), `Panel`, `StatPill`, `AppShell`.
- Produces: `QueueTable`. **No new route, no new service call, no new decision.**

- [ ] **Step 1: Write the failing console tests, starting with the authorization one**

```ts
// src/app/app/admin/admin-routes.test.ts — the existing tripwire, re-run
it("still routes every admin surface through the one gate, after the redesign", async () => {
  // A rendering task that touched an authz check would fail here. This test existed before this
  // plan; this step's job is to keep it green WITHOUT EDITING IT, which is the actual acceptance
  // criterion for the whole task.
});

it("calls requireAdmin from nowhere but _shared.ts, still", () => { /* the existing scan */ });
```

```tsx
// src/admin-room/components/queue-table.test.tsx
it("keeps oldest first, with no sort control and no severity column", () => {
  // Plan B's ruling 30: oldest-first with no severity ranking IS the discipline, not a default.
  // A dense table is exactly where somebody would reflexively add sortable headers.
  renderSurface(<QueueTable rows={mixed} />, ({ queryByRole, getAllByRole }) => {
    expect(queryByRole("button", { name: /sort/i })).toBeNull();
    expect(getAllByRole("row")[1]).toHaveTextContent(oldest.question);
  });
});

it("says the queue is clear without saying nothing is happening", () => {
  renderSurface(<QueueTable rows={[]} />, ({ getByText }) => {
    expect(getByText("The queue is clear.")).toBeInTheDocument();
    expect(getByText("Nothing is waiting on a decision right now.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: The queue, dense**

`Table density="dense"`: waiting-since, what the question is, who or what it is about, and the flag's icon. The `Load more` link stays a real navigation carrying `?before=` (reads with no JavaScript at all, the existing discipline), and its label stays `Load more` for the documented reason that this queue pages forward through time. The empty state is the state an operator sees most and it is designed first.

- [ ] **Step 3: The detail page, two columns**

Left, the evidence a decision is made from: the subject card, the raw evidence list, the reporters, the trail. Right, sticky at `lg` and inline below it, the decision: `ResolutionForm` with its notice previews, or `ResolutionSummary` when the flag is already resolved. `HeldTradeDetail` keeps its own whole-surface dispatch exactly as it is. **The offered decision set is untouched**: `decisionsFor`'s two filters (removal not wired, content already removed) are behavior this task must not "simplify".

- [ ] **Step 4: The operator is a person and the copy sweeps know it**

Every string on both pages is user-facing copy: no accusatory terms, no passive constructions, no dashes. The two page files and `queue-table.tsx` are added to `rendered-copy.test.tsx`'s roster here, and `room-copy.source.test.ts`'s existing coverage of `src/admin-room` is re-run.

- [ ] **Step 5: Persona panel — the operator at 11pm (dual mandate)**

Personas: the founder as sole operator, a future second operator with no context, and (as a thought experiment, never as a viewer) the member whose flag this is.

UX questions: can an operator answer "what happened here" without leaving the page; is the decision reversible-looking when it is not; does the trail read chronologically at a glance; does anything on screen tempt an operator toward the fastest decision rather than the right one.

**Backend gap flags:** search the queue, see one member's history across flags, undo a decision, hand a flag to another operator, message the reporter, see chain-verification health from the console.

- [ ] **Step 6: Commit**

---

## Task 20: The two public rooms — the review feed and the invite landing

Both are surfaces a stranger judges the product on before they have an account, and neither has ever been designed.

**Files:**
- Modify: `src/app/reviews/page.tsx`, `src/account-room/components/review-feed.tsx` (+ its test)
- Modify: `src/app/app/join/[code]/page.tsx`, `src/league-room/components/join-form.tsx` (+ its test)
- Create: `src/league-room/components/invite-landing.tsx` (+ its test)
- Modify: `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `listReviews`, `myReview`, `browseAllowed`, `invitePreview`, `LeagueTerms`, `PublicBar`, `SignInLink`, `Panel`, `Crest`, `SeatMeter`.
- Produces: `InviteLanding`. No new route, no new service function.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/account-room/components/review-feed.test.tsx
it("offers no way to reorder or filter what people said", () => {
  // A4. The founder's claim is that these are unedited, good and bad. A "highest rated" control
  // would make that claim false while leaving every review technically present.
  renderSurface(<ReviewFeed initialPage={page} emptyAction={null} />, ({ queryByRole }) => {
    expect(queryByRole("button", { name: /sort|filter|highest|helpful/i })).toBeNull();
  });
});

it("says what reporting a review does and does not do", () => {
  renderSurface(<ReviewFeed initialPage={page} emptyAction={null} />, ({ getByText }) => {
    expect(getByText("Report reviews that break the rules. Disagreeing with a rating isn't a reason to report it.")).toBeInTheDocument();
  });
});

// src/league-room/components/invite-landing.test.tsx
it("renders a real action for a code that has expired, not an apology", () => {
  renderSurface(<InviteLanding state={{ kind: "expired" }} />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
  });
});

it("tells a visitor who is already in this league that they are, and takes them there", () => {
  renderSurface(<InviteLanding state={{ kind: "already-member", leagueId: "lg_1", name: "Bay Bandits" }} />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Go to Bay Bandits" })).toHaveAttribute("href", "/app/leagues/lg_1");
  });
});

it("shows a signed-out visitor the terms and one way in, with their place kept", () => {
  renderSurface(<InviteLanding state={{ kind: "open", terms }} signedIn={false} code="abc" />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Fapp%2Fjoin%2Fabc");
  });
});
```

- [ ] **Step 2: The review feed as a room**

`PublicBar` or `AppShell` depending on who is looking (the existing branch, now with the duplication gone), a full-bleed frame, and the reviews themselves in a **measured paragraph column** because they are prose. The rating and the date are `font-mono` and tabular; the verified badge stays exactly where it is and means exactly what it meant. The rate-limit refusal keeps its own copy and gains the chrome.

**No aggregate lands on this page.** The parent's Task 4 computes an average and a count for the front door with a credibility floor behind it; repeating it above the feed would put a summary statistic at the top of the one surface whose promise is that nothing is summarized.

- [ ] **Step 3: The invite landing's nine states**

`InviteLanding` takes a discriminated state and renders one of: **open** (the league's terms, its seats through `SeatMeter`, and either `JoinForm` or a `SignInLink` carrying `/app/join/[code]` as intent), **invalid**, **expired**, **exhausted**, **already a member**, **league full**, **draft already started**, **tier refused**, and **signed out on any of the above**. The three refusal sentences come from `src/league-service/invites.ts` unchanged. Every state carries an action, and for the five dead codes the action is the shelf, because a stranger who wanted into a league is one click from a league that wants them.

A code naming a house league cannot exist (house leagues take no invites), so there is no tenth branch for it: it is `invalid`, which is also the non-oracle answer.

- [ ] **Step 4: Persona panel — the stranger holding a link (dual mandate)**

Personas: the friend who was invited, the skeptic reading reviews before signing up, the person whose invite expired, the manager already in the league who clicked their own link.

UX questions: does an expired code feel like a closed door or like a redirect; can the skeptic tell nothing has been curated; does the terms panel say enough to decide with; does "Sign in to join" read as a paywall.

**Backend gap flags:** ask the commissioner for a new invite, see who else is in the league before joining, filter reviews by what they mention, reply to a review, verify a reviewer actually played.

- [ ] **Step 5: Commit**

---

## Task 21: The edges — every state that is not a page

Error, not-found, loading, and the four pages the footer promises. These are the surfaces nobody designs and everybody sees.

**Files:**
- Modify: `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/global-error.tsx`, `src/app/error-surfaces.test.tsx`
- Create: `src/components/app-shell/app-shell-skeleton.tsx` (+ its test), `src/app/loading.tsx`, `src/app/app/loading.tsx`, `src/app/app/drafts/[draftId]/loading.tsx`
- Create or modify (whichever the parent's Task 5 left): `src/app/legal/terms/page.tsx`, `src/app/legal/privacy/page.tsx`, `src/app/support/page.tsx`, `src/app/league-rules/page.tsx`
- Modify: `src/components/ui/config.ts` (skeleton geometry), `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `ErrorState`, `EmptyState`, `Skeleton`, `PublicBar`, `UI_CONFIG.shell`, `GLOSSARY`.
- Produces: `AppShellSkeleton`, `UI_CONFIG.skeleton`.

- [ ] **Step 1: Write the failing edge tests**

```tsx
// src/app/error-surfaces.test.tsx — extended; its `inBothThemes` calls became `renderSurface`
// in the parent's Task 1
it("offers a signed-out visitor somewhere they can actually go", () => {
  // Today every action on both surfaces points at /app, which for a stranger who followed a bad
  // public link is a bounce straight into hosted sign-in. The way out of a 404 must not require
  // an account.
  renderSurface(<NotFound />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
    expect(getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });
});

it("still never prints the raw exception, after the retone", () => { /* the existing assertions, unchanged */ });
```

```tsx
// src/components/app-shell/app-shell-skeleton.test.tsx
it("holds the shell's exact geometry, so nothing jumps when the real page arrives", () => {
  renderSurface(<AppShellSkeleton />, ({ getByTestId }) => {
    expect(getByTestId("shell-skeleton")).toHaveAttribute("aria-busy", "true");
  });
});

it("announces nothing it cannot know, and names no league", () => {
  // A skeleton rail with fake crests is mock data on a real surface.
  renderSurface(<AppShellSkeleton />, ({ container }) => {
    expect(container.textContent?.trim()).toBe("Loading");
  });
});
```

- [ ] **Step 2: The loading strategy, argued against what the App Router actually does**

Three facts decide it. **(a)** There is no `loading.tsx` anywhere today, so every navigation holds on the old page and swaps. **(b)** The parent's ruling 8 makes `AppShell` a **component the page renders**, not a route-group layout, because a layout cannot receive `currentLeagueId`. That means a route-level `loading.tsx` renders **without** the shell unless it draws one itself. **(c)** `loading.tsx` applies to its own segment and every segment nested under it, until a deeper one overrides.

The ruling is therefore: **one `loading.tsx` per chrome, three in total, all rendering the same `AppShellSkeleton` or its room-shaped sibling, and Suspense inside a page only where a single region is genuinely slower than the rest of it.**

- `src/app/app/loading.tsx` renders the signed-in shell's geometry (rail column, top bar band, content) with no data at all. It is inherited by profile, leagues, admin, join and matchups, which is the whole point: one file, not ten.
- `src/app/app/drafts/[draftId]/loading.tsx` overrides it with the room's bands, because the room renders no shell and inheriting one would show a rail for 400ms that the room then deletes.
- `src/app/loading.tsx` renders the public bar's geometry for the front door, browse, reviews, the invite landing and the hold interstitial.

Per-page skeletons are **refused**: a skeleton that mimics a specific page's content is a second copy of that page's layout, maintained by nobody, wrong within a phase. Route handlers (`/sign-in`, `/callback`, `/sign-out`) are unaffected by `loading.tsx` and get nothing.

- [ ] **Step 3: Error and not-found, in the product**

Both keep every behavior `error-surfaces.test.tsx` asserts (no raw exception text, the digest as a quiet reference, `role="alert"` on the error and **not** on the not-found, a real action) and gain the v2 ground, the `PublicBar` for a visitor with no session, and a second action that does not require an account. `global-error.tsx` keeps rendering its own `<html>`/`<body>` and importing `globals.css` directly; its docblock's reference to `ThemeProvider` is corrected in this commit, because the parent's Task 1 deleted it.

- [ ] **Step 4: The four pages the footer promises**

Terms, Privacy, Support and League rules, each a real page at measured-paragraph width with the product's chrome. **Support is where the operator dispute path finally gets its user-facing entry** (the thing the 3.5 loop deferred): what the queue is, what gets reviewed, what a report does and does not do, what to expect and how long it takes, and the two report paths that actually exist today (a review, a chat message) named honestly, with the things that have no path today named as things that have no path today rather than implied. League rules is where the format vocabulary lands, and it is where Task 15 Step 4's orphan glossary terms (`ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `snake-draft`, `auction-draft`) get their first real caller.

**A footer link to a 404 is worse than no footer**, so this task's own step asserts every footer target resolves.

- [ ] **Step 5: Persona panel — the person having a bad moment (dual mandate)**

Personas: the visitor who hit a 500 mid-draft, the stranger on a stale link, the person on a slow phone connection, the member looking for somebody to complain to.

UX questions: does the error read as honest or as a shrug; can somebody with no account get anywhere from a 404; does the skeleton reduce the felt wait or just add a flicker; does the support page give a real expectation or a corporate non-answer.

**Backend gap flags:** contact support directly, see the status of a report I filed, an incident or status page, get an email when a bad thing is fixed.

- [ ] **Step 6: Commit**

---

## Task 22: Closeout — the backlog, the extended gauntlet, the docs, the battery

**Files:**
- Create: `docs/research/2026-08-23-backend-gaps-backlog.md`, `docs/decisions/auth-front-door.md`
- Modify: `docs/conventions.md`, `docs/design-system.md`, `docs/league.md`, `README.md`, `plans/00-roadmap.md` (the same one line the parent's Task 14 Step 3 wrote, gaining this file's name)
- Create: `e2e/whole-site.spec.ts`; modify `e2e/mobile-360.spec.ts`

- [ ] **Step 1: The backend gaps backlog, with names on it**

Every BACKEND GAP FLAG from Tasks 16 to 21, plus every one the extended gauntlet raises in Step 2, plus the GAP rows Task 15 could not assign. One table:

| # | The gap, in the persona's words | Persona | Severity | Suggested owner phase | What exists today |
|---|---|---|---|---|---|

Severity is about the person, not the build cost: **HIGH** is somebody cannot do a thing the product implies they can; **MEDIUM** is a real want with an honest workaround; **LOW** is a nice-to-have. The seeded HIGHs from the inventory are already known: notice history past the cap, no way to change the email you sign in with, no way to raise a question about anything except a review or a chat message. **Nothing in this file is implemented in Phase 3.6**, and the file says so at the top.

- [ ] **Step 2: The extended gauntlet, dual mandate, on the running product**

The parent's Task 14 Step 5 walks six personas front door to draft room against the shipped product. This step extends that same gauntlet rather than running a second one: **seven personas** (the six plus the operator), **the whole site** (adding sign-in, first run, profile, admin, reviews, invite landing, error, 404, loading, and the four trust pages), and **both mandates** (UX verdicts plus backend gap flags). Every HIGH from every panel in the parent and this addendum is checked off as fixed, deferred with its reason, or refused with its reason. The founder's bar is quoted at the top of the brief and is the acceptance criterion.

- [ ] **Step 3: The auth decision doc, including the dashboard runbook**

`docs/decisions/auth-front-door.md`: why there is no sign-in page and never will be; the exact code-side levers the installed SDK exposes (the list in A1, with the file and line each was read from); the state-beats-option precedence fact with its source line; `safeReturnTo`'s refusal list and why it is paranoid about something the SDK already prevents; the session-expiry escalation rule; and **the WorkOS dashboard runbook** — the settings that make the hosted screen match v2 (logo, brand and background color against `#0B0C0F`, dark appearance, the enabled authentication methods, the redirect URI, the sign-in endpoint, and a custom auth domain if the founder wants one), each written as a step to perform and verify **in the live dashboard**, with a note that the exact control names are to be read off the dashboard rather than trusted from this document.

- [ ] **Step 4: Drift**

`docs/conventions.md`'s auth line grows `returnTo` and the intent rule; the notices cap is stated where `listNotices` is described. `docs/design-system.md` gains `PublicBar`, `SignInLink`, `AppShellSkeleton`, the loading strategy and the measured-paragraph page list. `docs/league.md` gains the invite landing's states. `README.md` gains nothing but accuracy.

- [ ] **Step 5: The whole-site e2e**

`e2e/whole-site.spec.ts`: one journey that touches every surface this addendum designed and asserts each one rendered its own chrome and its own first heading, plus a 404 walk that reaches `/browse` without an account. `e2e/mobile-360.spec.ts` grows the addendum's surfaces into its existing loop, with its existing assertion (no horizontal overflow, every control reachable, nothing clipped) unchanged.

- [ ] **Step 6: The closing battery**

The parent's Task 14 Step 6 battery, run again with this addendum's work in the tree: cold `npm run infra:up` · both parent migrations forward · `npm run seed` · `npm run audit:verify -- --full` · `npm run integrity:sweep` · `npm run trades:sweep` · unfiltered `npm test` · unfiltered `npm run test:coverage` with every gate at 100%, the gate count **read off `vitest.config.mts`** · the suite through PgBouncer with `lock-order.test.ts` green at its own measured count · `npm run typecheck && npm run lint && npm run build` · **`npm run e2e` twice**, green both times, every original journey plus the parent's plus this addendum's two new spec files.

- [ ] **Step 7: Present the backlog to the founder, and commit**

The backlog is the deliverable of founder directive 2's second half. It is presented as a list of things **we now know we need to build**, with the persona who found each one, not as a list of things that went wrong.

---

## Open questions, self-ruled (continuing the parent's numbering)

28. **The sign-in "design" is an entry point, an intent and an arrival, and never a form.** The founder rule is absolute and the SDK is not the constraint here: the constraint is that a credential form we own is a credential form we are responsible for, forever, in a product that is about to take money. What we gain by staying out is everything AuthKit already does (MFA, OAuth, password reset, breach detection, bot defense) and what we lose is exactly one thing: the hosted screen is not our pixels. Task 22's runbook is how we get most of them back, in the dashboard, where they belong.

29. **`returnTo` is validated by us even though the SDK already makes an open redirect impossible.** `handleAuth` applies only `.pathname` and `.search` of the sealed value to our own request URL, so `//evil.example` cannot leave our origin today. We validate anyway, in one function, with the hostile shapes enumerated as tests, because the alternative is a security property that lives in a dependency's implementation detail and breaks silently on upgrade. This is wrong only if the validator itself becomes the bug, which is why it is thirty lines with a refusal list rather than a URL parser of our own.

30. **A manager may see their own participation standing; nobody may see anybody else's.** The parent's ruling 19 refuses per-manager history tags in a room list because an aggregate over N=1 is not an aggregate and `compositionCategory`'s coarse reduction exists to hide exactly that. `StandingPanel` discloses a person's own count to themselves, which is the fact they already have and the axis that is already deciding what they can join. **This does not reopen D6** and the panel's own test asserts it says nothing about anyone else.

31. **The loading strategy is three `loading.tsx` files and no per-page skeleton.** Argued in Task 21 Step 2 from what the App Router actually does plus the parent's ruling 8. The alternative that looks idiomatic (a route-group layout owning the shell, so `loading.tsx` inherits it for free) is the thing ruling 8 already refused for `aria-current`, and reversing it inside an addendum would be a design phase overturning an architecture ruling in a footnote.

32. **The session-expired recovery escalates by what failed, not by what died.** A background poll's 401 is a strip; a user-initiated write's 401 is a modal. Treating them the same means either interrupting somebody mid-sentence over a poll, or silently swallowing the fact that the thing they just pressed did nothing. This is wrong if a strip is missed often enough that people keep working into a dead session, which the escalation is precisely designed to catch at the next write.

33. **The review feed gains no aggregate and no ordering control.** The front door quotes an average with a count and a floor behind it (the parent's Task 4); the feed itself stays newest-first and unadorned. A summary statistic at the top of the unfiltered feed is the first millimetre of curation, and the founder's claim is the asset being protected.

34. **The account page states the email and offers no control over it.** A disabled input is a control that lies. Four real gaps (change email, MFA, sessions, delete account) are filed with severities instead of mocked with switches, which is the same rule that keeps `NotificationSummary` control-free.

35. **The first-run identity step is derived from having zero leagues and stores nothing.** No seen-flag, no column, no snooze; joining a league is the dismissal. Identical in shape to the parent's ruling 11 for the attention queue, and for the same reason: a dismissal needs storage, an expiry policy and a test matrix, to solve a problem caused by showing something un-actionable.

36. **The operator console is a rendering change with a zero-diff authorization footprint, and a test proves it.** The redesign that quietly widens a gate is the single worst outcome available in this addendum, so the acceptance criterion for Task 19 is the existing tripwire staying green **without being edited**.

37. **The inventory's enforcement tests are module-level, not export-level.** A source test that parses a markdown table of three hundred exports fails on formatting and teaches nobody anything. Three cheap tests that fail on a real regression (an unwired glossary term, an unread system action, an undocumented service directory) are worth more than one expensive test that gets deleted the first time it is wrong.

38. **No capability discovered by the inventory is implemented in 3.6 unless it is a rendering of something that already exists.** The founder asked that backend functionality be fully leveraged and that gaps be flagged; those are two different instructions and this plan does both without confusing them. Leveraging is Tasks 16 to 21. Flagging is Task 22's backlog. Building the missing backends is a later phase with the founder's name on the priority order.

---

## Deferred and refused (continuing the parent's table)

| # | Item | Decision | The fact it waits on |
|---|---|---|---|
| D13 | A notices history page past `INTEGRITY_CONFIG.notices.inboxSize` | **Deferred, backlog HIGH** | `listNotices` takes no cursor. This is a service change, not a design change, and inventing a page over a read that cannot page would be the copy-without-mechanism failure this phase exists to stop. |
| D14 | Changing the email you sign in with, MFA enrolment, active sessions, account deletion | **Deferred, backlog HIGH/MEDIUM** | All four are WorkOS-side operations with no route in this product. Each needs an API call and a confirmation flow, and account deletion additionally needs a data policy nobody has written. |
| D15 | A member-facing way to raise a question about a trade, a draft or a manager | **Deferred, backlog MEDIUM** | `raiseFlag` is reachable only through `reportReview` and `reportMessage`. Task 21's support page names the two paths that exist and does not imply a third. |
| D16 | Moderation visibility in a house league | **Deferred, backlog MEDIUM** | `leagueModerationSummary` is commissioner-gated and a house league has no commissioner. Who is entitled to it there is an authority decision. |
| D17 | An operator console view of chain-verification health | **Deferred, backlog LOW** | `verifyAllChains` has a real operator surface (the npm script). A page needs its own authz surface and its own failure design. |
| D18 | Branding the AuthKit hosted screen from code | **Refused** | It is not code-configurable in the installed SDK. It is a dashboard runbook (Task 22 Step 3), and pretending otherwise would put a settings file in this repo that changes nothing. |
| D19 | A per-page loading skeleton | **Refused** (ruling 31) | A second copy of every page's layout, maintained by nobody. |
| D20 | A rating summary, sort or filter on `/reviews` | **Refused** (A4, ruling 33) | It would falsify the founder's own claim about the surface. |
| D21 | Reply-to-a-review, helpful votes, reviewer verification detail | **Refused for this phase** | Each is a new write path and a new moderation surface on the one page whose value is that it is not moderated into a shape. |

---

## Self-review

**Founder directive 1 ("the whole site design ... log in and everything"), screen by screen:**

| Screen | Where |
|---|---|
| Sign-in entry points, everywhere they appear | Task 16 Steps 2 and 3 (`SignInLink`, `PublicBar`, three call sites refactored) |
| The hosted AuthKit screen | Task 16 (what we control from code) plus Task 22 Step 3 (the dashboard runbook), never a form of ours (A1, ruling 28) |
| The callback moment, success and failure | Task 16 Step 4 (`/sign-in/problem`, `onError`) |
| Redirect back to intent, including a held seat | Task 16 Step 2, plus the cookie-path constraint the parent's Task 6 needs |
| Sign-out | Task 16 Step 6, through the existing sealed fixture and the existing CSP test |
| Session expired on an authenticated page | Task 16 Step 5 (`session-watch`, `SessionNotice`, the escalation rule) |
| First-run onboarding, callback to seated | Task 17 |
| `/app/profile` and all six account-room components | Task 18 |
| `/app/admin/queue` and `/app/admin/queue/[flagId]` | Task 19 |
| `/reviews` | Task 20 |
| `/app/join/[code]` | Task 20 |
| `error.tsx`, `not-found.tsx`, `global-error.tsx` | Task 21 Step 3 |
| Loading states (none existed) | Task 21 Step 2 |
| Terms, Privacy, Support, League rules | Task 21 Step 4 |
| `/app/drafts/[draftId]`, `/app/leagues/**`, `/`, `/browse` | **Parent Tasks 11, 12, 5, 2. Not duplicated here.** |

**Founder directive 2 ("all backend functionality leveraged ... persona reviews to flag backend gaps"):** Task 15 is the inventory, with a method, a committed artifact, three enforcement tests and a rule that no GAP stays unassigned. A7 puts the backend-gap mandate on **every** panel in this addendum (Tasks 16, 17, 18, 19, 20, 21) and extends the parent's final gauntlet the same way (Task 22 Step 2). Task 22 Step 1 is the named backlog file with persona attribution, severity and owner phase, and Step 7 presents it.

**Constraint coverage:** A1/A2 are honored by every auth assertion stopping at the boundary and by no credential input existing anywhere in the file. A3 is Task 19's acceptance criterion, not a note. A4 has its own test in Task 20 Step 1. A5 enumerates nine states and refuses a house-league branch on the non-oracle rule. A6 is Task 16 Step 5, with the escalation argued. A7 appears as a marked step in six tasks. A8 is checked in the File Structure (one new pure module, in the directory the identity seam already occupies, with its gate read off the config).

**Parent-plan collisions, checked one at a time:** the shell, primitives, palette and type scale are **consumed**, never re-decided. `src/app/app/page.tsx` is touched by the parent's Task 10 (the board) and by Task 17 here (the first-run branch only) — different regions of the same file, and Task 17 runs after Task 10 in the addendum's sequence. `src/app/reviews/page.tsx` and every `/app` page are moved into the shell by the parent's Task 2 Step 5; Tasks 18, 19 and 20 here change their **contents**, after that move. The four trust pages are created as stubs by the parent's Task 5 Step 5 and **filled in** by Task 21 Step 4, which explicitly does not create a second route for a path that already resolves. `rendered-copy.test.tsx`'s roster gains this addendum's components in the tasks that create them, per the parent's rule.

**Placeholder scan:** no TODO, no TBD, no step whose expected output is unstated. Every file in the File Structure appears in a task's Files block. Five places name a helper the executing engineer writes to taste rather than showing it in full — `AppShellSkeleton`'s markup (copies the shell's own grid), `QueueTable`'s columns (copies `StandingsTable`'s dense idiom), `InviteLanding`'s state switch (copies `SeatTakenPanel`'s shape from the parent's Task 6), `StandingPanel`'s body (copies `NotificationSummary`'s description-list idiom), and `readerFor` in the system-action test (copies `activity-view.ts`'s own dispatch) — and each names the existing file whose shape it copies.

**Type consistency:** `safeReturnTo` returns `string | null` and is the only validator; `SESSION_LOST_EVENT` is one exported constant; `InviteLanding`'s state is one discriminated union declared once. Nothing here declares a second type for something that already has one, and nothing here adds a type to `src/domain`.

**Boundary check:** `src/lib/auth/return-to.ts` is server-side and imported only by route handlers. `src/components/app-shell/**` is shared UI, imported by both sides today, and `session-watch.ts` imports nothing from `@/lib` — it wraps `fetch` and emits, which is why the four room `deps.tsx` files can delegate to it without crossing the client boundary. `src/admin-room/**` and `src/account-room/**` keep talking to their services over the wire only. `src/app/**` is exempt by design.

**What this addendum deliberately does not do.** It does not add a credential form, a session store, or any authentication logic of our own. It does not build a single missing backend, however loudly a persona asks for one. And it does not touch the parent's fourteen tasks: every collision above is a different region of a shared file, in a stated order.

---

## Controller rulings (recorded at plan commit, 2026-08-23)

The planner flagged six risks. Ruled as follows; each ruling binds execution:

1. **Sequencing: ACCEPTED as recommended.** Execution order for the combined Phase 3.6: addendum Task 15 first (its findings can reorder everything), then addendum Task 16 (the parent's Task 6 hard-depends on it), then the parent plan in full in its own ruled order (1, 2, 3, 4, 6, 5, 7-14), then addendum Tasks 17-22.
2. **The seat-hold cookie's Path: ACCEPTED as written here** (`Path=/`; httpOnly + SameSite=Lax + token opacity carry the security). The constraint is recorded in this file and carried into the parent's Task 6 dispatch as a ledger note at execution; the parent file is not edited.
3. **The WorkOS dashboard runbook: ACCEPTED.** Control names read off the live dashboard at execution; the custom auth domain (auth.commish.ly) is founder-gated (DNS + plan tier) and joins the founder-gated bucket.
4. **StandingPanel: ACCEPTED under ruling 30's line** (about the reader only, never anybody else, with the absence test-asserted). It does not reopen D6.
5. **The notices cap: sentence now, cursor as backlog HIGH — ACCEPTED.** A design addendum does not make service changes; the founder can promote the cursor from the backlog into 3.6 scope if they want it sooner.
6. **The four trust pages: fill-in-never-duplicate rule ACCEPTED.** If the parent's execution ships them with real content, Task 21 Step 4 shrinks to a retone and says so in its commit body.
