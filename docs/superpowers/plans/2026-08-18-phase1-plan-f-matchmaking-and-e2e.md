# Phase 1 Plan F — Public Matchmaking & End-to-End Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public league browse/matchmaking surface (roadmap Step 10) and prove every seam in Phase 1 actually connects, headlessly and in a real browser (roadmap Step 11).

**Architecture:** Public browse is this codebase's **first unauthenticated league read**, so it gets its own pure layer (`src/matchmaking/` — filter normalization, cosmetic stake-tier labels, the wire contract), a service read in the existing `src/league-service/` (`browse.ts`), an unauthenticated route (`GET /api/public/leagues`), and a signed-out-capable page at `/browse`. The privacy boundary is a named TypeScript interface plus a test that fails if the wire body grows a field that interface does not name. Joining from browse goes through the **same** locked capacity core as an invite accept (`joinLeagueInTx`), so the two paths can never disagree about how full a league is. Step 11 lands as two layers: a deterministic Vitest suite in `src/integration/` that runs real snake and auction drafts through `commitDraftResults` into standings/matchups/chat/advisor/browse, and a Playwright suite in `e2e/` that drives the real dev stack through a real WorkOS-sealed session cookie — the same seam `scripts/mint-dev-session.ts` already uses. No dev auth bypass is invented anywhere.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript strict · Drizzle ORM over Postgres 17 · Redis 7 Streams → SSE · WorkOS AuthKit · Zod v4 · Vitest + happy-dom + @testing-library/react + vitest-axe · **@playwright/test** (new) · Tailwind v4 with generated design tokens.

**Spec:** `plans/fantasy-mvp-prototype.md` — Step 10 (lines 412–441) and Step 11 (lines 444–470); dependency notes at lines 59–73.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **No MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope**, not quality. Nothing gets built in a form a later phase plans to throw away.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional`.
- **Timing.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. Nothing else imports `@workos-inc/authkit-nextjs` for identity. `src/middleware.ts`: pages under `/app` redirect to hosted sign-in; **API and SSE routes never redirect** — they return a JSON 401 themselves.
- **Real-time — one mechanism.** Redis Streams over SSE, stream key `league:<id>:events`, read with plain `XREAD BLOCK` from a per-connection cursor. **Never `XREADGROUP`**. Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**` and `src/chat-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond` or `@/data/seed` as VALUES. `import type` stays allowed. The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }`. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. Error strings are user-facing plain language — never raw DB/exception text.
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them. No inline literals for tunables.
- **Tests.** **Test-first.** Tests live beside the code. Verification commands filter by directory. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks; use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for `src/scoring/**`, `src/draft-engine/**`, `src/draft-room/state/**`, `src/league/**` and `src/chat/**`. Verify with an **unfiltered** `npm run test:coverage`.
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty; once deployed, add with a DEFAULT or backfill in a separate migration.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why*.
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** Roster-slot letters use `SlotChip`. `PageTitle` is the one `<h1>` treatment for a PAGE.
- **Never a dead end.** Empty and error states always offer an action.
- **Both themes are first-class.** Every surface is designed and tested in light and dark. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/league.md`:**

- Engine (`src/league/`) is pure, no I/O, `readonly` everywhere, 100% coverage. Service (`src/league-service/`) is the only part that talks to Postgres. Browser layer never imports either directly.
- Every `/api/leagues/**` and `/api/invites/**` route goes through `src/app/api/leagues/_shared.ts`.

**Plan-F-specific constraints (rulings recorded in "Open questions" at the end):**

- **Stake tier is COSMETIC ONLY.** No entry fee is charged, no prize is paid, and no balance exists anywhere in this phase. Every surface that shows a stake tier also shows `MATCHMAKING_CONFIG.stakeDisclosure`. Real money is a later phase.
- **The public privacy boundary.** An unauthenticated visitor may see, for a league that is explicitly `is_public_matchmade` **and** still open: `id`, `name`, `format`, `experienceTier`, `stakeTier`, `teamCount`, `filledTeams`. They may see **nothing else** — no commissioner identity, no team or owner names, no avatars, no invite code, no draft id, no standings, no rosters, no chat, no scoring settings. Private leagues do not appear at all.
- **Only `'snake' | 'auction'` are joinable formats** — the two the draft engine actually runs.
- **FOUNDER RULE: no em-dashes in user-facing copy.** Not in component text, not in error strings, not in seed league names. (Source comments may use them; the codebase already does.)
- **Every new user-facing surface gets a persona-panel review pass**, marked as an explicit step. The controller runs the panel; the plan only marks where.
- **No dev auth bypass.** The e2e suite authenticates by sealing a real WorkOS test-directory session into the `wos-session` cookie, exactly as `scripts/mint-dev-session.ts` does today. If WorkOS test credentials are absent, the suite fails loudly with a named-variable error and CI **skips the job with a visible warning** — it never fakes a pass.

---

## File Structure

**New — pure layer (browser-safe, value-importable by `src/league-room/**` the same way `@/chat` is):**

| File | Responsibility |
|---|---|
| `src/matchmaking/config.ts` | `MATCHMAKING_CONFIG`: the "any" sentinel, joinable formats, experience tiers, the cosmetic stake-tier table, the no-money disclosure string, the result cap. |
| `src/matchmaking/contract.ts` | Types only: `PublicLeagueSummary` (the privacy boundary, written once), `BrowseFilter`, `BrowseBody`. |
| `src/matchmaking/filter.ts` | Pure: `normalizeBrowseFilter`, `matchesBrowseFilter`, `hasOpenSeat`, `stakeTierLabel`. |
| `src/matchmaking/filter.test.ts` | 100%-coverage-gated tests for the above. |

**New — service layer (Postgres, server-only):**

| File | Responsibility |
|---|---|
| `src/league-service/browse.ts` | `listPublicLeagues(db, filter)` — the one query behind public browse. |
| `src/league-service/join.ts` | `joinLeagueInTx` (the shared locked capacity core) and `joinPublicLeague`. |

**New — routes:**

| File | Responsibility |
|---|---|
| `src/app/api/public/leagues/route.ts` | `GET`, unauthenticated. The only unauthenticated league read in the app. |
| `src/app/api/public/leagues/[leagueId]/join/route.ts` | `POST`, sign-in required (JSON 401, never a redirect). |
| `src/app/browse/page.tsx` | The public browse page. Renders signed-out and signed-in. |

**New — client/presentational components (inside the ESLint-boundaried `src/league-room/**`):**

| File | Responsibility |
|---|---|
| `src/league-room/components/browse-filters.tsx` | A plain GET `<form>`. The URL is the filter state; no client JS, works signed-out. |
| `src/league-room/components/public-league-list.tsx` | The matching leagues as cards: fill status, format, tier labels, the join affordance. |
| `src/league-room/components/join-public-league-button.tsx` | `"use client"` — POSTs the join through the `fetchJson` deps seam, mirrors `JoinForm`. |

**New — seed + integration + e2e:**

| File | Responsibility |
|---|---|
| `src/data/seed/seed-public-leagues.ts` | Public leagues at several fill levels, formats, experience tiers and stake tiers. |
| `src/integration/pipeline.ts` | Shared helper: run a real draft to completion and commit it. Not a test file. |
| `src/integration/draft-to-season.test.ts` | The snake and auction draft → commit → standings/matchups proofs. |
| `src/integration/features-against-real-draft.test.ts` | Chat, advisor, browse and moderator smoke against real draft output. |
| `scripts/lib/lab-session.ts` | The WorkOS create-user + authenticate + seal helper, shared by the mint script and the e2e setup. |
| `playwright.config.ts` | Playwright config: one worker, `webServer`, `globalSetup`. |
| `e2e/global-setup.ts` | Mints two sessions, warms their profile rows, seeds with the claim id, writes storage states. |
| `e2e/support/fixtures.ts` | `test` extended with `managerA` / `managerB` browser contexts. |
| `e2e/league-lifecycle.spec.ts` | Create → invite → join → draft pick fan-out across two contexts → chat fan-out. |
| `e2e/season.spec.ts` | Lineup → score week → standings → advisor → browse smoke. |

**Modified:** `src/db/schema.ts`, `src/league-service/creation.ts`, `src/league-service/invites.ts`, `src/league-service/schemas.ts`, `src/league-service/index.ts`, `src/app/api/leagues/route.ts`, `src/league-room/components/create-league-form.tsx`, `src/app/page.tsx`, `src/app/app/page.tsx`, `src/data/seed/config.ts`, `src/data/seed/index.ts`, `vitest.config.mts`, `package.json`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml`, `README.md`, `docs/conventions.md`, `docs/league.md`.

---

## Task 1: The pure matchmaking layer

**Files:**
- Create: `src/matchmaking/config.ts`
- Create: `src/matchmaking/contract.ts`
- Create: `src/matchmaking/filter.ts`
- Test: `src/matchmaking/filter.test.ts`
- Modify: `vitest.config.mts:17` (add `src/matchmaking` to `COVERAGE_GATED_DIRS`) and its `coverage.thresholds` block

**Interfaces:**
- Consumes: `DraftFormat` from `@/domain/league`, `ExperienceTier` from `@/domain/user`.
- Produces:
  - `MATCHMAKING_CONFIG` — `{ anyValue: "any", formats: readonly DraftFormat[], experienceTiers: readonly ExperienceTier[], stakeTiers: readonly { tier: number; label: string }[], stakeDisclosure: string, maxResults: number }`
  - `interface PublicLeagueSummary { readonly id: string; readonly name: string; readonly format: DraftFormat; readonly experienceTier: ExperienceTier; readonly stakeTier: number; readonly teamCount: number; readonly filledTeams: number }`
  - `interface BrowseFilter { readonly format: DraftFormat | "any"; readonly experienceTier: ExperienceTier | "any"; readonly stakeTier: number | "any" }`
  - `interface BrowseBody { readonly leagues: readonly PublicLeagueSummary[] }`
  - `const EMPTY_BROWSE_FILTER: BrowseFilter`
  - `normalizeBrowseFilter(raw: { readonly format?: string | null; readonly experienceTier?: string | null; readonly stakeTier?: string | null }): BrowseFilter`
  - `matchesBrowseFilter(league: PublicLeagueSummary, filter: BrowseFilter): boolean`
  - `hasOpenSeat(league: Pick<PublicLeagueSummary, "teamCount" | "filledTeams">): boolean`
  - `stakeTierLabel(tier: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/matchmaking/filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MATCHMAKING_CONFIG } from "./config";
import type { PublicLeagueSummary } from "./contract";
import {
  EMPTY_BROWSE_FILTER,
  hasOpenSeat,
  matchesBrowseFilter,
  normalizeBrowseFilter,
  stakeTierLabel,
} from "./filter";

const league = (over: Partial<PublicLeagueSummary> = {}): PublicLeagueSummary => ({
  id: "l1",
  name: "Rookie Snake Room",
  format: "snake",
  experienceTier: "beginner",
  stakeTier: 0,
  teamCount: 12,
  filledTeams: 8,
  ...over,
});

describe("normalizeBrowseFilter", () => {
  it("reads every supported value off a query string", () => {
    expect(normalizeBrowseFilter({ format: "auction", experienceTier: "experienced", stakeTier: "2" })).toEqual({
      format: "auction",
      experienceTier: "experienced",
      stakeTier: 2,
    });
  });

  it("treats absent params as no narrowing at all", () => {
    expect(normalizeBrowseFilter({})).toEqual(EMPTY_BROWSE_FILTER);
    expect(normalizeBrowseFilter({ format: null, experienceTier: null, stakeTier: null })).toEqual(EMPTY_BROWSE_FILTER);
    expect(normalizeBrowseFilter({ format: "", experienceTier: "", stakeTier: "" })).toEqual(EMPTY_BROWSE_FILTER);
  });

  it("normalizes a format the draft engine cannot run to 'any' rather than erroring", () => {
    // Browse is a public read reached by hand-edited URLs and stale bookmarks. The honest
    // answer to ?format=dynasty is the unfiltered list, not a 400.
    expect(normalizeBrowseFilter({ format: "dynasty" }).format).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ format: "best_ball" }).format).toBe(MATCHMAKING_CONFIG.anyValue);
  });

  it("normalizes junk in every other field too", () => {
    expect(normalizeBrowseFilter({ experienceTier: "wizard" }).experienceTier).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ stakeTier: "9" }).stakeTier).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ stakeTier: "1.5" }).stakeTier).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ stakeTier: "not-a-number" }).stakeTier).toBe(MATCHMAKING_CONFIG.anyValue);
  });
});

describe("matchesBrowseFilter", () => {
  it("keeps everything when nothing is narrowed", () => {
    expect(matchesBrowseFilter(league(), EMPTY_BROWSE_FILTER)).toBe(true);
  });

  it("narrows on format", () => {
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, format: "snake" })).toBe(true);
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, format: "auction" })).toBe(false);
  });

  it("narrows on experience tier", () => {
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, experienceTier: "beginner" })).toBe(true);
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, experienceTier: "experienced" })).toBe(false);
  });

  it("narrows on stake tier, including tier 0", () => {
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, stakeTier: 0 })).toBe(true);
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, stakeTier: 3 })).toBe(false);
  });

  it("requires every narrowed field at once", () => {
    const filter = { format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 0 };
    expect(matchesBrowseFilter(league(), filter)).toBe(false);
    expect(matchesBrowseFilter(league({ experienceTier: "experienced" }), filter)).toBe(true);
  });
});

describe("hasOpenSeat", () => {
  it("is true only while a seat is left", () => {
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 11 })).toBe(true);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 12 })).toBe(false);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 13 })).toBe(false);
  });
});

describe("stakeTierLabel", () => {
  it("labels every configured tier", () => {
    for (const entry of MATCHMAKING_CONFIG.stakeTiers) {
      expect(stakeTierLabel(entry.tier)).toBe(entry.label);
    }
  });

  it("falls back to the lowest tier's label for a tier nothing configured", () => {
    expect(stakeTierLabel(99)).toBe(MATCHMAKING_CONFIG.stakeTiers[0].label);
  });
});

describe("MATCHMAKING_CONFIG", () => {
  it("offers only the two formats the draft engine can actually run", () => {
    expect([...MATCHMAKING_CONFIG.formats]).toEqual(["snake", "auction"]);
  });

  it("says plainly that stake tiers are cosmetic, with no em-dash in the copy", () => {
    expect(MATCHMAKING_CONFIG.stakeDisclosure).toContain("No money changes hands");
    expect(MATCHMAKING_CONFIG.stakeDisclosure).not.toContain("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/matchmaking`
Expected: FAIL — `Failed to resolve import "./config"`.

- [ ] **Step 3: Write `src/matchmaking/config.ts`**

```ts
import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";

/**
 * Every tunable public matchmaking has.
 *
 * This module is PURE and browser-safe — no I/O, no `Date.now()`, no Postgres — which is why
 * `src/league-room/**` may value-import it despite the client-boundary rule, exactly as
 * `src/chat-room/**` value-imports `@/chat`. The Postgres half of matchmaking lives in
 * `src/league-service/browse.ts`, which that rule still bans.
 */
export const MATCHMAKING_CONFIG = {
  /**
   * The sentinel a filter control submits for "don't narrow on this". A real value would have
   * to be one of the unions below, and an empty string is indistinguishable from an absent
   * parameter once it has been round-tripped through a query string.
   */
  anyValue: "any",
  /**
   * The only joinable formats. Dynasty and best-ball are deliberately absent: the draft engine
   * cannot run them yet, and advertising a league nobody can draft is a dead end wearing a card.
   */
  formats: ["snake", "auction"] as readonly DraftFormat[],
  experienceTiers: ["beginner", "experienced"] as readonly ExperienceTier[],
  /**
   * COSMETIC ONLY. No entry fee is charged, no prize is paid and no balance exists anywhere in
   * this phase — a stake tier is a label on a card and nothing else. Real money arrives in a
   * later phase behind FBO/agent-of-payee handling, KYC/AML screening and tax reporting.
   */
  stakeTiers: [
    { tier: 0, label: "Free" },
    { tier: 1, label: "Friendly" },
    { tier: 2, label: "Competitive" },
    { tier: 3, label: "High stakes" },
  ],
  /** The one place the "no money" promise is worded, so a card and a page cannot disagree. */
  stakeDisclosure: "Stake tiers are labels only in this preview. No money changes hands.",
  /** Most open leagues one browse answers with. A list nobody can scan is not a shortlist. */
  maxResults: 48,
} as const;
```

- [ ] **Step 4: Write `src/matchmaking/contract.ts`**

```ts
import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";

/**
 * TYPES ONLY, no runtime code.
 *
 * `PublicLeagueSummary` IS the privacy boundary of public browse, written once: this is the
 * complete set of facts an UNAUTHENTICATED visitor may learn about a league they are not in.
 * Adding a field here is a deliberate disclosure decision, and
 * `src/league-service/browse.test.ts` fails if the wire body ever carries a key this interface
 * does not name.
 *
 * Deliberately absent, and each for a reason: the commissioner's identity and any team or
 * owner name (a stranger has no business learning who plays here), the invite code (a
 * membership capability), the draft id (a gated room), and standings, rosters, chat and
 * scoring settings (all member-only reads today, and there is no reason browse should be the
 * hole in that). A stranger gets what they need to CHOOSE a league and nothing about the
 * people already in it.
 */
export interface PublicLeagueSummary {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly experienceTier: ExperienceTier;
  /** A cosmetic tier index — see `MATCHMAKING_CONFIG.stakeTiers`. Never an amount of money. */
  readonly stakeTier: number;
  readonly teamCount: number;
  readonly filledTeams: number;
}

/** A normalized browse filter: every field is a concrete value or the "any" sentinel. */
export interface BrowseFilter {
  readonly format: DraftFormat | "any";
  readonly experienceTier: ExperienceTier | "any";
  readonly stakeTier: number | "any";
}

export interface BrowseBody {
  readonly leagues: readonly PublicLeagueSummary[];
}
```

- [ ] **Step 5: Write `src/matchmaking/filter.ts`**

```ts
import { MATCHMAKING_CONFIG } from "./config";
import type { BrowseFilter, PublicLeagueSummary } from "./contract";

const ANY = MATCHMAKING_CONFIG.anyValue;

/** Nothing narrowed: what browse answers with before anybody touches a control. */
export const EMPTY_BROWSE_FILTER: BrowseFilter = { format: ANY, experienceTier: ANY, stakeTier: ANY };

/**
 * Turns whatever arrived on a query string into a filter the rest of the system can trust.
 *
 * Unknown, misspelled and hostile values all normalize to "any" rather than erroring. Browse is
 * a public read reached by hand-edited URLs, shared links and stale bookmarks, and the honest
 * answer to `?format=dynasty` is the unfiltered list of leagues we CAN offer, not a 400 that
 * teaches a visitor nothing. This is the only place a raw string becomes a `BrowseFilter`.
 */
export function normalizeBrowseFilter(raw: {
  readonly format?: string | null;
  readonly experienceTier?: string | null;
  readonly stakeTier?: string | null;
}): BrowseFilter {
  const stake = Number(raw.stakeTier);
  const stakeIsConfigured =
    raw.stakeTier !== undefined &&
    raw.stakeTier !== null &&
    raw.stakeTier !== "" &&
    Number.isInteger(stake) &&
    MATCHMAKING_CONFIG.stakeTiers.some((entry) => entry.tier === stake);

  return {
    format: MATCHMAKING_CONFIG.formats.find((value) => value === raw.format) ?? ANY,
    experienceTier: MATCHMAKING_CONFIG.experienceTiers.find((value) => value === raw.experienceTier) ?? ANY,
    stakeTier: stakeIsConfigured ? stake : ANY,
  };
}

/** True when a league matches every narrowed field. The one filter rule in the product. */
export function matchesBrowseFilter(league: PublicLeagueSummary, filter: BrowseFilter): boolean {
  if (filter.format !== ANY && league.format !== filter.format) return false;
  if (filter.experienceTier !== ANY && league.experienceTier !== filter.experienceTier) return false;
  if (filter.stakeTier !== ANY && league.stakeTier !== filter.stakeTier) return false;
  return true;
}

/**
 * A league is browsable and joinable only while it has a seat left. Shared by the browse read
 * and the join, so a card that says "join" and a POST that accepts it agree by construction.
 */
export function hasOpenSeat(league: Pick<PublicLeagueSummary, "teamCount" | "filledTeams">): boolean {
  return league.filledTeams < league.teamCount;
}

/** The human label for a cosmetic stake tier. Never an amount of money. */
export function stakeTierLabel(tier: number): string {
  return MATCHMAKING_CONFIG.stakeTiers.find((entry) => entry.tier === tier)?.label ?? MATCHMAKING_CONFIG.stakeTiers[0].label;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/matchmaking`
Expected: PASS, all cases green.

- [ ] **Step 7: Add the new pure layer to the 100% coverage gate**

In `vitest.config.mts`, change line 17 to:

```ts
const COVERAGE_GATED_DIRS = ["src/scoring", "src/draft-engine", "src/draft-room/state", "src/league", "src/chat", "src/matchmaking"] as const;
```

and add, inside `coverage.thresholds`, after the `"src/chat/**"` entry:

```ts
        "src/matchmaking/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
```

Rationale to put in the commit body: `src/matchmaking/**` is pure, I/O-free rule code of exactly the same kind as `src/league/**` and `src/chat/**`, and it is the code that decides what a stranger is allowed to see. That is the last place a partially-tested branch belongs.

- [ ] **Step 8: Verify the gate holds on an unfiltered coverage run**

Run: `npm run test:coverage`
Expected: PASS, with `src/matchmaking` reported at 100% branches/functions/lines/statements. A path-filtered run would report the other gated directories at 0%, so run it unfiltered.

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add src/matchmaking vitest.config.mts
git commit -m "feat(matchmaking): pure browse-filter layer and the public privacy contract

PublicLeagueSummary is the whole privacy boundary of public browse, named once so a
disclosure is a deliberate edit rather than a field that leaked into a select. Joins the
100% coverage gate alongside src/league and src/chat: it is pure rule code, and it decides
what an unauthenticated stranger may see."
```

---

## Task 2: Public-league fields on the create seam

**Files:**
- Modify: `src/db/schema.ts:41-54` (the `leagues` table)
- Create: `drizzle/0009_*.sql` (generated)
- Modify: `src/league-service/creation.ts:17-27` and `:52-71`
- Modify: `src/league-service/schemas.ts:20-37`
- Modify: `src/app/api/leagues/route.ts:31-40`
- Modify: `src/league-room/components/create-league-form.tsx`
- Test: `src/league-service/creation.test.ts`, `src/league-room/components/create-league-form.test.tsx`

**Interfaces:**
- Consumes: `MATCHMAKING_CONFIG` (Task 1); `LeagueWriteDeps`, `CreateLeagueInput`, `CreateLeagueResult` from `src/league-service/creation.ts`; `ExperienceTier` from `@/domain/user`.
- Produces:
  - `leagues.experienceTier` column (pg enum `experience_tier`, NOT NULL, DEFAULT `'beginner'`).
  - `CreateLeagueInput` additionally requires `readonly experienceTier: ExperienceTier; readonly stakeTier: number; readonly isPublicMatchmade: boolean`.
  - `createLeagueSchema` additionally accepts `visibility: "invite_only" | "public"` (default `"invite_only"`), `stakeTier: number` (default `0`), `experienceTier?: ExperienceTier`.

- [ ] **Step 1: Write the failing service test**

Append to `src/league-service/creation.test.ts`, inside the existing `describe("createLeague", …)`:

```ts
  it("records the matchmaking facts a public browse reads: visibility, stake tier and experience tier", async () => {
    const result = await createLeague(deps(), {
      name: "Open Auction Night",
      format: "auction",
      teamCount: 10,
      scoringPreset: "ppr",
      auctionBudget: 200,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      commissionerUserId: "u1",
      teamName: "Dana's Team",
      experienceTier: "experienced",
      stakeTier: 2,
      isPublicMatchmade: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ experienceTier: "experienced", stakeTier: 2, isPublicMatchmade: true });
  });

  it("keeps a league private and unlisted unless it is created public on purpose", async () => {
    const result = await createLeague(deps(), {
      name: "Group Chat Only",
      format: "snake",
      teamCount: 12,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      commissionerUserId: "u1",
      teamName: "Dana's Team",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ isPublicMatchmade: false, stakeTier: 0, experienceTier: "beginner" });
  });
```

Every other `createLeague(...)` call already in this file will now be a type error (three required fields are missing). Fix each by adding `experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false`. The same applies to `src/league-service/test-support.ts` (`twoTeamLeague` at line 29 and `advisorFixture` at line 96).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/league-service/creation.test.ts`
Expected: FAIL — the object literal has unknown properties and the `leagues` row has no `experienceTier` column.

- [ ] **Step 3: Add the column to the schema**

In `src/db/schema.ts`, inside the `leagues` table, immediately after the `stakeTier` line (line 46):

```ts
  /**
   * Which managers this league is FOR, as advertised on the public browse page. A league-level
   * fact, not a mirror of the commissioner's own `users.experience_tier`: deriving it from a
   * person would leak that person into an unauthenticated read and would silently re-tier every
   * league they run the moment they updated their own profile.
   */
  experienceTier: experienceTierEnum("experience_tier").notNull().default("beginner"),
```

- [ ] **Step 4: Generate and apply the migration**

Run:

```bash
npm run db:generate
npm run db:migrate
npm run db:migrate:test
```

Expected: a new `drizzle/0009_*.sql` containing `ALTER TABLE "leagues" ADD COLUMN "experience_tier" "experience_tier" DEFAULT 'beginner' NOT NULL;`. It carries a DEFAULT, which is what `docs/conventions.md`'s migration rule requires for a table that already holds rows.

- [ ] **Step 5: Widen `CreateLeagueInput` and the insert**

In `src/league-service/creation.ts`, add to the imports:

```ts
import type { ExperienceTier } from "@/domain/user";
```

Add to `CreateLeagueInput`, after `rosterSlots`:

```ts
  /** Who the league is advertised for on public browse. Defaults from the creator at the route. */
  readonly experienceTier: ExperienceTier;
  /** Cosmetic tier index only — no entry fee is charged and no balance exists in this phase. */
  readonly stakeTier: number;
  /** Opt-in. A league is invite-only and unlisted unless its creator chose otherwise. */
  readonly isPublicMatchmade: boolean;
```

and add to the `tx.insert(leagues).values({...})` call, after `rosterSlots`:

```ts
        experienceTier: input.experienceTier,
        stakeTier: input.stakeTier,
        isPublicMatchmade: input.isPublicMatchmade,
```

- [ ] **Step 6: Run the service test to verify it passes**

Run: `npm test -- src/league-service`
Expected: PASS (creation, invites, lineups, results, schedule and the route suites all green).

- [ ] **Step 7: Write the failing boundary + form tests**

Append to `src/league-service/league-routes.test.ts`, inside `describe("POST /api/leagues", …)`:

```ts
  it("creates an invite-only league by default and takes the creator's own experience tier", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "Sunday Money" }));
    expect(response.status).toBe(201);
    const { leagueId } = (await response.json()).data as { leagueId: string };
    const [row] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(row).toMatchObject({ isPublicMatchmade: false, stakeTier: 0, experienceTier: "beginner" });
  });

  it("lists the league publicly when the creator asks for it, at the stake tier they chose", async () => {
    signedInAs("u1");
    const response = await postLeague(
      post("http://test/api/leagues", { name: "Open Room", visibility: "public", stakeTier: 2 }),
    );
    expect(response.status).toBe(201);
    const { leagueId } = (await response.json()).data as { leagueId: string };
    const [row] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(row).toMatchObject({ isPublicMatchmade: true, stakeTier: 2 });
  });

  it("rejects a stake tier nothing configures, naming the field", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "Too Rich", stakeTier: 9 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stakeTier");
  });
```

Add `leagues` to that file's `@/db/schema` import and `eq` to its `drizzle-orm` import.

Append to `src/league-room/components/create-league-form.test.tsx`:

```ts
  it("sends the visibility and stake-tier choices, and says plainly that no money changes hands", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t1", draftId: "d1" } });
    const bodies: unknown[] = [];
    fixture.deps = {
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Open Room" } });
    fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
    fireEvent.change(screen.getByLabelText("Stake tier"), { target: { value: "2" } });
    expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ visibility: "public", stakeTier: 2 });
  });
```

Add `import { MATCHMAKING_CONFIG } from "@/matchmaking/config";` to that test file.

- [ ] **Step 8: Run both to verify they fail**

Run: `npm test -- src/league-service/league-routes.test.ts src/league-room/components/create-league-form.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Who can join`, and the created rows still read `isPublicMatchmade: false`.

- [ ] **Step 9: Widen the create schema**

In `src/league-service/schemas.ts`, add the import:

```ts
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
```

and add these fields to `createLeagueSchema`, after `auctionBudget`:

```ts
  /**
   * Opt-in, and deliberately worded as visibility rather than a boolean flag: "public" here
   * means "listed on the public browse page and joinable without an invite", which is a real
   * decision a commissioner makes, not a checkbox default anybody should trip over.
   */
  visibility: z.enum(["invite_only", "public"]).default("invite_only"),
  /** Cosmetic only. Bounded to the tiers `MATCHMAKING_CONFIG` actually labels. */
  stakeTier: z
    .number()
    .int()
    .min(0)
    .max(MATCHMAKING_CONFIG.stakeTiers.length - 1, { message: "Please choose one of the listed stake tiers." })
    .default(0),
  /** Defaults at the route to the creator's own tier, which the route knows and the service does not. */
  experienceTier: z.enum(["beginner", "experienced"]).optional(),
```

- [ ] **Step 10: Pass the new fields through the route**

In `src/app/api/leagues/route.ts`, extend the `createLeague` input object (after `teamName`):

```ts
        experienceTier: parsed.value.experienceTier ?? user.experienceTier,
        stakeTier: parsed.value.stakeTier,
        isPublicMatchmade: parsed.value.visibility === "public",
```

- [ ] **Step 11: Add the two fields to the create form**

In `src/league-room/components/create-league-form.tsx`, add the import:

```ts
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
```

add these module constants after `PRESETS`:

```ts
const VISIBILITIES = [
  { value: "invite_only", label: "Invite only" },
  { value: "public", label: "Anyone can find and join" },
];
const STAKE_TIERS = MATCHMAKING_CONFIG.stakeTiers.map((entry) => ({ value: String(entry.tier), label: entry.label }));
```

add the two state hooks after `auctionBudget`:

```ts
  const [visibility, setVisibility] = useState("invite_only");
  const [stakeTier, setStakeTier] = useState("0");
```

add them to the request body, after `auctionBudget`:

```ts
          visibility,
          stakeTier: Number(stakeTier),
```

and add the controls inside the `<details>` grid, after the auction-budget block:

```tsx
          <Select label="Who can join" options={VISIBILITIES} value={visibility} onChange={(event) => setVisibility(event.target.value)} />
          <Select label="Stake tier" options={STAKE_TIERS} value={stakeTier} onChange={(event) => setStakeTier(event.target.value)} />
          <p className="text-sm text-text-muted sm:col-span-2">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
```

Both live inside the closed disclosure, so `LEAGUE_CONFIG.maxCreateInteractions` (3) is untouched: a commissioner who types a name and presses the button still gets a complete, private, playable league.

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npm test -- src/league-service src/league-room`
Expected: PASS, including `create-league-interactions.test.tsx` (the happy path did not grow a step).

- [ ] **Step 13: Persona-panel review pass**

The create form gained two user-facing controls and one line of copy. Run the standing persona panel over `CreateLeagueForm` before moving on, checking specifically: does "Who can join" read unambiguously to a first-time commissioner; does the stake-tier control ever imply real money; and is `MATCHMAKING_CONFIG.stakeDisclosure` visible at the moment the tier is chosen rather than further down the page. Record the panel's findings in the commit body. Fix anything the panel flags before Step 14.

- [ ] **Step 14: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean.

```bash
git add src/db/schema.ts drizzle src/league-service src/app/api/leagues/route.ts src/league-room/components/create-league-form.tsx
git commit -m "feat(league): commissioners can list a league publicly, at a cosmetic stake tier

leagues.experience_tier is a league-level fact rather than a read of the commissioner's own
profile: deriving it from a person would leak that person into an unauthenticated browse and
would re-tier every league they run whenever they edited their profile. Visibility is opt-in
and both controls sit inside the closed advanced disclosure, so the 3-interaction create
budget is unchanged. Stake tier is cosmetic and the form says so where the tier is chosen."
```

---

## Task 3: The public browse read and its unauthenticated route

**Files:**
- Create: `src/league-service/browse.ts`
- Create: `src/league-service/browse.test.ts`
- Create: `src/app/api/public/leagues/route.ts`
- Modify: `src/league-service/index.ts` (barrel)

**Interfaces:**
- Consumes: `BrowseFilter`, `PublicLeagueSummary`, `BrowseBody` (Task 1); `MATCHMAKING_CONFIG`, `matchesBrowseFilter`, `hasOpenSeat` (Task 1); `Db` from `@/db/client`; `ok` from `@/lib/api/respond`.
- Produces:
  - `listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]>`
  - `PUBLIC_LEAGUE_FIELDS: readonly (keyof PublicLeagueSummary)[]` — the disclosure allowlist, exported so the route test can assert against it rather than against a hand-copied list.
  - `GET /api/public/leagues` → `{ ok: true, data: BrowseBody }`, no authentication.

- [ ] **Step 1: Write the failing test**

Create `src/league-service/browse.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { listPublicLeagues, PUBLIC_LEAGUE_FIELDS } from "./browse";

const db = createTestDb();

interface SeedLeague {
  readonly id: string;
  readonly name: string;
  readonly format: "snake" | "auction";
  readonly experienceTier: "beginner" | "experienced";
  readonly stakeTier: number;
  readonly teamCount: number;
  readonly filled: number;
  readonly isPublicMatchmade: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
}

async function seed(league: SeedLeague): Promise<void> {
  await db.insert(leagues).values({
    id: league.id,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    stakeTier: league.stakeTier,
    experienceTier: league.experienceTier,
    isPublicMatchmade: league.isPublicMatchmade,
    commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${league.id}_draft`,
    leagueId: league.id,
    format: league.format,
    status: league.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: league.format === "auction" ? 200 : null,
  });
  for (let i = 0; i < league.filled; i++) {
    const userId = `${league.id}_u${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Manager ${i}` });
    await db.insert(teams).values({ id: `${league.id}_t${i}`, leagueId: league.id, userId, name: `Team ${i}` });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(users).values({ id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("listPublicLeagues", () => {
  it("answers open, publicly listed leagues with their fill count", async () => {
    await seed({
      id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 8, isPublicMatchmade: true,
    });
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows).toEqual([
      { id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 8 },
    ]);
  });

  it("discloses nothing beyond the named public fields", async () => {
    await seed({
      id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    const [row] = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(Object.keys(row!).sort()).toEqual([...PUBLIC_LEAGUE_FIELDS].sort());
    // The facts a stranger must never learn from an unauthenticated read.
    expect(JSON.stringify(row)).not.toContain("owner");
    expect(JSON.stringify(row)).not.toContain("Commissioner Casey");
    expect(JSON.stringify(row)).not.toContain("open_draft");
  });

  it("never lists a private league, whatever it is filtered by", async () => {
    await seed({
      id: "private", name: "Group Chat Only", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: false,
    });
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
    expect(await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "snake" })).toEqual([]);
  });

  it("never lists a full league", async () => {
    await seed({
      id: "full", name: "Packed House", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 4, filled: 4, isPublicMatchmade: true,
    });
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
  });

  it("never lists a league whose draft has already started or finished", async () => {
    await seed({
      id: "live", name: "Already Drafting", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true, draftStatus: "in_progress",
    });
    await seed({
      id: "done", name: "Already Played", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true, draftStatus: "complete",
    });
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
  });

  it("narrows by format, experience tier and stake tier", async () => {
    await seed({
      id: "a", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await seed({
      id: "b", name: "Sharks Auction", format: "auction", experienceTier: "experienced",
      stakeTier: 3, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });

    expect((await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "auction" })).map((l) => l.id)).toEqual(["b"]);
    expect((await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, experienceTier: "beginner" })).map((l) => l.id)).toEqual(["a"]);
    expect((await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, stakeTier: 3 })).map((l) => l.id)).toEqual(["b"]);
    expect(await listPublicLeagues(db, { format: "snake", experienceTier: "experienced", stakeTier: 3 })).toEqual([]);
  });

  it("caps how many leagues one browse can answer with", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 3; i++) {
      await seed({
        id: `l${i}`, name: `Open League ${i}`, format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      });
    }
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toHaveLength(MATCHMAKING_CONFIG.maxResults);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/league-service/browse.test.ts`
Expected: FAIL — `Failed to resolve import "./browse"`.

- [ ] **Step 3: Write `src/league-service/browse.ts`**

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import { hasOpenSeat, matchesBrowseFilter } from "@/matchmaking/filter";

/**
 * The disclosure allowlist, in one place. Exported so the tests and the route assert against
 * THIS rather than a hand-copied list that could quietly fall behind the mapping below.
 */
export const PUBLIC_LEAGUE_FIELDS: readonly (keyof PublicLeagueSummary)[] = [
  "id",
  "name",
  "format",
  "experienceTier",
  "stakeTier",
  "teamCount",
  "filledTeams",
];

/**
 * The ONE unauthenticated league read in this application.
 *
 * Three things make it safe, and all three are here rather than spread over a route and a
 * component:
 *
 * 1. **Opt-in only.** `is_public_matchmade` is false for every league by default, so a league
 *    a commissioner made for their group chat is not merely ranked low here — it is invisible.
 * 2. **A narrow projection.** The select names exactly the columns `PublicLeagueSummary`
 *    declares. `commissioner_user_id`, the roster shape, the invite codes, the draft id and
 *    every team and owner name are never read, so they cannot leak through a spread.
 * 3. **Joinable or nothing.** A full league, or one whose draft has already started, is not a
 *    thing a stranger can act on, and listing it would be a card that only leads to a refusal.
 *
 * Two queries, not one per league: a league's fill count is a `teams` tally, and a manager
 * scanning fifty open leagues must not cost fifty round trips. The format/tier narrowing runs
 * through the SAME pure `matchesBrowseFilter` the browse page's tests exercise, so the wire and
 * the rule cannot drift.
 */
export async function listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]> {
  const leagueRows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      format: leagues.format,
      experienceTier: leagues.experienceTier,
      stakeTier: leagues.stakeTier,
      teamCount: leagues.teamCount,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(and(eq(leagues.isPublicMatchmade, true), eq(drafts.status, "scheduled")))
    .orderBy(asc(leagues.createdAt));
  if (leagueRows.length === 0) return [];

  const ids = leagueRows.map((row) => row.id);
  const teamRows = await db.select({ leagueId: teams.leagueId }).from(teams).where(inArray(teams.leagueId, ids));
  const filledByLeague = new Map<string, number>();
  for (const row of teamRows) filledByLeague.set(row.leagueId, (filledByLeague.get(row.leagueId) ?? 0) + 1);

  return leagueRows
    .map((row): PublicLeagueSummary => ({ ...row, filledTeams: filledByLeague.get(row.id) ?? 0 }))
    .filter((league) => hasOpenSeat(league) && matchesBrowseFilter(league, filter))
    .slice(0, MATCHMAKING_CONFIG.maxResults);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/league-service/browse.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Append to `src/league-service/league-read-routes.test.ts` (which already mocks `@/lib/auth/current-user` and holds the read-route suites):

```ts
describe("GET /api/public/leagues", () => {
  it("answers a signed-OUT visitor, because public browse is deliberately unauthenticated", async () => {
    signedInAs(null);
    await db.insert(leagues).values({
      id: "open", name: "Rookie Snake Room", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1",
    });
    await db.insert(drafts).values({
      id: "open_draft", leagueId: "open", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });

    const response = await browsePublic(new Request("http://test/api/public/leagues"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.leagues).toHaveLength(1);
    expect(Object.keys(body.data.leagues[0]).sort()).toEqual([...PUBLIC_LEAGUE_FIELDS].sort());
  });

  it("narrows on the query string and shrugs off a format the engine cannot run", async () => {
    signedInAs(null);
    await db.insert(leagues).values([
      { id: "s", name: "Rookie Snake Room", format: "snake", teamCount: 12, stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1" },
      { id: "a", name: "Sharks Auction", format: "auction", teamCount: 12, stakeTier: 3, experienceTier: "experienced", isPublicMatchmade: true, commissionerUserId: "u1" },
    ]);
    await db.insert(drafts).values([
      { id: "s_draft", leagueId: "s", format: "snake", status: "scheduled", kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null },
      { id: "a_draft", leagueId: "a", format: "auction", status: "scheduled", kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: 200 },
    ]);

    const narrowed = await browsePublic(new Request("http://test/api/public/leagues?format=auction"));
    expect((await narrowed.json()).data.leagues.map((l: { id: string }) => l.id)).toEqual(["a"]);

    // A hand-edited URL naming a format we do not run is answered with the unfiltered list.
    const junk = await browsePublic(new Request("http://test/api/public/leagues?format=dynasty"));
    expect((await junk.json()).data.leagues).toHaveLength(2);
  });
});
```

Add to that file's imports:

```ts
import { GET as browsePublic } from "@/app/api/public/leagues/route";
import { PUBLIC_LEAGUE_FIELDS } from "@/league-service/browse";
```

and add `drafts, leagues` to its `@/db/schema` import.

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- src/league-service/league-read-routes.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/public/leagues/route"`.

- [ ] **Step 7: Write the route**

Create `src/app/api/public/leagues/route.ts`:

```ts
import { getDb } from "@/db/client";
import { ok } from "@/lib/api/respond";
import { listPublicLeagues } from "@/league-service/browse";
import type { BrowseBody } from "@/matchmaking/contract";
import { normalizeBrowseFilter } from "@/matchmaking/filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ONE unauthenticated read in this application, and the only route in it that does not go
 * through `src/app/api/leagues/_shared.ts`'s `withCurrentUser`. That is deliberate, not an
 * oversight: a stranger deciding whether this product is worth signing up for has to be able
 * to see what leagues are open, and requiring an account first is the wall every competitor
 * puts up. `middleware.ts` does not redirect anything outside `/app`, so a signed-out request
 * reaches this handler with no session and that is the expected case.
 *
 * What keeps it safe is `listPublicLeagues`'s projection, not this handler: see its doc
 * comment for the three rules, and `@/matchmaking/contract` for the field-by-field boundary.
 * There is no per-caller behavior here at all — the response does not depend on who is asking,
 * which is exactly why it needs no identity.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filter = normalizeBrowseFilter({
    format: params.get("format"),
    experienceTier: params.get("experienceTier"),
    stakeTier: params.get("stakeTier"),
  });
  return ok<BrowseBody>({ leagues: await listPublicLeagues(getDb(), filter) });
}
```

- [ ] **Step 8: Export the read through the service barrel**

In `src/league-service/index.ts`, add after the `listLeaguesForUser` line:

```ts
export { listPublicLeagues, PUBLIC_LEAGUE_FIELDS } from "./browse";
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- src/league-service`
Expected: PASS.

- [ ] **Step 10: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add src/league-service/browse.ts src/league-service/browse.test.ts src/league-service/index.ts src/league-service/league-read-routes.test.ts src/app/api/public/leagues
git commit -m "feat(matchmaking): unauthenticated public league browse read

The first unauthenticated league read in the app. Safety is in the projection, not the
handler: opt-in listing only, a select that names exactly PublicLeagueSummary's columns, and
nothing listed that a stranger could not act on. A key-set test fails if the wire body ever
grows a field the contract does not name."
```

---

## Task 4: One locked join core, two ways in

**Files:**
- Create: `src/league-service/join.ts`
- Create: `src/league-service/join.test.ts`
- Modify: `src/league-service/invites.ts:83-157` (`acceptInvite` delegates its capacity core)
- Create: `src/app/api/public/leagues/[leagueId]/join/route.ts`
- Modify: `src/league-service/index.ts` (barrel)
- Test: `src/league-service/invites.test.ts` (unchanged assertions must still pass), `src/league-service/league-routes.test.ts` (new route cases)

**Interfaces:**
- Consumes: `DbTx`, `Db` from `@/db/client`; `LeagueWriteDeps` from `./creation`; `isUniqueViolation` from `@/db/errors`; `withCurrentUser` from `src/app/api/leagues/_shared.ts`; `hasOpenSeat` from `@/matchmaking/filter`.
- Produces:
  - `type JoinLeagueOutcome = { readonly ok: true; readonly leagueId: string; readonly teamId: string; readonly alreadyMember: boolean } | { readonly ok: false; readonly status: number; readonly reason: string }`
  - `type JoinPrecondition = (tx: DbTx, leagueId: string) => Promise<JoinLeagueOutcome | null>`
  - `joinLeagueInTx(tx: DbTx, input: { readonly leagueId: string; readonly userId: string; readonly teamName?: string; readonly newId: () => string }, precondition?: JoinPrecondition): Promise<JoinLeagueOutcome>`
  - `joinPublicLeague(deps: Pick<LeagueWriteDeps, "db" | "newId">, input: { readonly leagueId: string; readonly userId: string; readonly teamName?: string }): Promise<JoinLeagueOutcome>`
  - `LEAGUE_MISSING`, `LEAGUE_FULL`, `NOT_PUBLIC`, `DRAFT_ALREADY_STARTED` — the four shared plain-language strings.
  - `POST /api/public/leagues/[leagueId]/join` → `{ ok: true, data: JoinBody }` (the existing `JoinBody` from `src/league-room/contract.ts`), 401 JSON when signed out.

- [ ] **Step 1: Write the failing test**

Create `src/league-service/join.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { DRAFT_ALREADY_STARTED, joinPublicLeague, LEAGUE_FULL, LEAGUE_MISSING, NOT_PUBLIC } from "./join";

const db = createTestDb();
let nextId = 0;
const newId = () => `team_${++nextId}`;
const deps = () => ({ db, newId });

async function seedLeague(over: {
  readonly id?: string;
  readonly teamCount?: number;
  readonly filled?: number;
  readonly isPublicMatchmade?: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
} = {}): Promise<string> {
  const id = over.id ?? "open";
  await db.insert(leagues).values({
    id,
    name: "Rookie Snake Room",
    format: "snake",
    teamCount: over.teamCount ?? 12,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: over.isPublicMatchmade ?? true,
    commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: over.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
  for (let i = 0; i < (over.filled ?? 0); i++) {
    const userId = `${id}_seat_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` });
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
  }
  return id;
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  await db.insert(users).values([
    { id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" },
    { id: "joiner", email: "joiner@test.local", displayName: "Robin Vale" },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("joinPublicLeague", () => {
  it("gives the caller a team named after them, and reports it as a fresh join", async () => {
    const leagueId = await seedLeague();
    const result = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(result).toEqual({ ok: true, leagueId, teamId: "team_1", alreadyMember: false });

    const [row] = await db.select().from(teams).where(eq(teams.id, "team_1"));
    expect(row).toMatchObject({ leagueId, userId: "joiner", name: "Robin Vale" });
  });

  it("is idempotent: joining twice returns the same team and creates nothing", async () => {
    const leagueId = await seedLeague();
    const first = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    const second = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(second).toEqual({ ok: true, leagueId, teamId: (first as { teamId: string }).teamId, alreadyMember: true });
    expect(await db.select().from(teams).where(eq(teams.leagueId, leagueId))).toHaveLength(1);
  });

  it("refuses a league that is not publicly listed", async () => {
    const leagueId = await seedLeague({ isPublicMatchmade: false });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 403, reason: NOT_PUBLIC,
    });
  });

  it("refuses a league whose draft has already started", async () => {
    const leagueId = await seedLeague({ draftStatus: "in_progress" });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 409, reason: DRAFT_ALREADY_STARTED,
    });
  });

  it("refuses a full league", async () => {
    const leagueId = await seedLeague({ teamCount: 2, filled: 2 });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 409, reason: LEAGUE_FULL,
    });
  });

  it("refuses a league that does not exist", async () => {
    expect(await joinPublicLeague(deps(), { leagueId: "nope", userId: "joiner" })).toEqual({
      ok: false, status: 404, reason: LEAGUE_MISSING,
    });
  });

  it("lets an existing member back in even after the league closed behind them", async () => {
    // A member re-arriving must succeed for free whatever the path's own gate now says —
    // the same rule that makes re-opening your own expired invite link a success.
    const leagueId = await seedLeague();
    const first = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: true, leagueId, teamId: (first as { teamId: string }).teamId, alreadyMember: true,
    });
  });

  it("never seats more managers than the league has room for, under concurrent joins", async () => {
    const leagueId = await seedLeague({ teamCount: 4, filled: 3 });
    await db.insert(users).values([
      { id: "racer_a", email: "racer_a@test.local", displayName: "Racer A" },
      { id: "racer_b", email: "racer_b@test.local", displayName: "Racer B" },
    ]);
    const results = await Promise.all([
      joinPublicLeague(deps(), { leagueId, userId: "racer_a" }),
      joinPublicLeague(deps(), { leagueId, userId: "racer_b" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, status: 409, reason: LEAGUE_FULL }]);
    expect(await db.select().from(teams).where(eq(teams.leagueId, leagueId))).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/league-service/join.test.ts`
Expected: FAIL — `Failed to resolve import "./join"`.

- [ ] **Step 3: Write `src/league-service/join.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { drafts, leagues, teams, users } from "@/db/schema";
import { hasOpenSeat } from "@/matchmaking/filter";

/** The unique index that backstops "the same person joined twice" — see `schema.ts`. */
const TEAM_MEMBERSHIP_UNIQUE_INDEX = "teams_league_user_idx";

export const LEAGUE_MISSING = "That league doesn't exist.";
export const LEAGUE_FULL = "That league is already full.";
export const NOT_PUBLIC = "That league isn't open to join. Ask its commissioner for an invite link.";
export const DRAFT_ALREADY_STARTED = "That league's draft has already started. Try another open league.";

export type JoinLeagueOutcome =
  | { readonly ok: true; readonly leagueId: string; readonly teamId: string; readonly alreadyMember: boolean }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * A path-specific gate, run INSIDE the join transaction and only for a caller who is not
 * already a member. Returning a failure short-circuits the join; returning null lets it
 * proceed. See `joinLeagueInTx` for why it runs where it does.
 */
export type JoinPrecondition = (tx: DbTx, leagueId: string) => Promise<JoinLeagueOutcome | null>;

export interface JoinLeagueInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly teamName?: string;
  readonly newId: () => string;
}

/**
 * "Give this user a team in this league", with the capacity rule and the lock that makes it
 * true under concurrency. Shared verbatim by BOTH ways into a league — an invite accept
 * (`acceptInvite`) and a public matchmaking join (`joinPublicLeague`) — because two
 * independently-written capacity checks are two places the same league's fill count can
 * disagree, and the disagreement only shows up as a 13th team in a 12-team league.
 *
 * **The lock.** The LEAGUE row is taken `FOR UPDATE` before any team is counted. Two people
 * arriving down two different paths (or on two different invite codes) share no other row, so
 * without this they both read "11 of 12" and both insert. Locking the league serializes every
 * accept for that league whatever door it came through. Callers may hold other locks first —
 * `acceptInvite` locks the invite row before calling this — and invite-then-league is the fixed
 * order in this codebase; this function never takes a lock in the other direction, so nothing
 * here can deadlock against it.
 *
 * **Why the precondition runs where it does.** Every path-specific gate (an invite's expiry and
 * use cap, a public league's listing and draft status) is checked AFTER the "are you already a
 * member" lookup and BEFORE the capacity check. That ordering is the rule that makes re-arriving
 * free: opening your own invite link again after it expired, or reloading a browse card after
 * the draft started, finds your existing team and succeeds rather than telling a member they
 * cannot join the league they are already in.
 *
 * Runs inside the CALLER's transaction on purpose: for the invite path, joining is one step of a
 * larger write that also bumps the invite's use count, and a half-applied join is not a state
 * anything should be able to observe.
 */
export async function joinLeagueInTx(
  tx: DbTx,
  input: JoinLeagueInput,
  precondition?: JoinPrecondition,
): Promise<JoinLeagueOutcome> {
  const [league] = await tx
    .select({ id: leagues.id, teamCount: leagues.teamCount })
    .from(leagues)
    .where(eq(leagues.id, input.leagueId))
    .for("update");
  if (league === undefined) return { ok: false, status: 404, reason: LEAGUE_MISSING };

  const [existing] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, league.id), eq(teams.userId, input.userId)));
  // Arriving twice is not an error, and costs nothing.
  if (existing !== undefined) return { ok: true, leagueId: league.id, teamId: existing.id, alreadyMember: true };

  if (precondition !== undefined) {
    const denied = await precondition(tx, league.id);
    if (denied !== null) return denied;
  }

  const filled = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
  if (!hasOpenSeat({ teamCount: league.teamCount, filledTeams: filled.length })) {
    return { ok: false, status: 409, reason: LEAGUE_FULL };
  }

  const [profile] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.userId));
  const teamId = input.newId();
  await tx.insert(teams).values({
    id: teamId,
    leagueId: league.id,
    userId: input.userId,
    name: input.teamName ?? profile?.displayName ?? "New team",
  });
  return { ok: true, leagueId: league.id, teamId, alreadyMember: false };
}

/**
 * The public browse page's gate: a league must still be LISTED and still be PRE-DRAFT. Both are
 * re-checked here rather than trusted from the card the visitor clicked, because a browse page
 * is a snapshot and a league can fill or start between the render and the press.
 */
const publicJoinPrecondition: JoinPrecondition = async (tx, leagueId) => {
  const [row] = await tx
    .select({ isPublicMatchmade: leagues.isPublicMatchmade, draftStatus: drafts.status })
    .from(leagues)
    .leftJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(eq(leagues.id, leagueId));
  if (row === undefined || !row.isPublicMatchmade) return { ok: false, status: 403, reason: NOT_PUBLIC };
  if (row.draftStatus !== null && row.draftStatus !== "scheduled") {
    return { ok: false, status: 409, reason: DRAFT_ALREADY_STARTED };
  }
  return null;
};

export interface JoinPublicLeagueInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly teamName?: string;
}

/**
 * Join an open, publicly listed league without an invite. The counterpart to `acceptInvite`,
 * and deliberately built on the same core: the two doors differ only in what they check before
 * seating somebody, never in how a seat is counted or taken.
 */
export async function joinPublicLeague(
  { db, newId }: { readonly db: Db; readonly newId: () => string },
  input: JoinPublicLeagueInput,
): Promise<JoinLeagueOutcome> {
  try {
    return await db.transaction((tx) => joinLeagueInTx(tx, { ...input, newId }, publicJoinPrecondition));
  } catch (error: unknown) {
    if (isUniqueViolation(error, TEAM_MEMBERSHIP_UNIQUE_INDEX)) {
      // The unique-index backstop fired: a concurrent join created this user's team first.
      // That is a success, not a 500 — find the team they now have and hand it back.
      const [existing] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
      if (existing !== undefined) {
        return { ok: true, leagueId: input.leagueId, teamId: existing.id, alreadyMember: true };
      }
    }
    console.error("[league] public join failed", { leagueId: input.leagueId }, error);
    return { ok: false, status: 500, reason: "We couldn't join that league just now. Please try again." };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/league-service/join.test.ts`
Expected: PASS.

- [ ] **Step 5: Delegate `acceptInvite`'s capacity core to the shared function**

In `src/league-service/invites.ts`:

Replace the module-private constants block (lines 10-12) with:

```ts
const INVALID = "That invite link isn't valid. Ask your commissioner for a new one.";
```

(`TEAM_MEMBERSHIP_UNIQUE_INDEX` moves to `join.ts`; import it back where the catch block needs it.)

Update the imports:

```ts
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { leagueInvites, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { generateInviteCode, LEAGUE_CONFIG } from "@/league";
import { MS_PER_DAY } from "./config";
import type { LeagueWriteDeps } from "./creation";
import { joinLeagueInTx, type JoinPrecondition } from "./join";
```

(`and` is still needed by the catch block's lookup; keep it in the `drizzle-orm` import.)

Replace the body of `acceptInvite`'s transaction (lines 88-138) with:

```ts
    return await db.transaction(async (tx) => {
      // `for update`: the cap check below reads `invite.uses`, so this row must be held until
      // the matching increment commits. Invite first, THEN league (`joinLeagueInTx` takes the
      // league lock) — one fixed order, so no two accepts can deadlock.
      const [invite] = await tx.select().from(leagueInvites).where(eq(leagueInvites.code, input.code)).for("update");
      if (invite === undefined) return { ok: false as const, status: 404, reason: INVALID };

      /**
       * The invite's own two bounds. Run through `joinLeagueInTx`'s precondition hook rather
       * than before it, so they are checked only for somebody who is NOT already a member:
       * re-opening your own invite link after it expired still returns your existing team,
       * costs no use, and mutates nothing.
       */
      const invitePrecondition: JoinPrecondition = async () => {
        if (Date.parse(clock.now()) >= invite.expiresAt.getTime()) {
          return { ok: false, status: 410, reason: "That invite link has expired. Ask your commissioner for a new one." };
        }
        if (invite.uses >= invite.maxUses) {
          return {
            ok: false,
            status: 410,
            reason: "That invite link has already been used up. Ask your commissioner for a new one.",
          };
        }
        return null;
      };

      const outcome = await joinLeagueInTx(
        tx,
        { leagueId: invite.leagueId, userId: input.userId, teamName: input.teamName, newId },
        invitePrecondition,
      );
      // A league the invite points at but that no longer exists reads as an invalid invite,
      // not as a missing league a stranger was never told about.
      if (!outcome.ok) return outcome.status === 404 ? { ok: false as const, status: 404, reason: INVALID } : outcome;
      // Re-arriving costs nobody a use.
      if (outcome.alreadyMember) return outcome;

      await tx.update(leagueInvites).set({ uses: sql`${leagueInvites.uses} + 1` }).where(eq(leagueInvites.code, input.code));
      return outcome;
    });
```

Keep the existing catch block exactly as it is, changing only its constant import: add

```ts
const TEAM_MEMBERSHIP_UNIQUE_INDEX = "teams_league_user_idx";
```

back at the top of `invites.ts` (both files legitimately name the same index for their own backstop; a shared export of a string constant used in two `catch` clauses is not worth a coupling).

`AcceptInviteResult` is now structurally `JoinLeagueOutcome`; keep the existing alias so no caller changes:

```ts
export type AcceptInviteResult = JoinLeagueOutcome;
```

and delete the old inline union.

- [ ] **Step 6: Run the invite suite to prove behavior is unchanged**

Run: `npm test -- src/league-service/invites.test.ts src/league-service/league-routes.test.ts`
Expected: PASS with **no test edits**. Every existing assertion about expiry, use caps, capacity, idempotent re-accept and the unique-index backstop must still hold — that is the whole point of running them untouched after a refactor.

- [ ] **Step 7: Write the failing route test**

Append to `src/league-service/league-routes.test.ts`:

```ts
describe("POST /api/public/leagues/[leagueId]/join", () => {
  async function openLeague(): Promise<string> {
    await db.insert(leagues).values({
      id: "open", name: "Rookie Snake Room", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1",
    });
    await db.insert(drafts).values({
      id: "open_draft", leagueId: "open", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    return "open";
  }

  it("answers 401 JSON when nobody is signed in, never a redirect", async () => {
    const leagueId = await openLeague();
    signedInAs(null);
    const response = await postPublicJoin(post(`http://test/api/public/leagues/${leagueId}/join`, {}), {
      params: Promise.resolve({ leagueId }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("seats a signed-in visitor and hands back the league and team to land in", async () => {
    const leagueId = await openLeague();
    signedInAs("u2");
    const response = await postPublicJoin(post(`http://test/api/public/leagues/${leagueId}/join`, {}), {
      params: Promise.resolve({ leagueId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ leagueId, alreadyMember: false });
    expect(typeof body.data.teamId).toBe("string");
  });

  it("refuses a private league with a 403 and a plain-language next step", async () => {
    await db.insert(leagues).values({
      id: "private", name: "Group Chat Only", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: false, commissionerUserId: "u1",
    });
    signedInAs("u2");
    const response = await postPublicJoin(post("http://test/api/public/leagues/private/join", {}), {
      params: Promise.resolve({ leagueId: "private" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("invite link");
  });
});
```

Add to that file's imports:

```ts
import { POST as postPublicJoin } from "@/app/api/public/leagues/[leagueId]/join/route";
```

and add `drafts, leagues` to its `@/db/schema` import.

- [ ] **Step 8: Run it to verify it fails**

Run: `npm test -- src/league-service/league-routes.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/public/leagues/[leagueId]/join/route"`.

- [ ] **Step 9: Write the join route**

Create `src/app/api/public/leagues/[leagueId]/join/route.ts`:

```ts
import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { joinPublicLeague } from "@/league-service/join";
import type { JoinBody } from "@/league-room/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/**
 * Joining is where public browse stops being public: READING the open-league list needs no
 * account, but taking a seat in a league is an identity-bearing act, so this half goes through
 * `withCurrentUser` like every other write in the app. `teamId` and the owning user are
 * resolved from the session; no body field can name somebody else.
 *
 * `withLeagueMemberActor` is deliberately NOT used — its whole job is to reject a signed-in
 * stranger with no team, and a signed-in stranger with no team is exactly who this route is
 * for. The membership rules that DO apply (listed, pre-draft, not full) live in
 * `joinPublicLeague`, beside the lock that makes them true under concurrency.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { leagueId } = await params;
    const result = await joinPublicLeague(
      { db: getDb(), newId: () => crypto.randomUUID() },
      { leagueId, userId },
    );
    if (!result.ok) return fail(result.reason, result.status);
    return ok<JoinBody>({ leagueId: result.leagueId, teamId: result.teamId, alreadyMember: result.alreadyMember });
  });
}
```

- [ ] **Step 10: Export the join through the service barrel**

In `src/league-service/index.ts`, add:

```ts
export { joinPublicLeague } from "./join";
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test -- src/league-service`
Expected: PASS.

- [ ] **Step 12: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean. The full suite matters here: `acceptInvite` was refactored and `commit.ts`, the season seeders and the draft routes all sit downstream of the teams it writes.

```bash
git add src/league-service/join.ts src/league-service/join.test.ts src/league-service/invites.ts src/league-service/index.ts src/league-service/league-routes.test.ts src/app/api/public/leagues
git commit -m "feat(matchmaking): join an open league without an invite, through one locked core

Both doors into a league now share joinLeagueInTx: one league-row FOR UPDATE, one capacity
check, one insert. Two hand-written capacity checks are two places a league's fill count can
disagree, and the disagreement only shows up as a 13th team. Path-specific gates (invite
expiry and use cap; public listing and draft status) run through a precondition hook AFTER
the already-a-member lookup, which is what keeps re-arriving free on both paths. The invite
suite passes untouched."
```

---

## Task 5: Seed public leagues

**Files:**
- Create: `src/data/seed/seed-public-leagues.ts`
- Create: `src/data/seed/seed-public-leagues.test.ts`
- Modify: `src/data/seed/config.ts`
- Modify: `src/data/seed/index.ts`

**Interfaces:**
- Consumes: `ensureDevUsers`, `preserveRealCommissioner`, `preserveRealTeamOwner` from `./dev-users`; `DEV_SEED` from `./config`; `Clock` from `@/domain/timing`; `Db` from `@/db/client`.
- Produces: `seedPublicLeagues(db: Db, clock: Clock): Promise<{ leagues: number; teams: number }>`; `DEV_SEED.publicLeagues` — the fixed plan array.

- [ ] **Step 1: Write the failing test**

Create `src/data/seed/seed-public-leagues.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams } from "@/db/schema";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { listPublicLeagues } from "@/league-service/browse";
import { DEV_SEED } from "./config";
import { seedPublicLeagues } from "./seed-public-leagues";

const db = createTestDb();
const clock = { now: () => "2026-08-18T12:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedPublicLeagues", () => {
  it("seeds every planned league with a scheduled draft and the fill level it advertises", async () => {
    const counts = await seedPublicLeagues(db, clock);
    expect(counts.leagues).toBe(DEV_SEED.publicLeagues.length);

    for (const plan of DEV_SEED.publicLeagues) {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, plan.leagueId));
      expect(league).toMatchObject({
        name: plan.name,
        format: plan.format,
        teamCount: plan.teamCount,
        stakeTier: plan.stakeTier,
        experienceTier: plan.experienceTier,
        isPublicMatchmade: true,
      });
      const [draft] = await db.select().from(drafts).where(eq(drafts.leagueId, plan.leagueId));
      expect(draft?.status).toBe("scheduled");
      expect(await db.select().from(teams).where(eq(teams.leagueId, plan.leagueId))).toHaveLength(plan.filled);
    }
  });

  it("covers both formats, both experience tiers and more than one stake tier, so every filter narrows something", async () => {
    await seedPublicLeagues(db, clock);
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(new Set(rows.map((row) => row.format))).toEqual(new Set(["snake", "auction"]));
    expect(new Set(rows.map((row) => row.experienceTier))).toEqual(new Set(["beginner", "experienced"]));
    expect(new Set(rows.map((row) => row.stakeTier)).size).toBeGreaterThan(1);
  });

  it("seeds a full league too, and browse correctly refuses to list it", async () => {
    await seedPublicLeagues(db, clock);
    const full = DEV_SEED.publicLeagues.filter((plan) => plan.filled >= plan.teamCount);
    expect(full.length).toBeGreaterThan(0);
    const listed = new Set((await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).map((row) => row.id));
    for (const plan of full) expect(listed.has(plan.leagueId)).toBe(false);
  });

  it("is safe to run twice: it updates rather than duplicating", async () => {
    await seedPublicLeagues(db, clock);
    const before = await db.select().from(teams);
    await seedPublicLeagues(db, clock);
    expect(await db.select().from(teams)).toHaveLength(before.length);
    expect(await db.select().from(leagues)).toHaveLength(DEV_SEED.publicLeagues.length);
  });

  it("uses no em-dash in any league name a person will read", async () => {
    for (const plan of DEV_SEED.publicLeagues) expect(plan.name).not.toContain("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/data/seed/seed-public-leagues.test.ts`
Expected: FAIL — `Failed to resolve import "./seed-public-leagues"`.

- [ ] **Step 3: Add the plan to the seed config**

In `src/data/seed/config.ts`, add to `DEV_SEED`, after the `season` entry:

```ts
  /**
   * The open leagues the public browse page demonstrates. Chosen so every filter control
   * narrows something real: both formats, both experience tiers, four stake tiers, fill levels
   * from nearly empty to nearly full, plus one deliberately FULL league that must NOT appear in
   * a browse — that is what proves the open-seat rule with a real row instead of a unit test.
   */
  publicLeagues: [
    { leagueId: "dev_public_rookie_snake", draftId: "dev_public_rookie_snake_draft", name: "Rookie Snake Room", format: "snake" as const, experienceTier: "beginner" as const, stakeTier: 0, teamCount: 12, filled: 3 },
    { leagueId: "dev_public_sunday_snake", draftId: "dev_public_sunday_snake_draft", name: "Sunday Regulars", format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 1, teamCount: 12, filled: 8 },
    { leagueId: "dev_public_first_auction", draftId: "dev_public_first_auction_draft", name: "First Auction, No Pressure", format: "auction" as const, experienceTier: "beginner" as const, stakeTier: 0, teamCount: 10, filled: 5 },
    { leagueId: "dev_public_sharks_auction", draftId: "dev_public_sharks_auction_draft", name: "Sharks Only Auction", format: "auction" as const, experienceTier: "experienced" as const, stakeTier: 3, teamCount: 10, filled: 9 },
    { leagueId: "dev_public_two_slots", draftId: "dev_public_two_slots_draft", name: "Two Slots Left", format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 2, teamCount: 8, filled: 6 },
    { leagueId: "dev_public_packed", draftId: "dev_public_packed_draft", name: "Packed House", format: "snake" as const, experienceTier: "beginner" as const, stakeTier: 1, teamCount: 8, filled: 8 },
  ],
```

- [ ] **Step 4: Write the seeder**

Create `src/data/seed/seed-public-leagues.ts`:

```ts
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { DEV_SEED } from "./config";
import { ensureDevUsers, preserveRealCommissioner, preserveRealTeamOwner } from "./dev-users";

const MS_PER_HOUR = 60 * 60 * 1000;
/** Far enough out that a browsed league's draft clock starts in a slow tier, not at the floor. */
const KICKOFF_HOURS = 48;
/** Auction budget for the seeded auction rooms. Cosmetic here, like every stake tier. */
const AUCTION_BUDGET = 200;

/**
 * The open leagues `/browse` demonstrates. Placeholder owners only — real identity is WorkOS's
 * — and it refuses to run in production for the same reason `seedDevLeagues` does.
 *
 * Partially filled on purpose: a browse page whose every league is empty proves nothing about
 * the fill-status copy, and one FULL league proves the open-seat rule against a real row.
 * Idempotent in the row-count sense (every write is an upsert, so replaying is safe) but not
 * byte-identical: `kickoffAt` is recomputed from `clock.now()` on each run, so a real second
 * run legitimately reschedules the drafts. Like `seedDevLeagues`, it does NOT reset a draft's
 * status: doing that without also clearing that draft's `draft_actions` log would leave the two
 * disagreeing.
 */
export async function seedPublicLeagues(db: Db, clock: Clock): Promise<{ leagues: number; teams: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedPublicLeagues creates placeholder users and must never run in production.");
  }

  const kickoffAt = new Date(Date.parse(clock.now()) + KICKOFF_HOURS * MS_PER_HOUR);
  const ownerIds = await ensureDevUsers(db);
  let seededTeams = 0;

  for (const plan of DEV_SEED.publicLeagues) {
    await db
      .insert(leagues)
      .values({
        id: plan.leagueId,
        name: plan.name,
        format: plan.format,
        teamCount: plan.teamCount,
        stakeTier: plan.stakeTier,
        experienceTier: plan.experienceTier,
        isPublicMatchmade: true,
        // Deliberately a placeholder, never the claim user: a browsable league you already
        // run is not a league you can demonstrate JOINING.
        commissionerUserId: ownerIds[0]!,
        rosterSlots: [...STANDARD_ROSTER_SLOTS],
      })
      .onConflictDoUpdate({
        target: leagues.id,
        set: {
          name: plan.name,
          isPublicMatchmade: true,
          stakeTier: plan.stakeTier,
          experienceTier: plan.experienceTier,
          commissionerUserId: preserveRealCommissioner(),
        },
      });

    await db
      .insert(scoringSettings)
      .values({ leagueId: plan.leagueId, ...PPR_SCORING })
      .onConflictDoNothing({ target: scoringSettings.leagueId });

    const seats = ownerIds.slice(0, plan.filled);
    if (seats.length > 0) {
      await db
        .insert(teams)
        .values(
          seats.map((userId, i) => ({
            id: `${plan.leagueId}_team_${String(i + 1).padStart(2, "0")}`,
            leagueId: plan.leagueId,
            userId,
            name: DEV_SEED.teamNames[i] ?? `Team ${i + 1}`,
          })),
        )
        .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });
      seededTeams += seats.length;
    }

    await db
      .insert(drafts)
      .values({
        id: plan.draftId,
        leagueId: plan.leagueId,
        format: plan.format,
        status: "scheduled",
        kickoffAt,
        auctionBudget: plan.format === "auction" ? AUCTION_BUDGET : null,
      })
      .onConflictDoUpdate({ target: drafts.id, set: { kickoffAt } });
  }

  return { leagues: DEV_SEED.publicLeagues.length, teams: seededTeams };
}
```

- [ ] **Step 5: Register it in the one seed entry point**

In `src/data/seed/index.ts`, add the import:

```ts
import { seedPublicLeagues } from "./seed-public-leagues";
```

and, after the `seedSeasonLeague` block:

```ts
  const open = await seedPublicLeagues(db, { now: () => new Date().toISOString() });
  console.log(`seeded ${open.leagues} public matchmaking leagues with ${open.teams} joined managers`);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/data/seed`
Expected: PASS, including the existing `guard`, `seed-players`, `seed-dev-leagues` and `seed-season-league` suites.

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add src/data/seed
git commit -m "feat(seed): public matchmaking leagues at several fill levels and tiers

Every browse filter has something real to narrow: both formats, both experience tiers, four
stake tiers, and fill levels from nearly empty to full. Packed House is seeded FULL on
purpose, so the open-seat rule is proved against a real row rather than only in a unit test.
Commissioners are placeholders, never the claim user: a league you already run is not a
league you can demonstrate joining."
```

---

## Task 6: The `/browse` page

**Files:**
- Create: `src/league-room/components/browse-filters.tsx`
- Create: `src/league-room/components/browse-filters.test.tsx`
- Create: `src/league-room/components/public-league-list.tsx`
- Create: `src/league-room/components/public-league-list.test.tsx`
- Create: `src/league-room/components/join-public-league-button.tsx`
- Create: `src/league-room/components/join-public-league-button.test.tsx`
- Create: `src/app/browse/page.tsx`
- Modify: `src/league-room/test-fixtures.tsx` (add `PUBLIC_LEAGUES`)
- Modify: `src/app/page.tsx` (landing header link)
- Modify: `src/app/app/page.tsx` (signed-in entry point)

**Interfaces:**
- Consumes: `PublicLeagueSummary`, `BrowseFilter` (types, Task 1); `MATCHMAKING_CONFIG`, `stakeTierLabel`, `normalizeBrowseFilter` (values — pure, browser-safe, allowed across the client boundary); `useLeagueRoomDeps` from `../hooks/deps`; `ApiEnvelope` and `JoinBody` as types; `Button`, `Card`, `Badge`, `Select`, `EmptyState`, `PageTitle`, `EYEBROW` from `@/components/ui`.
- Produces:
  - `<BrowseFilters filter={BrowseFilter} />` — a GET form targeting `/browse`.
  - `<PublicLeagueList leagues={readonly PublicLeagueSummary[]} signedIn={boolean} />`
  - `<JoinPublicLeagueButton leagueId={string} leagueName={string} />` (`"use client"`)
  - `/browse` — a Server Component page, renders identically signed out and signed in except for the join affordance.

- [ ] **Step 1: Add the fixture**

Append to `src/league-room/test-fixtures.tsx`:

```tsx
/** Open leagues as `listPublicLeagues` hands them back: one nearly empty, one nearly full. */
export const PUBLIC_LEAGUES: readonly PublicLeagueSummary[] = [
  { id: "p1", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 3 },
  { id: "p2", name: "Sharks Only Auction", format: "auction", experienceTier: "experienced", stakeTier: 3, teamCount: 10, filledTeams: 9 },
];
```

with the import `import type { PublicLeagueSummary } from "@/matchmaking/contract";`.

- [ ] **Step 2: Write the three failing component tests**

Create `src/league-room/components/browse-filters.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { BrowseFilters } from "./browse-filters";

describe("BrowseFilters", () => {
  it("offers every filter as a labelled control, in both themes, axe-clean", async () => {
    await inBothThemes(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />, async ({ container }) => {
      expect(screen.getByLabelText("Draft format")).toBeInTheDocument();
      expect(screen.getByLabelText("Experience")).toBeInTheDocument();
      expect(screen.getByLabelText("Stake tier")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show leagues" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("submits as a plain GET to /browse, so the URL is the filter and it works with no JavaScript", () => {
    const { container } = render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/browse");
  });

  it("reflects the filter already applied, so a shared link renders its own state", () => {
    render(<BrowseFilters filter={{ format: "auction", experienceTier: "experienced", stakeTier: 3 }} />);
    expect(screen.getByLabelText<HTMLSelectElement>("Draft format").value).toBe("auction");
    expect(screen.getByLabelText<HTMLSelectElement>("Experience").value).toBe("experienced");
    expect(screen.getByLabelText<HTMLSelectElement>("Stake tier").value).toBe("3");
  });

  it("offers only the formats the draft engine can actually run", () => {
    render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    const options = [...screen.getByLabelText<HTMLSelectElement>("Draft format").options].map((o) => o.value);
    expect(options).toEqual(["any", "snake", "auction"]);
  });
});
```

Create `src/league-room/components/public-league-list.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { fixtureLeagueDeps, PUBLIC_LEAGUES, renderInLeague } from "../test-fixtures";
import { PublicLeagueList } from "./public-league-list";

describe("PublicLeagueList", () => {
  it("shows each league's format, tiers and fill status, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />,
      async ({ container }) => {
        expect(screen.getByText("Rookie Snake Room")).toBeInTheDocument();
        expect(screen.getByText(/3 of 12 joined/)).toBeInTheDocument();
        expect(screen.getByText(/9 of 10 joined/)).toBeInTheDocument();
        expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(fixture.calls).toEqual([]);
  });

  it("gives a signed-in visitor a join button per league", () => {
    renderInLeague(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Sharks Only Auction" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in rather than to a button that cannot work", () => {
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn={false} />);
    expect(screen.queryByRole("button", { name: /^Join / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in to join" })[0]).toHaveAttribute("href", "/sign-in");
  });

  it("offers a next action when no league matches, rather than a dead end", async () => {
    await inBothThemes(<PublicLeagueList leagues={[]} signedIn />, async ({ container }) => {
      expect(screen.getByText("No open leagues match")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute("href", "/browse");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
```

Create `src/league-room/components/join-public-league-button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { JoinPublicLeagueButton } from "./join-public-league-button";
import { LeagueRoomDepsProvider } from "../hooks/deps";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

describe("JoinPublicLeagueButton", () => {
  it("names the league it joins, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <JoinPublicLeagueButton leagueId="p1" leagueName="Rookie Snake Room" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("posts the join and lands the manager in their new league", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "p1", teamId: "t9", alreadyMember: false } });
    renderInLeague(<JoinPublicLeagueButton leagueId="p1" leagueName="Rookie Snake Room" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Rookie Snake Room" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/leagues/p1"));
    expect(fixture.calls).toEqual(["POST /api/public/leagues/p1/join"]);
  });

  it("shows the server's plain-language refusal in place, and stays on the page", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "That league is already full." });
    renderInLeague(<JoinPublicLeagueButton leagueId="p2" leagueName="Sharks Only Auction" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Sharks Only Auction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That league is already full.");
  });

  it("says something useful when the server cannot be reached at all", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInLeague(<JoinPublicLeagueButton leagueId="p1" leagueName="Rookie Snake Room" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Rookie Snake Room" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/league-room/components/browse-filters.test.tsx src/league-room/components/public-league-list.test.tsx src/league-room/components/join-public-league-button.test.tsx`
Expected: FAIL — three unresolved imports.

- [ ] **Step 4: Write `browse-filters.tsx`**

```tsx
import { Button, Select } from "@/components/ui";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter } from "@/matchmaking/contract";

const ANY = MATCHMAKING_CONFIG.anyValue;
const FORMAT_LABELS: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const TIER_LABELS: Readonly<Record<string, string>> = { beginner: "New to fantasy", experienced: "Played before" };

const FORMAT_OPTIONS = [
  { value: ANY, label: "Any format" },
  ...MATCHMAKING_CONFIG.formats.map((value) => ({ value, label: FORMAT_LABELS[value] ?? value })),
];
const EXPERIENCE_OPTIONS = [
  { value: ANY, label: "Any experience" },
  ...MATCHMAKING_CONFIG.experienceTiers.map((value) => ({ value, label: TIER_LABELS[value] ?? value })),
];
const STAKE_OPTIONS = [
  { value: ANY, label: "Any stake tier" },
  ...MATCHMAKING_CONFIG.stakeTiers.map((entry) => ({ value: String(entry.tier), label: entry.label })),
];

/**
 * Deliberately NOT a client component, and deliberately a plain GET form: the URL IS the
 * filter state, so a filtered browse can be linked, bookmarked, shared and reloaded, and the
 * whole surface works before (and without) any JavaScript. That matters more here than
 * anywhere else in the app — this is the one page a visitor with no account ever sees, on
 * whatever device and connection they happen to have.
 *
 * `defaultValue` rather than `value`: an uncontrolled native control needs no state and no
 * hydration, and the server has already rendered the applied filter into it.
 */
export function BrowseFilters({ filter }: { readonly filter: BrowseFilter }) {
  return (
    <form method="get" action="/browse" className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Select label="Draft format" name="format" options={FORMAT_OPTIONS} defaultValue={String(filter.format)} />
      <Select label="Experience" name="experienceTier" options={EXPERIENCE_OPTIONS} defaultValue={String(filter.experienceTier)} />
      <Select label="Stake tier" name="stakeTier" options={STAKE_OPTIONS} defaultValue={String(filter.stakeTier)} />
      <Button type="submit" variant="secondary">
        Show leagues
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Write `join-public-league-button.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { JoinBody } from "../contract";
import { Button } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

/**
 * The one interactive thing on a public page. Built exactly like `JoinForm`: the injected
 * `fetchJson` seam, the envelope, the server's own plain-language refusal shown in place.
 *
 * A refusal is shown here rather than thrown away because the reasons are all real and all
 * recoverable from this page: the league filled, or its draft started, between the render and
 * the press. The visitor stays on the list and can pick another league.
 */
export function JoinPublicLeagueButton({
  leagueId,
  leagueName,
}: {
  readonly leagueId: string;
  readonly leagueName: string;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const join = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/public/leagues/${leagueId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as ApiEnvelope<JoinBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/leagues/${body.data.leagueId}`);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={() => void join()} loading={submitting} disabled={submitting} aria-label={`Join ${leagueName}`}>
        Join
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `public-league-list.tsx`**

```tsx
import Link from "next/link";
import { Badge, Card, EmptyState, EYEBROW } from "@/components/ui";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { JoinPublicLeagueButton } from "./join-public-league-button";

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const TIER_LABEL: Readonly<Record<string, string>> = { beginner: "New to fantasy", experienced: "Played before" };

/**
 * The matching open leagues. Not a client component: it renders server-shaped data, and the one
 * interactive part is a child that owns its own state.
 *
 * Fill status is stated plainly ("3 of 12 joined") rather than drawn as a bar, because the
 * number is the decision a visitor is actually making and a bar makes them estimate it. Every
 * fact on a card comes from `PublicLeagueSummary` and nothing else — see that contract for what
 * a stranger is and is not told.
 */
export function PublicLeagueList({
  leagues,
  signedIn,
}: {
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
}) {
  if (leagues.length === 0) {
    return (
      <EmptyState
        title="No open leagues match"
        description="Widen the filters, or start your own league and invite your group."
        icon="search"
        action={
          <Link href="/browse" className="text-sm font-medium text-accent underline">
            Clear the filters
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => (
          <li key={league.id}>
            <Card as="article" className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-2xl font-bold uppercase leading-display text-text-primary">
                  {league.name}
                </h3>
                <Badge tone="neutral">{stakeTierLabel(league.stakeTier)}</Badge>
              </div>
              <p className={EYEBROW}>
                {`${FORMAT_LABEL[league.format] ?? league.format} · ${TIER_LABEL[league.experienceTier] ?? league.experienceTier}`}
              </p>
              <p className="text-sm text-text-muted">{`${league.filledTeams} of ${league.teamCount} joined`}</p>
              <div className="mt-auto">
                {signedIn ? (
                  <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} />
                ) : (
                  <Link
                    href="/sign-in"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    Sign in to join
                  </Link>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-muted">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
    </div>
  );
}
```

- [ ] **Step 7: Run the component tests to verify they pass**

Run: `npm test -- src/league-room`
Expected: PASS.

- [ ] **Step 8: Write the page**

Create `src/app/browse/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { listPublicLeagues } from "@/league-service/browse";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { BrowseFilters } from "@/league-room/components/browse-filters";
import { PublicLeagueList } from "@/league-room/components/public-league-list";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;

/**
 * The public front door to matchmaking, and the only page under a non-`/app` prefix that reads
 * league data. `middleware.ts` does not redirect outside `/app`, so this renders for a
 * signed-out visitor by design — `getCurrentUser()` returning null is the expected case, not an
 * error, and the only thing it changes is whether a card offers a join button or a sign-in
 * link. The signed-in chrome (`AppHeader`) appears only when there is a person to name.
 */
export default async function BrowsePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = normalizeBrowseFilter({
    format: first(params.format),
    experienceTier: first(params.experienceTier),
    stakeTier: first(params.stakeTier),
  });
  const user = await getCurrentUser();
  const leagues = await listPublicLeagues(getDb(), filter);

  return (
    <>
      {user === null ? (
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3">
            <Link
              href="/"
              className="font-display text-xl font-bold uppercase tracking-wide text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Commish
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-accent underline">
              Sign in
            </Link>
          </div>
        </header>
      ) : (
        <AppHeader displayName={user.displayName} />
      )}
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Open leagues</PageTitle>
        <p className="max-w-prose text-text-muted">
          Leagues looking for managers, with a draft still to come. Pick one that matches how you
          like to play.
        </p>
        <BrowseFilters filter={filter} />
        <PublicLeagueList leagues={leagues} signedIn={user !== null} />
      </main>
    </>
  );
}
```

- [ ] **Step 9: Add the two entry points**

In `src/app/page.tsx`, inside the landing header's `<header>` block, put a browse link before the sign-in link:

```tsx
        <div className="flex items-center gap-2">
          <Link
            href="/browse"
            className="rounded-md px-4 py-2 font-medium text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Browse open leagues
          </Link>
          <Link
            href="/sign-in"
            className="rounded-md px-4 py-2 font-medium text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign in
          </Link>
        </div>
```

(replacing the single sign-in `<Link>` currently there).

In `src/app/app/page.tsx`, add a third section between the join and create sections:

```tsx
        <section aria-label="Find a league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">No group to play with yet?</h2>
          <p className="text-sm text-text-muted">Browse leagues that are still looking for managers.</p>
          <Link href="/browse" className="text-accent underline">
            Browse open leagues
          </Link>
        </section>
```

with `import Link from "next/link";` added to that file.

- [ ] **Step 10: Manual walkthrough against the real stack**

Run:

```bash
npm run infra:up
npm run db:migrate
npm run seed
npm run dev
```

Then verify by hand, and record the result in the commit body:

1. Open `http://localhost:3000/browse` in a **signed-out** window. Five open leagues render; "Packed House" does not.
2. Filter to Auction + Played before + High stakes. Only "Sharks Only Auction" remains, and the URL carries the filter. Reload: the controls still show it.
3. Every card offers "Sign in to join".
4. Sign in, return to `/browse`, press Join on "Rookie Snake Room". You land on that league's home with a team.
5. Press browser Back, press Join on the same league again. You land in it again (idempotent), no error.
6. Resize to 360px: no horizontal page scroll, controls stack, cards stay readable.
7. Keyboard only: Tab reaches every select, the submit button, and every join affordance in order; focus rings are visible in both themes; toggle the theme and repeat.

- [ ] **Step 11: Persona-panel review pass**

`/browse` is a brand-new user-facing surface and the first page an unauthenticated visitor sees after the landing page. Run the standing persona panel over it before committing, checking specifically: whether "Experience" reads as a judgment or as a helpful filter; whether the stake-tier badge could be read as a dollar amount; whether a beginner understands "3 of 12 joined" means they will wait for the rest; and whether the empty state's two offers (widen filters, start your own) are the right two. Record the panel's findings in the commit body and fix anything it flags.

- [ ] **Step 12: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean.

```bash
git add src/league-room/components/browse-filters.tsx src/league-room/components/browse-filters.test.tsx src/league-room/components/public-league-list.tsx src/league-room/components/public-league-list.test.tsx src/league-room/components/join-public-league-button.tsx src/league-room/components/join-public-league-button.test.tsx src/league-room/test-fixtures.tsx src/app/browse src/app/page.tsx src/app/app/page.tsx
git commit -m "feat(matchmaking): the public /browse page, filter and join

Filter-and-browse, not blind auto-assignment: the URL is the filter state and the controls
are a plain GET form, so a filtered browse is linkable, bookmarkable and works before any
JavaScript does. That matters most here, because this is the one page a visitor with no
account ever reaches. Fill status is a stated number rather than a bar, since the number is
the decision. Stake tiers carry the no-money line on the same screen as the badge."
```

---

## Task 7: The headless draft → commit → season proof

**Files:**
- Create: `src/integration/pipeline.ts`
- Create: `src/integration/draft-to-season.test.ts`
- Create: `src/integration/features-against-real-draft.test.ts`

**Interfaces:**
- Consumes: `createDraftStore` from `@/draft-service/store`; `seedDraftFixture`, `SPRINT_ROSTER_SLOTS` from `@/draft-service/test-support`; `currentDeadline` from `@/draft-engine`; `leagueHome`, `matchupWeek`, `scoreWeek` from `@/league-service`; `setLineup`, `getLineup` from `@/league-service/lineups`; `postMessage`, `listMessages` from `@/chat-service/chat`; `assembleAdvisorContext` from `@/ai-advisor/context`; `listPublicLeagues` from `@/league-service/browse`; `createTestDb`, `truncateAll` from `@/db/test-db`.
- Produces:
  - `interface DraftedLeague { readonly draftId: string; readonly leagueId: string; readonly teamIds: readonly string[]; readonly userIds: readonly string[] }`
  - `runRealDraft(db: Db, format: DraftFormat, key: string): Promise<DraftedLeague>` — seeds a league, runs a REAL draft to completion through the store, and returns the ids. The commit is the store's own automatic commit-on-completion; nothing here calls `commitDraftState` by hand.

**Why this exists (put in the module doc comment):** the v1 review found that a completed draft and a season/standings view were never proven to connect. Everything downstream of a draft in this codebase is tested against *seeded fixtures* — rows written directly by a test or by `src/data/seed/**`. This suite is the one place they are tested against what an actual draft *produces*, which is the only way drift between the two is ever caught.

- [ ] **Step 1: Write the failing test**

Create `src/integration/draft-to-season.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftPicks, drafts, matchups, rosterSlots, weeks } from "@/db/schema";
import { LEAGUE_CONFIG } from "@/league";
import { leagueHome, matchupWeek, scoreWeek } from "@/league-service";
import { runRealDraft } from "./pipeline";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * The proof the v1 review asked for, for BOTH formats: a real draft, run through the real
 * store, committed by the store's own commit-on-completion, then read back through the exact
 * functions the standings and matchup PAGES call. No hand-written roster rows anywhere.
 */
describe.each(["snake", "auction"] as const)("a real %s draft becomes a real season", (format) => {
  it("commits every pick onto the rosters the league home then renders", async () => {
    const league = await runRealDraft(db, format, `pipe_${format}`);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, league.draftId));
    expect(draft?.status).toBe("complete");

    const picks = await db
      .select()
      .from(draftPicks)
      .where(eq(draftPicks.draftId, league.draftId))
      .orderBy(asc(draftPicks.pickNumber));
    expect(picks).toHaveLength(league.teamIds.length * 3);
    expect(new Set(picks.map((pick) => pick.playerId)).size).toBe(picks.length);
    // An auction pick carries the price it cleared at; a snake pick has none.
    expect(picks.every((pick) => (format === "auction" ? pick.price !== null : pick.price === null))).toBe(true);

    // What the DRAFT produced, per team.
    const draftedByTeam = new Map<string, string[]>();
    for (const pick of picks) {
      draftedByTeam.set(pick.teamId, [...(draftedByTeam.get(pick.teamId) ?? []), pick.playerId]);
    }

    // What the SEASON believes each team owns.
    for (const teamId of league.teamIds) {
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
      expect(slots).toHaveLength(3);
      expect([...slots.map((slot) => slot.slot)].sort()).toEqual(["QB", "RB", "WR"]);
      expect(slots.map((slot) => slot.playerId).filter((id): id is string => id !== null).sort()).toEqual(
        [...(draftedByTeam.get(teamId) ?? [])].sort(),
      );
    }

    // And the page-level read agrees with both.
    const home = await leagueHome(db, league.leagueId, league.userIds[0]!);
    expect(home).not.toBeNull();
    expect(home!.draftStatus).toBe("complete");
    expect(home!.standings).toHaveLength(league.teamIds.length);
  });

  it("writes the whole season's fixtures in the same transaction that finishes the draft", async () => {
    const league = await runRealDraft(db, format, `sched_${format}`);

    const weekRows = await db.select().from(weeks).where(eq(weeks.leagueId, league.leagueId));
    expect(weekRows).toHaveLength(LEAGUE_CONFIG.regularSeasonWeeks);
    const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, league.leagueId));
    expect(matchupRows.length).toBeGreaterThan(0);

    const home = await leagueHome(db, league.leagueId, league.userIds[0]!);
    expect(home!.totalWeeks).toBe(LEAGUE_CONFIG.regularSeasonWeeks);
    expect(home!.myMatchup).not.toBeNull();
  });

  it("scores week 1 off the drafted rosters and moves the standings", async () => {
    const league = await runRealDraft(db, format, `score_${format}`);

    const scored = await scoreWeek(db, league.leagueId, 1);
    expect(scored.ok).toBe(true);

    const week = await matchupWeek(db, league.leagueId, 1, league.userIds[0]!);
    expect(week).not.toBeNull();
    expect(week!.matchups.length).toBeGreaterThan(0);
    for (const detail of week!.matchups) {
      expect(detail.final).toBe(true);
      // Every starter on the board came out of the draft, not out of a fixture.
      expect(detail.home.starters.every((entry) => entry.playerId !== null)).toBe(true);
      expect(detail.away.starters.every((entry) => entry.playerId !== null)).toBe(true);
    }

    const home = await leagueHome(db, league.leagueId, league.userIds[0]!);
    const played = home!.standings.reduce((total, row) => total + row.wins + row.losses + row.ties, 0);
    expect(played).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/integration`
Expected: FAIL — `Failed to resolve import "./pipeline"`.

- [ ] **Step 3: Write `src/integration/pipeline.ts`**

```ts
import type { Db } from "@/db/client";
import { players } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import { currentDeadline } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";

/**
 * Shared by every test in `src/integration/**`. NOT a test file — no `describe`, no `it` — so
 * it is imported rather than run.
 *
 * `SPRINT_ROSTER_SLOTS` (QB/RB/WR) keeps a full, genuinely-finished draft to six picks for two
 * teams. Short is the point: this suite exists to prove the SEAM, and a sixteen-round standard
 * roster would prove the same seam twenty times more slowly.
 */

/** One player per position per team slot, so a two-team sprint draft always fills. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
];

/** Weekly production for the six pool players, so a scored week is not a table of zeroes. */
const STAT_LINES = [
  { playerId: "qb1", passingYards: 300, passingTouchdowns: 3 },
  { playerId: "qb2", passingYards: 210, passingTouchdowns: 1 },
  { playerId: "rb1", rushingYards: 120, rushingTouchdowns: 1 },
  { playerId: "rb2", rushingYards: 60, receptions: 3, receivingYards: 25 },
  { playerId: "wr1", receivingYards: 110, receptions: 8, receivingTouchdowns: 1 },
  { playerId: "wr2", receivingYards: 45, receptions: 4 },
];

export interface DraftedLeague {
  readonly draftId: string;
  readonly leagueId: string;
  readonly teamIds: readonly string[];
  readonly userIds: readonly string[];
}

const CLOCK = { now: () => "2026-09-01T00:00:00.000Z" };
/** Publishing is best-effort by contract; this suite proves persistence, not fan-out. */
const PUBLISH = async () => "1-0";
/** A finished six-pick draft cannot need more turns than this; the cap is a hang guard. */
const MAX_TURNS = 100;

/**
 * Seeds a league and runs a REAL draft in it to completion, letting the clock autopick every
 * turn. The commit into rosters, picks and the season schedule is the store's OWN
 * commit-on-completion — nothing here calls `commitDraftState` by hand, because a test that
 * commits for itself proves only that the commit function works, not that a finished draft
 * actually triggers it.
 *
 * `key` namespaces the ids so several drafted leagues can coexist inside one test.
 */
export async function runRealDraft(db: Db, format: DraftFormat, key: string): Promise<DraftedLeague> {
  const fixture = await seedDraftFixture(db, {
    draftId: `${key}_draft`,
    leagueId: `${key}_league`,
    format,
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: format === "auction" ? 50 : null,
  });
  await db.insert(players).values(POOL_ROWS).onConflictDoNothing({ target: players.id });

  const store = createDraftStore({ db, publish: PUBLISH, clock: CLOCK });
  const started = await store.startDraft(fixture.draftId);
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const state = await store.getDraftState(fixture.draftId);
    if (state === null) throw new Error("draft vanished mid-run");
    if (state.phase === "complete") {
      return { draftId: fixture.draftId, leagueId: fixture.leagueId, teamIds: fixture.teamIds, userIds: fixture.userIds };
    }
    // The reducer rejects an expiry before the deadline it actually set, so advance to that
    // deadline rather than reasoning about the clock's tightening tiers here.
    const result = await store.applyAction(fixture.draftId, {
      v: 1,
      type: "TIMER_EXPIRE",
      timestamp: currentDeadline(state) ?? CLOCK.now(),
    });
    if (!result.ok) throw new Error(`turn ${turn} rejected: ${result.reason}`);
  }
  throw new Error("draft did not finish");
}

/** Inserts one week of production for the sprint pool. Callers score against it. */
export async function seedWeekStats(db: Db, weekNumber: number): Promise<void> {
  const { playerStatLines } = await import("@/db/schema");
  await db
    .insert(playerStatLines)
    .values(STAT_LINES.map((line) => ({ ...line, week: weekNumber })))
    .onConflictDoNothing();
}
```

Replace the dynamic import with a top-level one when writing the file — `import { players, playerStatLines } from "@/db/schema";` — the dynamic form above is only there to keep the two concerns visually separate in this plan.

- [ ] **Step 4: Wire the stats into the pipeline's caller**

`scoreWeek` reads `player_stat_lines`, so `draft-to-season.test.ts`'s scoring case needs them. Add to that file's `beforeEach`, after `truncateAll`: nothing (players are inserted by `runRealDraft`), and add `await seedWeekStats(db, 1);` as the first line of the "scores week 1" test, importing `seedWeekStats` alongside `runRealDraft`.

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -- src/integration`
Expected: PASS — six cases (three per format).

- [ ] **Step 6: Write the failing feature-smoke test**

Create `src/integration/features-against-real-draft.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues } from "@/db/schema";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import { listMessages, postMessage } from "@/chat-service/chat";
import { listPublicLeagues } from "@/league-service/browse";
import { joinPublicLeague } from "@/league-service/join";
import { getLineup, setLineup } from "@/league-service/lineups";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { runRealDraft, seedWeekStats } from "./pipeline";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * Steps 6, 8, 9 and 10 were all built against SEEDED fixtures. This is the one place each is
 * exercised against a league an actual draft produced, which is the only way drift between
 * "what a seeder writes" and "what a draft writes" is ever caught.
 */
describe("features built on fixtures, run against a real drafted league", () => {
  it("the lineup editor's seam accepts a lineup made of genuinely drafted players", async () => {
    const league = await runRealDraft(db, "snake", "lineup");
    const teamId = league.teamIds[0]!;

    const before = await getLineup(db, {
      teamId,
      weekNumber: 1,
      slotConfig: [
        { slot: "QB", count: 1, eligiblePositions: ["QB"] },
        { slot: "RB", count: 1, eligiblePositions: ["RB"] },
        { slot: "WR", count: 1, eligiblePositions: ["WR"] },
      ],
    });
    // A manager who never opened the editor still fields a legal team, derived from the roster
    // the DRAFT wrote rather than from a fixture.
    expect(before.filter((slot) => slot.slot !== "BENCH").every((slot) => slot.playerId !== null)).toBe(true);

    const result = await setLineup(db, {
      leagueId: league.leagueId,
      teamId,
      weekNumber: 1,
      slots: before
        .filter((slot) => slot.slot !== "BENCH")
        .map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
    });
    expect(result.ok).toBe(true);
  });

  it("league chat works in a league that came out of a draft, not out of a seeder", async () => {
    const league = await runRealDraft(db, "snake", "chat");
    const published: string[] = [];

    await postMessage(db, {
      leagueId: league.leagueId,
      userId: league.userIds[0]!,
      body: "Good draft everyone.",
      publish: async (input) => {
        published.push(input.type);
        return "1-0";
      },
    });

    const page = await listMessages(db, { leagueId: league.leagueId });
    expect(page.messages.map((message) => message.body)).toEqual(["Good draft everyone."]);
    expect(published).toEqual(["chat.message"]);
  });

  it("the advisor assembles real context from a drafted roster and a real opponent", async () => {
    const league = await runRealDraft(db, "snake", "advisor");
    await seedWeekStats(db, 1);

    const context = await assembleAdvisorContext(db, {
      leagueId: league.leagueId,
      teamId: league.teamIds[0]!,
      weekNumber: 1,
    });
    expect(context).not.toBeNull();
    expect(context!.roster.length).toBeGreaterThan(0);
    // Every player the advisor reasons about was genuinely drafted by this team.
    expect(context!.roster.every((entry) => entry.playerId !== null)).toBe(true);
    expect(context!.opponentTeamName).not.toBeNull();
  });

  it("public browse and the public join operate on a real drafted league's sibling, and refuse the drafted one", async () => {
    const drafted = await runRealDraft(db, "snake", "browse");
    // The drafted league is publicly listed AFTER the fact — browse must still hide it,
    // because its draft has already run. This is the drift check: a seeder would never
    // produce a "public league whose draft is complete", but a real one can.
    await db.update(leagues).set({ isPublicMatchmade: true }).where(eq(leagues.id, drafted.leagueId));
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);

    const outsider = drafted.userIds[1]!;
    const joined = await joinPublicLeague({ db, newId: () => "team_outsider" }, {
      leagueId: drafted.leagueId,
      userId: outsider,
    });
    // The outsider already has a team here (they drafted in it), so this is the free
    // re-arrival case, not a new seat in a league that has already drafted.
    expect(joined).toMatchObject({ ok: true, alreadyMember: true });

    // And a genuinely pre-draft public league IS listed and joinable.
    await db.insert(leagues).values({
      id: "open", name: "Rookie Snake Room", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true,
      commissionerUserId: drafted.userIds[0]!,
    });
    await db.insert(drafts).values({
      id: "open_draft", leagueId: "open", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    expect((await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).map((row) => row.id)).toEqual(["open"]);
    expect(await joinPublicLeague({ db, newId: () => "team_new" }, { leagueId: "open", userId: outsider })).toMatchObject({
      ok: true,
      alreadyMember: false,
    });
  });

  it("the draft moderator's nudge claim survives a real draft's action log", async () => {
    const league = await runRealDraft(db, "snake", "nudge");
    const { draftNudges } = await import("@/db/schema");
    // The moderator's claim table is keyed on (draftId, pickNumber) and is NOT part of replay.
    // A draft that ran to completion must leave the draft itself complete regardless of what
    // the moderator did or did not write.
    const claims = await db.select().from(draftNudges).where(eq(draftNudges.draftId, league.draftId));
    expect(Array.isArray(claims)).toBe(true);
    const [row] = await db.select().from(drafts).where(eq(drafts.id, league.draftId));
    expect(row?.status).toBe("complete");
  });
});
```

Move the two dynamic `import(...)` calls to top-level imports when writing the file.

If any of `getLineup`, `setLineup`, `assembleAdvisorContext` or `listMessages` has a different parameter shape than assumed above, read its own signature and adjust the call — the assertion is what matters, not the exact argument spelling.

- [ ] **Step 7: Run it to verify it fails, then passes**

Run: `npm test -- src/integration/features-against-real-draft.test.ts`
Expected: FAIL first (unresolved import), PASS once the file exists and the call shapes match.

- [ ] **Step 8: Run the whole suite and the coverage gate**

Run: `npm test && npm run test:coverage`
Expected: PASS. `src/integration/**` is not coverage-gated and must not be added to `COVERAGE_GATED_DIRS`: it holds no rules of its own, only assertions about other modules' rules, and gating a test-support file at 100% measures nothing.

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add src/integration
git commit -m "test(integration): prove draft -> commit -> season, for snake and auction

The v1 review's finding, closed: a completed draft and a standings view were demonstrable in
isolation but never proven to connect. runRealDraft runs a real draft through the real store
and lets the store's own commit-on-completion fire, so the test proves that finishing a draft
TRIGGERS the commit, not merely that the commit function works when called. The second file
re-runs chat, the lineup seam, the advisor, browse/join and the moderator's claim table
against that output, which is the only way drift between what a seeder writes and what a
draft writes gets caught."
```

---

## Task 8: Playwright against the real stack

**Files:**
- Create: `scripts/lib/lab-session.ts`
- Modify: `scripts/mint-dev-session.ts` (import the shared helper)
- Create: `playwright.config.ts`
- Create: `e2e/global-setup.ts`
- Create: `e2e/support/fixtures.ts`
- Create: `e2e/league-lifecycle.spec.ts`
- Create: `e2e/season.spec.ts`
- Modify: `package.json` (dependency + scripts)
- Modify: `vitest.config.mts` (exclude `e2e/**`)
- Modify: `.gitignore`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `WorkOS` from `@workos-inc/node`; `sealData` from `iron-session`; the running app at `E2E_BASE_URL`.
- Produces:
  - `interface LabSession { readonly userId: string; readonly email: string; readonly cookie: string }`
  - `mintLabSession(options?: { readonly email?: string; readonly password?: string }): Promise<LabSession>`
  - `SESSION_COOKIE_NAME = "wos-session"`
  - `e2e/support/fixtures.ts` exports a Playwright `test` with `managerA` and `managerB` `Page` fixtures, plus `seededSeasonLeagueId`.

- [ ] **Step 1: Add the dependency and the scripts**

Run:

```bash
npm install --save-dev @playwright/test@^1.62.1
npx playwright install --with-deps chromium
```

In `package.json`, add to `scripts`:

```json
    "e2e": "dotenv -e .env.local -- playwright test",
    "e2e:ui": "dotenv -e .env.local -- playwright test --ui",
    "e2e:install": "playwright install --with-deps chromium",
```

- [ ] **Step 2: Keep Vitest out of `e2e/`**

Vitest's default `include` matches `**/*.spec.ts`, so without this it would try to collect the Playwright specs and fail on `@playwright/test`'s globals. In `vitest.config.mts`, change the `exclude` line to:

```ts
    exclude: ["**/node_modules/**", "**/.claude/**", "**/.next/**", "e2e/**"],
```

Run: `npm test`
Expected: PASS, with no attempt to load anything under `e2e/`.

- [ ] **Step 3: Ignore the minted credentials**

In `.gitignore`, extend the existing lab-session block:

```
# minted dev session credentials (scripts/mint-dev-session.ts, e2e/global-setup.ts) — bearer
# cookies, never commit
.lab-session*.json
lab-session*.json
e2e/.auth/
playwright-report/
test-results/
```

- [ ] **Step 4: Extract the session minter both callers share**

Create `scripts/lib/lab-session.ts`:

```ts
// Dev/test-only. Creates a real WorkOS TEST-directory user, authenticates with a password, and
// seals the session exactly as authkit-nextjs does — the one authentication seam the browser
// lab and the e2e suite share. There is deliberately no "dev auth bypass" anywhere in this
// repo: a sealed real session exercises the real middleware, the real callback and the real
// `getCurrentUser()` path, and a bypass would exercise none of them.
import { randomBytes } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { sealData } from "iron-session";

/** The cookie authkit-nextjs reads. Named once so the lab and the e2e suite cannot drift. */
export const SESSION_COOKIE_NAME = "wos-session";

const TEST_KEY_PREFIX = "sk_test_";

export interface LabSession {
  readonly userId: string;
  readonly email: string;
  /** A complete bearer credential. Never log it, never print it, never commit it. */
  readonly cookie: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — run under \`dotenv -e .env.local\`, or set it in the environment.`);
  }
  return value;
}

/**
 * Refuses anything but a WorkOS TEST key: `createUser({ emailVerified: true })` against a
 * production key silently plants a permanent, pre-verified account in the real directory.
 */
export async function mintLabSession(options: { readonly email?: string; readonly password?: string } = {}): Promise<LabSession> {
  const apiKey = requiredEnv("WORKOS_API_KEY");
  if (!apiKey.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Refusing to run: WORKOS_API_KEY is not a test key (expected a "${TEST_KEY_PREFIX}" prefix). This creates a permanent, pre-verified user in whatever directory the key names.`,
    );
  }
  const clientId = requiredEnv("WORKOS_CLIENT_ID");
  const cookiePassword = requiredEnv("WORKOS_COOKIE_PASSWORD");

  const email = options.email ?? `commish-lab+${Date.now()}-${randomBytes(4).toString("hex")}@example.com`;
  // CSPRNG, not Math.random: this password authenticates a real (test-directory) account.
  const password = options.password ?? `Lab-${randomBytes(24).toString("base64url")}-1!x`;

  const workos = new WorkOS(apiKey);
  const user = await workos.userManagement.createUser({
    email,
    password,
    emailVerified: true,
    firstName: "Commish",
    lastName: "Lab",
  });
  const auth = await workos.userManagement.authenticateWithPassword({ clientId, email, password });
  const cookie = await sealData(
    { accessToken: auth.accessToken, refreshToken: auth.refreshToken, user: auth.user },
    { password: cookiePassword, ttl: 0 },
  );

  return { userId: user.id, email, cookie };
}
```

Then rewrite `scripts/mint-dev-session.ts`'s `main()` to use it, keeping its file-writing behavior and its 0600 mode exactly as they are:

```ts
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mintLabSession } from "./lib/lab-session";

const DEFAULT_OUT = ".lab-session.json";

async function main() {
  const outPath = resolve(process.argv[2] ?? process.env.LAB_SESSION_FILE ?? DEFAULT_OUT);
  const session = await mintLabSession({ email: process.env.LAB_EMAIL, password: process.env.LAB_PASSWORD });
  // The sealed cookie is a complete bearer credential, so it is NEVER printed: it goes to a
  // 0600 file (argv[2], else $LAB_SESSION_FILE, else ./.lab-session.json — all gitignored) and
  // only the path and the user id reach stdout.
  writeFileSync(outPath, JSON.stringify(session), { mode: 0o600 });
  // `mode` only applies when the file is created; chmod covers an existing, looser file.
  chmodSync(outPath, 0o600);
  console.log(`wrote session for ${session.userId} to ${outPath} (mode 0600)`);
}
main().catch((e) => { console.error(e?.rawData ?? e); process.exit(1); });
```

`process.env.LAB_EMAIL`/`LAB_PASSWORD` are `string | undefined`, which matches `mintLabSession`'s optional fields exactly.

Run: `dotenv -e .env.local -- tsx scripts/mint-dev-session.ts /tmp/commish-lab-check.json`
Expected: prints `wrote session for user_… to /tmp/commish-lab-check.json (mode 0600)`, and never prints a cookie. Delete the file afterwards.

- [ ] **Step 5: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * The e2e suite runs against the REAL stack: the production build of this app, the real
 * docker-compose Postgres and Redis, and a real WorkOS test-directory session. Nothing is
 * mocked and no auth bypass exists — see `scripts/lib/lab-session.ts`.
 *
 * One worker, no parallelism: every spec shares one database and one seeded dataset, exactly
 * like the Vitest suite's `fileParallelism: false`. Two specs scoring the same week at once
 * would race the same rows and flake for a reason that has nothing to do with the product.
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  // One retry in CI only: a genuine product failure repeats, while a cold-start timeout on a
  // shared runner does not. Locally, a failure should stay failed.
  retries: process.env.CI !== undefined ? 1 : 0,
  reporter: process.env.CI !== undefined ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `next start`, not `next dev`: an e2e run should exercise what a deploy would serve, and
    // dev-mode compilation on first hit is the single largest source of e2e timeout flake.
    command: "npm run start",
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
  },
});
```

- [ ] **Step 6: Write `e2e/global-setup.ts`**

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { mintLabSession, SESSION_COOKIE_NAME } from "../scripts/lib/lab-session";

export const AUTH_DIR = resolve(process.cwd(), "e2e/.auth");
export const MANAGER_A_STATE = resolve(AUTH_DIR, "manager-a.json");
export const MANAGER_B_STATE = resolve(AUTH_DIR, "manager-b.json");

function storageState(baseURL: string, cookie: string): string {
  const { hostname } = new URL(baseURL);
  return JSON.stringify({
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: cookie,
        domain: hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  });
}

/**
 * Two real managers, one seeded season, no bypass.
 *
 * The order matters and each step earns its place:
 *
 * 1. **Mint** two WorkOS test-directory sessions. This throws with a named variable if the
 *    WorkOS test credentials are absent — a loud stop, never a silently skipped suite.
 * 2. **Warm** each session by loading `/app` once. That is what makes `getCurrentUser()` write
 *    the local `users` row, and step 3 has a foreign key onto it. Doing it through the real
 *    page rather than a direct insert is the whole point: if identity sync is broken, the e2e
 *    suite should fail here rather than paper over it.
 * 3. **Seed** with manager A's id as `DEV_SEED_CLAIM_USER_ID`, so A owns team 1 and the
 *    commissioner's chair in the seeded season league and can actually score a week.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";

  const [a, b] = await Promise.all([mintLabSession(), mintLabSession()]);

  mkdirSync(AUTH_DIR, { recursive: true });
  // Bearer credentials on disk: same 0600 treatment the mint script gives its own output.
  writeFileSync(MANAGER_A_STATE, storageState(baseURL, a.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_B_STATE, storageState(baseURL, b.cookie), { mode: 0o600 });

  const browser = await chromium.launch();
  try {
    for (const state of [MANAGER_A_STATE, MANAGER_B_STATE]) {
      const context = await browser.newContext({ storageState: state, baseURL });
      const page = await context.newPage();
      const response = await page.goto("/app", { waitUntil: "domcontentloaded" });
      if (response === null || response.status() >= 400) {
        throw new Error(`Session warm-up failed for ${state}: /app answered ${response?.status() ?? "no response"}.`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // `-v` rather than an inherited env var: `npm run seed` runs under `dotenv -e .env.local`,
  // and `.env.local` sets DEV_SEED_CLAIM_USER_ID itself. `-v` is the spelling this repo
  // already uses for exactly this override (see the `db:migrate:test` script).
  execFileSync(
    "npx",
    ["dotenv", "-e", ".env.local", "-v", `DEV_SEED_CLAIM_USER_ID=${a.userId}`, "--", "tsx", "src/data/seed/index.ts"],
    { stdio: "inherit", cwd: dirname(AUTH_DIR).replace(/\/e2e$/, "") },
  );
}
```

Set `cwd` to the repo root — `resolve(AUTH_DIR, "../..")` is the clearer spelling; use that instead of the regex above when writing the file.

- [ ] **Step 7: Write `e2e/support/fixtures.ts`**

```ts
import { test as base, type Page } from "@playwright/test";
import { DEV_SEED } from "../../src/data/seed/config";
import { MANAGER_A_STATE, MANAGER_B_STATE } from "../global-setup";

/**
 * Two signed-in managers in two INDEPENDENT browser contexts — separate cookie jars, separate
 * `EventSource` connections, separate everything. That independence is the point: a realtime
 * fan-out assertion made inside one context proves nothing, because a page can always see its
 * own optimistic update.
 */
export const test = base.extend<{ managerA: Page; managerB: Page }>({
  managerA: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_A_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerB: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_B_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export const expect = test.expect;

/** The already-played league `npm run seed` hands manager A the commissioner's chair in. */
export const SEEDED_SEASON_LEAGUE_ID = DEV_SEED.season.leagueId;
/** The seeded snake draft, scheduled and ready to run. */
export const SEEDED_SNAKE_DRAFT_ID = DEV_SEED.snake.draftId;
export const SEEDED_SNAKE_LEAGUE_ID = DEV_SEED.snake.leagueId;
```

- [ ] **Step 8: Write `e2e/league-lifecycle.spec.ts`**

```ts
import { expect, test } from "./support/fixtures";

/**
 * Create -> invite -> join -> draft -> live fan-out, through the real UI, in two real browser
 * contexts.
 *
 * This spec deliberately does NOT run a draft to completion: a full sixteen-round draft on the
 * clock is minutes of real time and proves nothing the `src/integration/**` suite has not
 * already proved deterministically. What only a browser can prove is the part that suite
 * cannot touch at all: that a pick made in one browser reaches another browser over Redis
 * Streams and SSE, with no reload and no polling. That is the assertion this spec exists for.
 */
test("a commissioner creates a league, a second manager joins it, and a pick reaches them live", async ({
  managerA,
  managerB,
}) => {
  const leagueName = `E2E League ${Date.now()}`;

  // --- Create, accepting every default except the size ------------------------------------
  await managerA.goto("/app");
  await expect(managerA.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  await managerA.getByLabel("League name").fill(leagueName);
  await managerA.getByText(/Advanced settings/).click();
  await managerA.getByLabel("Teams").selectOption("4");
  await managerA.getByRole("button", { name: "Create league" }).click();

  await expect(managerA.getByRole("heading", { name: leagueName })).toBeVisible();
  const leagueId = new URL(managerA.url()).pathname.split("/").pop()!;
  expect(leagueId).toBeTruthy();
  await expect(managerA.getByText("1 of 4 managers")).toBeVisible();

  // --- Invite ------------------------------------------------------------------------------
  await managerA.getByRole("button", { name: "Create invite link" }).click();
  const invitePath = await managerA.getByLabel("Invite link").inputValue();
  expect(invitePath).toMatch(/^\/app\/join\//);

  // --- Join, as a genuinely different person ----------------------------------------------
  await managerB.goto(invitePath);
  await managerB.getByRole("button", { name: "Join this league" }).click();
  await expect(managerB.getByRole("heading", { name: leagueName })).toBeVisible();

  await managerA.reload();
  await expect(managerA.getByText("2 of 4 managers")).toBeVisible();

  // --- Open the draft ----------------------------------------------------------------------
  // No UI starts a draft yet (see the plan's open questions), so this drives the REAL
  // commissioner-only route with the REAL session cookie the context already carries. It is
  // the same HTTP request a future button will make, not a test-only door.
  await managerA.goto(`/app/leagues/${leagueId}`);
  const draftHref = await managerA.getByRole("link", { name: "Open the draft room" }).getAttribute("href");
  const draftId = draftHref!.split("/").pop()!;
  const started = await managerA.request.post(`/api/drafts/${draftId}/start`);
  expect(started.ok()).toBe(true);

  // --- Both managers watch the same board -------------------------------------------------
  await managerA.goto(`/app/drafts/${draftId}`);
  await managerB.goto(`/app/drafts/${draftId}`);
  await expect(managerA.getByLabel("Player pool")).toBeVisible();
  await expect(managerB.getByLabel("Player pool")).toBeVisible();

  // Whoever is on the clock drafts the top available player. The pick button only exists on
  // the page whose turn it is, which is itself the assertion that the room knows whose turn
  // it is.
  const picker = (await managerA.getByRole("button", { name: "Draft" }).count()) > 0 ? managerA : managerB;
  const watcher = picker === managerA ? managerB : managerA;
  const pickedName = await picker
    .getByRole("listitem")
    .filter({ has: picker.getByRole("button", { name: "Draft" }) })
    .first()
    .locator("span.font-display")
    .innerText();
  await picker.getByRole("button", { name: "Draft" }).first().click();

  // THE assertion: the other browser learns about the pick with no reload and no polling.
  await expect(watcher.getByText(pickedName, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  // --- And so does a chat message ----------------------------------------------------------
  const shout = `Nice pick ${Date.now()}`;
  await watcher.getByLabel("Message").fill(shout);
  await watcher.getByLabel("Message").press("Enter");
  await expect(picker.getByText(shout)).toBeVisible({ timeout: 20_000 });
});
```

- [ ] **Step 9: Write `e2e/season.spec.ts`**

```ts
import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

/**
 * The season half, against the seeded league `global-setup` handed manager A the
 * commissioner's chair in: set a lineup, score a week, read the standings, ask the advisor,
 * and browse. Every one of these has unit and route coverage already — what a browser adds is
 * that the page actually renders them, in the real production build, with real data.
 */
test("a manager sets a lineup, scores a week, and reads the standings that follow", async ({ managerA }) => {
  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByRole("heading", { level: 1 })).toBeVisible();

  // Standings render with real, already-played results.
  await expect(managerA.getByRole("table")).toBeVisible();

  // The lineup editor saves. The seeded season is fully scored, so the current week may be
  // locked; both outcomes are correct and the editor must say which plainly rather than
  // failing silently.
  const save = managerA.getByRole("button", { name: /Save lineup/i });
  if ((await save.count()) > 0) {
    await save.first().click();
    await expect(managerA.getByRole("status").or(managerA.getByRole("alert")).first()).toBeVisible();
  }

  // The commissioner can score the current week, and the page reflects it.
  const score = managerA.getByRole("button", { name: /^Score Week/ });
  await expect(score).toBeVisible();
  await score.click();
  await expect(managerA.getByRole("status").filter({ hasText: /Scored \d+ matchups\./ })).toBeVisible();
});

test("the advisor answers from this league's own numbers, with or without a model key", async ({ managerA }) => {
  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await managerA.getByLabel("Ask about your lineup").fill("Who should I start at flex?");
  await managerA.getByRole("button", { name: /Ask|Get advice/i }).first().click();
  // With no ANTHROPIC_API_KEY the advisor answers from the app's own math and labels itself.
  // Either way it answers: a missing key is a designed state, not an error.
  await expect(managerA.getByLabel("Lineup advisor")).toContainText(/\w{20,}/, { timeout: 30_000 });
});

test("a signed-in manager can browse open leagues and join one", async ({ managerB }) => {
  await managerB.goto("/browse");
  await expect(managerB.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  await expect(managerB.getByText(/of \d+ joined/).first()).toBeVisible();
  await expect(managerB.getByText("No money changes hands.")).toBeVisible();

  // Filtering narrows, and the URL carries it.
  await managerB.getByLabel("Draft format").selectOption("auction");
  await managerB.getByRole("button", { name: "Show leagues" }).click();
  await expect(managerB).toHaveURL(/format=auction/);
  await expect(managerB.getByText("Rookie Snake Room")).toHaveCount(0);

  await managerB.getByRole("button", { name: /^Join / }).first().click();
  await expect(managerB).toHaveURL(/\/app\/leagues\//);
  await expect(managerB.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a signed-OUT visitor can browse but is asked to sign in before joining", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to join" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(0);
  await context.close();
});
```

- [ ] **Step 10: Run the suite against the real stack**

Run:

```bash
npm run infra:up
npm run db:migrate
npm run build
npm run e2e
```

Expected: all specs pass. If `Refusing to run: WORKOS_API_KEY is not a test key` appears, that is the guard working — point `.env.local` at a WorkOS test key before continuing. Iterate on selectors against the real DOM until green; the assertions above are the contract, the selectors are not.

- [ ] **Step 11: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean. `tsconfig.json`'s `include` covers `**/*.ts`, so `playwright.config.ts` and everything under `e2e/` are type-checked with the rest of the repo; that is deliberate.

```bash
git add package.json package-lock.json playwright.config.ts e2e scripts/lib/lab-session.ts scripts/mint-dev-session.ts vitest.config.mts .gitignore
git commit -m "test(e2e): Playwright against the real stack, through the real session seam

Authentication is a sealed WorkOS test-directory session, the same seam the browser lab
already uses, so the suite exercises the real middleware, callback and getCurrentUser path.
No dev auth bypass exists and none is added. The lifecycle spec deliberately stops short of a
full draft: what only a browser can prove is that a pick made in one context reaches another
over Redis Streams and SSE with no reload, and that is what it asserts. Vitest now excludes
e2e/ so its default **/*.spec.ts glob does not collect Playwright specs."
```

---

## Task 9: CI, docs, and the closing verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/conventions.md`
- Modify: `docs/league.md`

**Interfaces:**
- Consumes: everything Tasks 1-8 produced.
- Produces: a CI `e2e` job that runs when WorkOS test credentials are configured as repository secrets and **skips loudly** when they are not; documentation that matches the code.

- [ ] **Step 1: Add the e2e job to CI**

Append to `.github/workflows/ci.yml`, after the existing `build-and-test` job:

```yaml
  # The browser end-to-end suite. It needs a WorkOS TEST directory (it creates and authenticates
  # real test users), which is a repository secret rather than something a fork or a first-time
  # clone has. When the secret is absent this job runs, says so loudly in the run summary and in
  # a PR annotation, and stops. It never fakes a pass by skipping assertions, and it never fails
  # a contributor's PR for lacking a credential they cannot be given.
  e2e:
    name: End-to-end (needs WorkOS test credentials)
    runs-on: ubuntu-latest
    needs: build-and-test
    steps:
      - uses: actions/checkout@v4

      - name: Check for WorkOS test credentials
        id: creds
        env:
          E2E_API_KEY: ${{ secrets.WORKOS_TEST_API_KEY }}
          E2E_CLIENT_ID: ${{ secrets.WORKOS_TEST_CLIENT_ID }}
        run: |
          if [ -n "$E2E_API_KEY" ] && [ -n "$E2E_CLIENT_ID" ]; then
            echo "have=true" >> "$GITHUB_OUTPUT"
          else
            echo "have=false" >> "$GITHUB_OUTPUT"
            echo "::warning title=E2E skipped::WORKOS_TEST_API_KEY / WORKOS_TEST_CLIENT_ID are not configured, so the browser end-to-end suite did not run. Nothing was checked by this job."
            {
              echo "## End-to-end suite SKIPPED"
              echo ""
              echo "\`WORKOS_TEST_API_KEY\` and \`WORKOS_TEST_CLIENT_ID\` are not configured as repository secrets."
              echo "The e2e suite authenticates by minting a real WorkOS **test-directory** session"
              echo "(\`scripts/lib/lab-session.ts\`); there is no dev auth bypass to fall back on, by design."
              echo ""
              echo "**Nothing was checked by this job.** Configure the two secrets to enable it."
            } >> "$GITHUB_STEP_SUMMARY"
          fi

      - uses: actions/setup-node@v4
        if: steps.creds.outputs.have == 'true'
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        if: steps.creds.outputs.have == 'true'
        run: npm ci

      - name: Install the Playwright browser
        if: steps.creds.outputs.have == 'true'
        run: npm run e2e:install

      - name: Start local infra (Postgres x2, Redis)
        if: steps.creds.outputs.have == 'true'
        run: npm run infra:up

      # The same file the build-and-test job writes, with the placeholder WorkOS values replaced
      # by the real test-directory secrets. The e2e suite is the one thing in this repo that
      # actually calls WorkOS.
      - name: Write .env.local
        if: steps.creds.outputs.have == 'true'
        env:
          E2E_API_KEY: ${{ secrets.WORKOS_TEST_API_KEY }}
          E2E_CLIENT_ID: ${{ secrets.WORKOS_TEST_CLIENT_ID }}
          E2E_COOKIE_PASSWORD: ${{ secrets.WORKOS_TEST_COOKIE_PASSWORD }}
        run: |
          cat > .env.local <<EOF
          DATABASE_URL=postgres://commish:commish@localhost:5432/commish
          REDIS_URL=redis://localhost:6379
          TEST_DATABASE_URL=postgres://commish:commish@localhost:5433/commish_test
          WORKOS_CLIENT_ID=${E2E_CLIENT_ID}
          WORKOS_API_KEY=${E2E_API_KEY}
          WORKOS_COOKIE_PASSWORD=${E2E_COOKIE_PASSWORD:-ci_placeholder_password_at_least_32_characters_long}
          NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
          ALLOW_DESTRUCTIVE_SEED=1
          DEV_SEED_CLAIM_USER_ID=
          ANTHROPIC_API_KEY=
          EOF

      - name: Migrate the primary database
        if: steps.creds.outputs.have == 'true'
        run: npm run db:migrate

      - name: Build
        if: steps.creds.outputs.have == 'true'
        run: npm run build

      - name: End-to-end
        if: steps.creds.outputs.have == 'true'
        run: npm run e2e

      - name: Upload the Playwright report
        if: always() && steps.creds.outputs.have == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      - name: Stop local infra
        if: always() && steps.creds.outputs.have == 'true'
        run: npm run infra:down
```

- [ ] **Step 2: Document the new env expectations**

Append to `.env.example`, under the existing lab-script block:

```
# The browser end-to-end suite (playwright.config.ts, e2e/) authenticates by minting a real
# WorkOS TEST-directory session from the three WORKOS_* values above, and refuses to run
# against anything but an "sk_test_" API key. In CI those come from the WORKOS_TEST_API_KEY /
# WORKOS_TEST_CLIENT_ID / WORKOS_TEST_COOKIE_PASSWORD repository secrets, and the e2e job stops
# with a visible warning when they are absent. There is no dev auth bypass to fall back on.
E2E_BASE_URL=http://localhost:3000
```

- [ ] **Step 3: Document the commands**

In `README.md`, add to the command block:

```bash
npm run e2e:install       # one-time: download the Playwright browser
npm run e2e               # browser end-to-end suite (needs a build + a WorkOS test key)
```

and add this paragraph after the seeding paragraph:

```markdown
`npm run e2e` runs the Playwright suite in `e2e/` against a production build (`npm run build`
first) and the docker-compose Postgres/Redis. It authenticates by minting a real WorkOS
**test-directory** session and sealing it into the same `wos-session` cookie the app reads, so
it exercises the real middleware, the real callback and the real `getCurrentUser()` path.
There is deliberately no dev auth bypass: without an `sk_test_`-prefixed `WORKOS_API_KEY` the
suite refuses to start and names the variable that is missing. In CI the same suite runs in a
separate `e2e` job that stops with a visible warning when the repository has no WorkOS test
secrets, rather than passing without having checked anything.
```

- [ ] **Step 4: Document the new directories in `docs/conventions.md`**

In the directory map, add after the `league-room/` block:

```
  matchmaking/            Pure public-matchmaking rules: the browse filter, the cosmetic stake
                          tiers, and PublicLeagueSummary, the field-by-field privacy boundary of
                          the app's ONE unauthenticated league read. NO I/O. 100% coverage.
                          Browser-safe, so src/league-room/** value-imports it directly, the
                          same way src/chat-room/** value-imports @/chat.
  integration/            Cross-module proofs: a real draft, run through the real store, into
                          real standings, chat, advisor and browse reads. Test-only.
```

and after the `docs/` line:

```
e2e/                      Playwright specs plus the sealed-session global setup (see README).
```

In the "Tests" section, extend the coverage line to name the new gate:

> Coverage threshold: 100% for `src/scoring/**`, `src/draft-engine/**`, `src/draft-room/state/**`, `src/league/**`, `src/chat/**` and `src/matchmaking/**`

and add a bullet:

> - **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). It authenticates with a sealed WorkOS test-directory session (`scripts/lib/lab-session.ts`), the same seam the screenshot lab uses. There is no dev auth bypass and none may be added. Vitest excludes `e2e/**`, because its default include glob would otherwise collect `*.spec.ts` there.

In the "Client boundary" section, add after the `src/chat/**` paragraph:

> `src/matchmaking/**` is exempt for the same reason as `src/chat/**`: it is pure, I/O-free, browser-safe rule code (`normalizeBrowseFilter`, `matchesBrowseFilter`, `stakeTierLabel`, `MATCHMAKING_CONFIG`), so `src/league-room/**` value-imports it directly. Its Postgres half lives in `src/league-service/browse.ts`, which the existing `@/league-service` ban already covers. There is no `@/matchmaking-service`, because a second service directory for one query would be a boundary to maintain rather than a boundary to enforce.

- [ ] **Step 5: Document matchmaking in `docs/league.md`**

Add a section before "Known follow-ups":

```markdown
## Public matchmaking

Two ways into a league, one core. An **invite** is the private path (`acceptInvite`); **public
browse** is the open one (`joinPublicLeague`). Both call `joinLeagueInTx`
(`src/league-service/join.ts`), which takes the league row `FOR UPDATE` before counting teams
and inserts inside the caller's transaction. Two independently-written capacity checks are two
places the same league's fill count can disagree, and the disagreement only ever shows up as a
13th team in a 12-team league. Each path's own rules (an invite's expiry and use cap; a public
league's listing and draft status) run through a `JoinPrecondition` hook that fires only for a
caller who is **not** already a member, which is what keeps re-arriving free on both paths.

**The privacy boundary.** `GET /api/public/leagues` is the one unauthenticated read in this
application. What a stranger may learn is `PublicLeagueSummary` (`src/matchmaking/contract.ts`)
and nothing else: id, name, format, experience tier, stake tier, team count, filled count. No
commissioner identity, no team or owner names, no invite code, no draft id, no standings, no
rosters, no chat, no scoring settings. Three things enforce it: `is_public_matchmade` is opt-in
and false by default, `listPublicLeagues` selects exactly the contract's columns, and a key-set
test fails if the wire body ever grows a field the contract does not name. A league that is
full, or whose draft has already started, is not listed at all: a card a visitor cannot act on
is a dead end wearing a badge.

**Filtering** is `User.experienceTier`, `League.format` and `League.stakeTier`, normalized by
`normalizeBrowseFilter`, the pure function that turns a query string into a `BrowseFilter`.
Unknown values (`?format=dynasty`) normalize to "any" rather than erroring, because browse is
reached by hand-edited URLs and stale bookmarks and the honest answer is the list we can offer.
Only `'snake' | 'auction'` are offered, because those are the two formats the draft engine
runs. `leagues.experience_tier` is a **league-level** column rather than a read of the
commissioner's own profile: deriving it from a person would leak that person into an
unauthenticated read and would silently re-tier every league they run whenever they edited
their profile.

**Stake tier is cosmetic.** No entry fee is charged, no prize is paid and no balance exists
anywhere in Phase 1. `MATCHMAKING_CONFIG.stakeDisclosure` is the one wording of that promise,
rendered on the create form beside the tier control and on the browse page beside the cards.
Real money arrives in a later phase behind FBO/agent-of-payee handling, KYC/AML screening and
tax reporting.
```

Then update "Known follow-ups": delete the "A browser end-to-end pass over the league flows"
bullet (it is now `e2e/`) and replace it with:

```markdown
- **No UI starts a draft.** `POST /api/drafts/[draftId]/start` exists and is commissioner-gated,
  but nothing in the draft room calls it. The seeded dev drafts are driven by
  `scripts/drive-dev-draft.ts`, and `e2e/league-lifecycle.spec.ts` posts the route directly with
  its real session. A commissioner using the product has no button. That is a real gap, not a
  test-harness convenience, and it belongs in the next phase's scope.
```

and add these rows to the route table:

```markdown
| `GET /api/public/leagues` | **anyone, signed in or not** | `?format=&experienceTier=&stakeTier=`. Open, publicly listed, pre-draft leagues only, projected to `PublicLeagueSummary`. The one unauthenticated read in the app. |
| `POST /api/public/leagues/[leagueId]/join` | any signed-in user | Seats the caller in an open public league. 403 if the league is not listed, 409 if its draft started or it is full. Re-joining is a 200. |
```

- [ ] **Step 6: Run the full verification gate**

Run:

```bash
npm run typecheck && npm run lint && npm test && npm run test:coverage && npm run build
```

Expected: all clean, with `src/matchmaking` at 100% in the unfiltered coverage report.

- [ ] **Step 7: Run the browser suite one final time end to end**

Run:

```bash
npm run infra:up
npm run db:migrate
npm run e2e
```

Expected: every spec passes against the freshly built app. Confirm the run seeded from scratch
(the global setup's seed output appears in the log) rather than depending on a database you had
already warmed by hand.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/ci.yml .env.example README.md docs/conventions.md docs/league.md
git commit -m "docs+ci: an e2e job that stops loudly, and docs that match the code

The e2e job needs a WorkOS test directory, which a fork cannot be given. Rather than failing
every contributor's PR or quietly passing, it annotates the PR and writes a run summary saying
in as many words that nothing was checked. docs/league.md gains the matchmaking section: one
locked join core behind two doors, the field-by-field privacy boundary of the app's only
unauthenticated read, and the cosmetic-stake-tier promise. The 'browser e2e pass' follow-up is
replaced by a real one: no UI starts a draft yet."
```

---

## Verification summary

Per the spec's own two verification blocks, plus the repo-wide gate:

```bash
npm test -- src/matchmaking        # Step 10's pure layer
npm test -- src/integration        # Step 11's headless proof
npm run e2e                        # Step 11's browser proof (needs a build + a WorkOS test key)
npm run typecheck && npm run lint && npm test && npm run test:coverage && npm run build
npm run dev                        # manual: filter, browse and join a mock public league
```

**Step 10 exit criteria:**
- Filtering by experience tier and format narrows the visible list: `src/matchmaking/filter.test.ts`, `src/league-service/browse.test.ts`, and the browse spec in `e2e/season.spec.ts`.
- Joining updates the fill count and adds the user's team, verified by a test that joins then re-queries fill state: `src/league-service/join.test.ts` (the idempotency and concurrency cases) plus `src/data/seed/seed-public-leagues.test.ts`'s open-seat case.

**Step 11 exit criteria:**
- One suite run proves draft to commit to standings/matchup, for both snake and auction, with no manual steps: `src/integration/draft-to-season.test.ts` (`describe.each`).
- Every feature built on seeded fixtures is exercised at least once against real draft output: `src/integration/features-against-real-draft.test.ts`.

---

## Self-review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| Step 10: filter UI over `User.experienceTier`, `League.format` (snake/auction only), `League.stakeTier` | 1 (rules), 6 (`BrowseFilters`) |
| Step 10: matching open-leagues list with transparent fill status | 3 (read), 6 (`PublicLeagueList`, "8 of 12 joined") |
| Step 10: join flow landing in the league's dashboard | 4 (service + route), 6 (`JoinPublicLeagueButton` routes to `/app/leagues/<id>`) |
| Step 10: join is `getCurrentUser()`-derived | 4 (`withCurrentUser`; no body field names a user) |
| Step 10: seed several mock public leagues at different fill levels, formats, tiers | 5 |
| Step 10: stake tier is cosmetic, no real money | 1 (`stakeDisclosure`), 2 (form), 6 (page), 9 (docs) |
| Step 11: automated snake draft to `commitDraftResults` to standings/matchup, rosters match | 7 |
| Step 11: repeat for auction | 7 (`describe.each`) |
| Step 11: one smoke assertion each for Steps 6, 8, 9, 10 against real draft output | 7 (moderator claim, chat, advisor, browse/join) |
| Controller: Playwright against the real stack, two contexts, realtime fan-out | 8 |
| Controller: `playwright.config.ts` + `e2e/` in the repo, CI job, honest skip | 8, 9 |
| Controller: sealed-cookie auth seam, no dev bypass | 8 (`scripts/lib/lab-session.ts`, shared with the mint script) |
| Controller: privacy boundary designed explicitly | 1 (`PublicLeagueSummary` doc), 3 (`PUBLIC_LEAGUE_FIELDS` + key-set test), 9 (docs) |
| Controller: coverage-gate decision stated | 1 Step 7 (matchmaking joins); Task 7 Step 8 (`src/integration` explicitly does not) |
| Controller: `inBothThemes` + axe on every new client component | 6 (all three) |
| Controller: persona-panel steps | 2 Step 13, 6 Step 11 |
| Controller: no em-dashes in user-facing copy | asserted in Task 1 Step 1 and Task 5 Step 1; enforced by review elsewhere |
| Controller: docs + verification task | 9 |

No gaps found.

**2. Placeholder scan.** No "TBD", no "implement later", no "similar to Task N", no "add error
handling" without the handler. Two deliberate hedges are called out inline rather than left
implicit: the dynamic `import(...)` lines in Task 7 are marked "replace with a top-level import
when writing the file", and Task 8 Step 10 states that the assertions are the contract while
the selectors are to be iterated against the real DOM. Both are honest about what a browser
test can and cannot be pinned down to in advance.

**3. Type consistency.** Checked across tasks:

- `PublicLeagueSummary` is defined in Task 1, produced by Task 3, consumed by Tasks 5, 6 and 7. The same seven fields everywhere, and `PUBLIC_LEAGUE_FIELDS` is asserted against `Object.keys` rather than being a second hand-maintained list.
- `BrowseFilter` / `normalizeBrowseFilter` / `EMPTY_BROWSE_FILTER` keep one spelling across Tasks 1, 3, 5 and 6.
- `JoinLeagueOutcome` is Task 4's single return union, aliased (not re-declared) as `AcceptInviteResult`, and mapped onto the existing `JoinBody` wire type by the route, so Task 6's join button reads the same shape `JoinForm` already does.
- `joinLeagueInTx` / `JoinPrecondition`: one signature, two callers.
- `CreateLeagueInput` gains three required fields in Task 2, and every existing caller (`creation.test.ts`, and `test-support.ts`'s `twoTeamLeague` and `advisorFixture`) is named as needing the update in the same step.
- `SESSION_COOKIE_NAME` is defined once in `scripts/lib/lab-session.ts` and used by both the mint script and `e2e/global-setup.ts`.
- `MATCHMAKING_CONFIG.stakeDisclosure` is one string, asserted in the Task 2 form test, the Task 6 list test, and the Task 8 browse spec.

---

## Open questions, self-ruled

1. **Where does the league-level experience tier come from: a new column, or the commissioner's profile?**
   **Ruling: a new `leagues.experience_tier` column**, defaulted from the creator's own tier at the route. Deriving it from `users.experience_tier` would put a person inside an unauthenticated read and would silently re-tier every league someone runs the moment they edited their profile. The column is a one-line migration carrying a DEFAULT, which the migration rule allows on a populated table.

2. **Does the pure matchmaking layer join the 100% coverage gate?**
   **Ruling: yes.** `src/matchmaking/**` is pure, I/O-free rule code of exactly the same kind as `src/league/**` and `src/chat/**`, and it is the code that decides what an unauthenticated stranger is allowed to see. `src/integration/**` explicitly does **not** join: it holds no rules of its own, and gating a test-support module at 100% measures nothing.

3. **Why is there no `src/matchmaking-service/` to mirror `league-service` / `chat-service`?**
   **Ruling: one query does not earn a directory.** `listPublicLeagues` is a league read, so it lives in `src/league-service/browse.ts`, which the existing `@/league-service` client-boundary ban already covers. A new service directory would need adding to `SERVER_ONLY_MODULE_GROUPS` and would be a boundary to maintain rather than one to enforce.

4. **Should browse live at `/browse` or `/app/browse`?**
   **Ruling: `/browse`.** Middleware redirects everything under `/app` to hosted sign-in, and the whole point of this surface is that a stranger can see what is on offer before creating an account. `/app/leagues` already redirects to `/app`, so there is no route collision and no second league-list page.

5. **Should the filter form be a client component?**
   **Ruling: no, a plain GET form.** The URL becomes the filter state, so a filtered browse is linkable, bookmarkable and reload-stable, and the one page a visitor with no account ever sees works before any JavaScript does. The only client component on the page is the join button, which genuinely needs state.

6. **Is the public join route allowed to bypass `withLeagueMemberActor`?**
   **Ruling: yes, and it must.** That helper's entire job is rejecting a signed-in stranger with no team, which is exactly who this route serves. The rules that do apply (listed, pre-draft, not full) live in `joinPublicLeague` beside the lock that makes them true under concurrency, not in a route wrapper.

7. **Is refactoring `acceptInvite` worth the risk mid-plan?**
   **Ruling: yes.** Two hand-written capacity checks are two places a league's fill count can disagree, and the disagreement surfaces as an over-seated league rather than as a test failure. The safeguard is that `invites.test.ts` and `league-routes.test.ts` must pass **with no edits** after the refactor (Task 4, Step 6): the existing expiry, use-cap, capacity, idempotent-re-accept and unique-index cases are the regression suite.

8. **How much draft does the browser e2e actually run?**
   **Ruling: one pick, deliberately.** A full sixteen-round draft on a real clock is minutes of wall time and proves nothing `src/integration/**` has not already proved deterministically for both formats. What only a browser can prove is that a pick made in one context reaches another over Redis Streams and SSE with no reload, so that is what the spec asserts, plus the same proof for a chat message.

9. **How does the e2e start a draft, given that no UI does?**
   **Ruling: `page.request.post('/api/drafts/<id>/start')` from the authenticated context.** That is the real commissioner-gated route with the real session cookie, the same HTTP request a future button will make, not a test-only door. The missing button is recorded as a real product gap in `docs/league.md`'s follow-ups (Task 9, Step 5) rather than quietly worked around.

10. **What does CI do without WorkOS secrets?**
    **Ruling: run the job, annotate the PR with a `::warning::`, write "Nothing was checked by this job" into the run summary, and stop.** A hard failure would block every fork PR over a credential contributors cannot be given; a silent skip would look like a pass. This is the loudest option that does not punish the wrong person. `build-and-test` is unchanged and still gates every PR.

11. **Does browse need a `matchmaking.md` doc of its own?**
    **Ruling: no.** It is one section in `docs/league.md`, beside invites, because it is the second door into the same object. A separate doc would split the two membership paths across two files, which is exactly the drift `joinLeagueInTx` exists to prevent.
