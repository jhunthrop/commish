import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "@typescript-eslint/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import functional from "eslint-plugin-functional";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Server-only modules the draft room's and the league room's client code must never import as
 * VALUES: the reducers/selectors, the league rules, the Postgres/Redis-backed store, the db
 * schema, the realtime transport internals, the WorkOS identity seam, the league
 * auth+membership seam, the destructive dev seeders, the LLM client, and the API envelope
 * module (which value-imports `NextResponse`) all live behind the API routes and the SSE
 * route, not in the browser bundle. `import type` stays allowed — sharing a TYPE (e.g.
 * `DraftStateView`, `LeagueSummary`, `ApiEnvelope`) costs nothing at runtime and is how the
 * client and server sides of the wire stay in sync; several client files already
 * `import type { ApiEnvelope } from "@/lib/api/respond"` and must keep working.
 *
 * `@/event-stream` is deliberately NOT on this list and must not be added to it: it is browser
 * code (one shared `EventSource` per league stream url, constructed lazily), it is what both
 * rooms' `deps.tsx` factories value-import, and nothing server-side imports it. That is also
 * why it is a top-level sibling rather than a child of `@/lib/realtime` — `aliasOrRelative`
 * below would match any `@/lib/realtime-…` or `@/lib/realtime/…` spelling and ban it.
 *
 * Only the bare module name is listed here — `aliasOrRelative` below turns each one into a
 * single `regex` pattern that matches BOTH the `@/` alias (`@/db`, `@/db/client`, any subpath)
 * AND the equivalent relative-path spelling (`../db`, `../../db/client`, …), which a plain
 * `group` glob list would not: every `group` entry here used to be anchored on `@/`, so
 * `import { x } from "../../draft-engine"` produced zero diagnostics — a real bypass, not a
 * gap anyone would need to reach for on purpose, but nothing stopped it either.
 */
const SERVER_ONLY_MODULE_GROUPS = [
  "@/draft-engine",
  "@/draft-service",
  "@/league",
  "@/league-service",
  // Both are Postgres-backed (`chat-service/chat.ts`, `ai-advisor/context.ts`) and were the
  // one-hop way around the `@/db` ban: a client file importing `@/chat-service` was legal to
  // this rule, while the `@/db` import that makes it server-only sat in a file the glob below
  // does not cover. `aliasOrRelative` anchors on the full segment, so banning `@/chat-service`
  // cannot catch the PURE `@/chat` (contract, config, folds) that `src/chat-room/**`
  // legitimately value-imports.
  "@/chat-service",
  "@/ai-advisor",
  // Postgres-backed (`review-service/reviews.ts`). `@/reviews` (pure config/contract/validate,
  // no I/O) is the browser-safe half — see the `@/identity`/`@/chat`/`@/matchmaking`/`@/help`
  // note below — and stays off this list on purpose so `ReviewComposer`'s live character count
  // can value-import `validateReviewDraft` directly.
  "@/review-service",
  // Postgres-backed (`identity-service/profile.ts`, `preferences.ts`) — the same one-hop
  // shape as `@/chat-service`. The browser-safe pure half is `@/identity` (presets, refs,
  // first-run, notifications), which stays legitimately value-importable.
  "@/identity-service",
  "@/db",
  "@/lib/realtime",
  "@/lib/auth",
  "@/lib/leagues",
  "@/lib/llm",
  "@/lib/api/respond",
  "@/data/seed",
  // The stats ingestion worker, the finalize settlement write and the reference cache — all
  // Postgres/Redis-backed. `@/stats-pipeline/contract` is the one exception the client boundary
  // needs (Task 8's `useLiveScores` imports `ScoreUpdatePayload`/`TeamScore` from it), and
  // `import type` stays allowed for exactly that reason.
  "@/stats-pipeline",
  // The provider seam itself: `registry.ts` reads TANK01_API_KEY and `tank01/client.ts` holds it
  // and issues the upstream fetch, so `@/stats` is exactly as server-only as `@/stats-pipeline`
  // and was the one-hop way around its ban. `aliasOrRelative` anchors on the full segment, so
  // this cannot accidentally catch `@/stats-pipeline` (or any other `@/stats-…` sibling).
  "@/stats",
  // The GIF provider seam: `registry.ts` reads GIF_PROVIDER/GIPHY_API_KEY and `giphy/client.ts`
  // holds the key and issues the upstream fetch — exactly as server-only as `@/stats`, and for
  // the same one-hop-around-the-ban reason. `src/chat-room/components/gif-picker.tsx` reaches
  // `GifResult` as a TYPE ONLY (`import type`, still allowed below); the actual search goes
  // through `GET /api/gifs/search` over the wire, the same as every other client-room read.
  "@/gifs",
  // `@/integrity` reads `node:crypto` (chain.ts) and is imported by Postgres-backed callers;
  // `@/integrity-service` is Postgres-backed outright. Unlike `@/identity`, `@/chat`,
  // `@/matchmaking`, `@/help` and `@/reviews`, NEITHER half is browser-safe, so both are blocked
  // rather than one being exempt. Client code needs neither: a notice carries the copy it
  // delivered (ruling 12) and an activity row arrives already rendered, so the browser renders
  // strings the server decided. `import type` stays allowed, which is how `NoticeView` and
  // `ActivityRow` reach `src/account-room/**` and `src/league-room/**`.
  "@/integrity",
  "@/integrity-service",
  // Phase 4.5, Task 1: the mock draft vocabulary. Pure — no database, no clock, no I/O — but
  // blocked rather than exempt, beside `@/integrity` and for the same "neither half is actually
  // browser-safe" reasoning: `MOCK_CONFIG.strategy` is a bot's own playbook (temperature, reach
  // depth, run-reaction thresholds) and must not ship into the client bundle as inspectable
  // data, and `MOCK_COPY`'s room-facing sentences reach a mock room pre-rendered, the same
  // `NoticeView`/`ActivityRow` shape `@/integrity` already uses — never a live client-side
  // `import { MOCK_COPY }`. `src/mock-draft/config.ts`'s own docblock argues this in full.
  "@/mock-draft",
  // Phase 4.5, Task 5: the mock draft's Postgres half — the lifecycle writers (`createMockRoom`,
  // `claimMockSeat`, `topUpBots`, `startMockDraft`) and, in Task 6, the bot driver and the
  // retention sweep. This closes the "ONE boundary, not two" promise `src/mock-draft/config.ts`'s
  // own docblock made when the pure half joined this list: exactly as blocked as
  // `@/integrity-service` has always been. `aliasOrRelative` anchors on the full segment, so the
  // `@/mock-draft` entry above cannot catch this sibling on its own — both are named.
  "@/mock-draft-service",
  // Phase 4, Task 3: the money vocabulary's Postgres half — `postMoneyTransaction` (the ONE
  // writer of the money book of record), the wallet reads and, in later tasks, every other
  // money writer. Exactly the split promised when `@/money` joined the browser-safe exempt set
  // below: the wallet component value-imports `MONEY_CONFIG`/`formatUsd` from `@/money` and
  // reaches every FIGURE over the wire; nothing in the browser bundle may hold a handle to the
  // ledger itself. `import type` stays allowed, which is how `WalletSummary` reaches a client
  // component.
  "@/money-service",
  // Phase 4, Task 4: Seam A, the external-money seam. `registry.ts` reads PAYMENTS_PROVIDER,
  // `ingest.ts` holds the webhook-secret verification (`node:crypto`) — exactly as server-only
  // as `@/stats` and `@/gifs`, and the promised join from the `@/money` exemption note below.
  // `import type` stays allowed, which is how `MethodDescriptor` and `TransferStatus` reach the
  // wallet's client components; every FIGURE arrives over the wire.
  "@/payments-provider",
];

/**
 * NOT on the list above, deliberately: `@/identity` (`src/identity/**`) joins `@/chat`
 * (`src/chat/**`), `@/matchmaking` (`src/matchmaking/**`), `@/help` (`src/help/**`),
 * `@/reviews` (`src/reviews/**`), `@/moderation` (`src/moderation/**`), `@/trades`
 * (`src/trades/**`), `@/participation` (`src/participation/**`) and `@/money`
 * (`src/money/**`) in the browser-safe exempt set — pure, I/O-free code with no server module
 * behind it, so client code may value-import it directly. `@/trades` is new in Phase 3 Plan C. The
 * real browser VALUE-imports are `TRADE_CONFIG.maxAssetsPerSide` (`trade-composer.tsx`) and
 * `describeAsset`/`isExpired` (`trade-card.tsx`); `TradeProposalView` is an `interface`
 * (`src/trades/contract.ts`) and every consumer reaches it through `import type`, which needs no
 * exemption at all (final review, LOW 7 item 4 — this used to name it as the value-import).
 * `@/ai-advisor` — where
 * `tradeBalance` and its types used to live — stays on the BLOCKED list above precisely because
 * it is not browser-safe; the fairness core moved to this pure directory for that reason among
 * others (`src/trades/fairness.ts`'s own docblock).
 *
 * `@/participation` is new in Phase 3 Plan D — a THIRD meaning of "tier"
 * (`src/participation/tier.ts`'s own docblock), computed rather than self-reported, and pure for
 * the identical reason `@/trades` is: no database, no clock, no I/O, only the vocabulary and the
 * two pure predicates (`participationTierFor`, `isVerifiedPlayer`) that read it. Not `@/domain`:
 * that directory is under `eslint-plugin-functional`'s immutability rules and holds types the
 * whole product shares, while a participation tier's labels and thresholds are one feature's
 * vocabulary. Not `@/integrity`: that pair stays BLOCKED because neither half is browser-safe, and
 * `src/league-room/components/browse-card.tsx` needs `PARTICIPATION_TIER_LABEL` as a value the
 * same way `browse-filters.tsx` will need `TIER_COMPOSITION_LABEL`. The DB-reading half —
 * `completedSeasonsFor`, `participationFor`, `leagueTierComposition`, `stampSeasonCompleteInTx` —
 * lives in `@/league-service/participation`, which stays exactly as blocked as the rest of
 * `@/league-service` always has been.
 *
 * `@/money` is new in Phase 4, Task 1 — the ninth pure directory on this list, and for the same
 * reason as `@/trades`/`@/participation`: no database, no clock, no I/O, only the vocabulary
 * (`MONEY_CONFIG`, `MONEY_STATES`/`moneyIsLive`, the account/posting/prize-table shapes and
 * refusal reasons) a later task's wallet and entry-fee form value-import directly, so the fee
 * ceiling a member sees and the one the server enforces read the identical number. The Postgres
 * half (`src/money-service/**`, on the list above since Task 3 created it) and the
 * external-money seam (`src/payments-provider/**`, on the list above since Task 4 created it)
 * are NOT exempt — the same split every other exempt pure directory keeps from its own service
 * layer.
 *
 * `src/chat-room/**` reaches `parseAvatarRef` indirectly through
 * `Avatar` (`src/components/ui/avatar.tsx`) rather than importing `@/identity` itself, but the
 * omission here is what keeps that path legal. `@/help` is reached the same indirect way today —
 * every room directory renders `InfoTip` (`src/components/ui/info-tip.tsx`), which is the only
 * thing that value-imports `@/help/glossary` — but the omission is what would keep a future
 * direct `GLOSSARY` lookup from a room component legal too, exactly like the other four.
 * `@/reviews` IS reached directly: `ReviewComposer` (`src/account-room/components/
 * review-composer.tsx`) value-imports `validateReviewDraft` for its live character count, the
 * same rule `submitReviewSchema` (`@/review-service/schemas`) enforces server-side. `@/moderation`
 * is reached directly too: `ReviewComposer` and `ReviewFeed`'s report dialog read
 * `REVIEW_CONFIG.reportReasons` (`@/reviews/config`'s own re-export of `MODERATION_CONFIG.reasons`
 * — ruling 21), and Task 6's chat report dialog (`src/chat-room/**`) needs the same labels as
 * values directly from `@/moderation`. `@/integrity`/`@/integrity-service` are on the BLOCKED list
 * above precisely because neither half of that pair is browser-safe the way `@/moderation` is —
 * two directories, two boundaries. See docs/conventions.md's directory map for the same note on
 * `@/chat` and `@/matchmaking`.
 */

/**
 * One regex per module matching either spelling: `@/<module>` (optionally with a subpath) or
 * any number of leading `../`/`./` segments followed by `<module>` (optionally with a
 * subpath). A single regex per module rather than a `group` glob PLUS a `/*` sibling for deep
 * imports: `no-restricted-imports`'s `group` patterns already match with `ignore`'s gitignore
 * semantics, under which a bare `"@/db"` matches `"@/db/client"` on its own — a `/*` sibling
 * entry added no coverage there, only a second, duplicate error for the same import (verified
 * empirically before this rewrote the whole list as regexes instead).
 */
function aliasOrRelative(moduleWithAlias) {
  const bareName = moduleWithAlias.replace(/^@\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^(?:@/|(?:\\.\\.?/)+)${bareName}(?:/|$)`;
}

/**
 * Source code may never import upward out of the source root. `scripts/**` and `e2e/**` are
 * build/verification tooling: they are allowed to import `src/**` (and do, via `@/`), but the
 * reverse makes a production module depend on something no bundler, no `next build` and no
 * deployment artifact is guaranteed to carry. `src/data/seed/index.ts` did exactly this with
 * `../../../scripts/lib/env` until Phase 2 Plan A moved that helper to `src/lib/env.ts`; this
 * rule is what stops the next one. There is no `@/` spelling to ban because the alias only maps
 * into `src`, so a relative escape is the only reachable form.
 *
 * Shared (not inlined into a single config block) because it must be spliced into TWO
 * `@typescript-eslint/no-restricted-imports` invocations below — see the comments on those
 * blocks for why a same-glob, same-rule third block would silently replace one of them instead
 * of adding to it.
 */
/**
 * The browser-safe exempt set (see the note above `SERVER_ONLY_MODULE_GROUPS`): pure, I/O-free
 * directories that client room code is allowed to value-import. Named once here because they now
 * carry a boundary rule of their own, below.
 */
const BROWSER_SAFE_MODULE_DIRS = [
  "src/matchmaking/**/*.{ts,tsx}",
  "src/chat/**/*.{ts,tsx}",
  "src/identity/**/*.{ts,tsx}",
  "src/help/**/*.{ts,tsx}",
  "src/reviews/**/*.{ts,tsx}",
  "src/moderation/**/*.{ts,tsx}",
  "src/trades/**/*.{ts,tsx}",
  "src/participation/**/*.{ts,tsx}",
  // Phase 4, Task 1. `src/money` (MONEY_CONFIG, MONEY_STATES, the account/posting/prize-table
  // vocabulary) is pure, I/O-free, no clock — the ninth directory on this list, for the same
  // reason `src/matchmaking` is: the wallet and the creation form value-import it directly so
  // the number a member sees and the number the server enforces can never be two different
  // numbers.
  "src/money/**/*.{ts,tsx}",
];

/**
 * A BARREL IS NOT A MODULE (final whole-branch review, F7). `@/league` is on the blocked list
 * above for client ROOM code, but the browser-safe directories in `BROWSER_SAFE_MODULE_DIRS` are
 * reached from the browser too — a room component may value-import them — and one of them
 * (`src/matchmaking/house-catalog.ts`) value-imported `@/league` for a single frozen config
 * object. `src/league/index.ts` re-exports the schedule generator, the standings and clinch math,
 * the median folds, the lineup rules and the invite-code generator, so all of it followed into the
 * client bundle.
 *
 * This bans the BARREL SPELLING ONLY: the regex is anchored with `$`, so `@/league/config` (the
 * pure data module that import actually wanted) stays legal while `@/league` and `../league` do
 * not. `allowTypeImports` is true because a type import erases and costs the bundle nothing —
 * the same allowance every other boundary pattern in this file grants.
 */
const BROWSER_SAFE_BARREL_PATTERNS = [
  {
    regex: "^(?:@/|(?:\\.\\.?/)+)league$",
    allowTypeImports: true,
    message: "A browser-safe module must import the specific @/league submodule it needs (e.g. @/league/config), never the @/league barrel, which pulls the whole league rules engine into the client bundle. `import type` is fine.",
  },
];

const SRC_ROOT_ESCAPE_PATTERNS = [
  {
    regex: "^(?:\\.\\.?/)+scripts(?:/|$)",
    allowTypeImports: false,
    message: "src/** must not import scripts/**. Build tooling may depend on source; source may not depend on build tooling. Move the shared helper into src/lib/.",
  },
  {
    regex: "^(?:\\.\\.?/)+e2e(?:/|$)",
    allowTypeImports: false,
    message: "src/** must not import e2e/**. The browser suite depends on the app; the app must never depend on its test harness.",
  },
];

/**
 * THE REGISTER QUARANTINE (data-year Task 1, fix round 1) — the linter half of THE WALL.
 *
 * The prospective register (`src/projections/register`) is a ONE-WAY VALVE. It reads the engine —
 * the served board, the published benchmarks, the props archive, the weekly stat lines — and
 * nothing reads it back. The moment a fit, a law measurement or a pricing blend could see a frozen
 * row, this season's own prospective record would become an input to the thing it exists to judge,
 * and every number the register later reported would be a measurement of a model that had already
 * been shown the answer.
 *
 * `src/projections/register/wall.source.test.ts` sweeps the tree for the same breach and is the
 * primary guard. This is the BACKSTOP, and it earns its place by firing at a different moment: in
 * the editor, on the line, as somebody types the import — rather than when the suite next runs.
 * The two are deliberately kept in agreement about what a breach is, and that test asserts this
 * block still exists so a config refactor cannot quietly delete a layer.
 *
 * FOUR SYNTAXES, because the first version of the sweep matched only `from "..."` and a review found
 * two ways past it. A static import and a re-export both carry a `source`; a dynamic `import()` is an
 * `ImportExpression`; a `require()` is a plain `CallExpression`. All four are named below.
 *
 * `no-restricted-syntax` RATHER THAN `no-restricted-imports`, and the choice is load-bearing rather
 * than stylistic. Flat config merges same-named rules by SHALLOW OVERWRITE (see the client-boundary
 * blocks at the foot of this file, which pay for that behaviour by merging their patterns into one
 * invocation). A new `@typescript-eslint/no-restricted-imports` block scoped to `src/**` would
 * silently REPLACE the boundary patterns for every file it also matched, trading one guard for
 * another. `no-restricted-syntax` is used nowhere else in this config, so this block owns it
 * outright and can be scoped freely — and it is the only one of the two rules that can see a
 * dynamic import or a `require` in the first place.
 *
 * THE PATTERN matches the alias form (`@/projections/register/...`) and any relative path whose
 * final segments enter the directory (`./register/...`, `../register/...`, `../../projections/
 * register/...`). `registry` and `register-helper` do not match: the directory name is followed by
 * a slash or the end of the specifier, never by another word character.
 */
const REGISTER_QUARANTINE_MESSAGE =
  "src/projections/register is quarantined: the prospective register reads the engine and nothing reads it back. A module that could see a frozen row would make this season's own prospective record an input to the thing it exists to judge. See THE WALL in src/projections/register/wall.source.test.ts.";

/**
 * `projections/register` in any spelling, or a bare `./register` / `../register` hop, each ending at
 * a slash or at the end of the specifier.
 *
 * EVERY SLASH IS ESCAPED. esquery reads an attribute regex up to the first UNESCAPED `/`, so a bare
 * `projections/register` would terminate the literal after `projections` and silently compile to a
 * pattern matching nothing like what it says. The doubled backslashes here are JS string escaping;
 * the regex esquery actually receives is `(projections\/register|(\.\.?\/)register)(\/|$)`.
 */
const REGISTER_PATH = "(projections\\/register|(\\.\\.?\\/)register)(\\/|$)";

const REGISTER_QUARANTINE_SELECTORS = [
  // `import ... from "…/register/…"` and `import "…/register/…"`.
  { selector: `ImportDeclaration[source.value=/${REGISTER_PATH}/]`, message: REGISTER_QUARANTINE_MESSAGE },
  // `await import("…/register/…")` — no `from` clause, invisible to a static-import rule.
  { selector: `ImportExpression[source.value=/${REGISTER_PATH}/]`, message: REGISTER_QUARANTINE_MESSAGE },
  // `export { x } from "…/register/…"` — the re-export proxy.
  { selector: `ExportNamedDeclaration[source.value=/${REGISTER_PATH}/]`, message: REGISTER_QUARANTINE_MESSAGE },
  // `export * from "…/register/…"` — the same proxy, wildcard.
  { selector: `ExportAllDeclaration[source.value=/${REGISTER_PATH}/]`, message: REGISTER_QUARANTINE_MESSAGE },
  // `require("…/register/…")`.
  {
    selector: `CallExpression[callee.name="require"][arguments.0.value=/${REGISTER_PATH}/]`,
    message: REGISTER_QUARANTINE_MESSAGE,
  },
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["src/**/*.tsx"], rules: { ...jsxA11y.flatConfigs.strict.rules } },
  {
    // THE REGISTER QUARANTINE, scoped to everything EXCEPT the register itself and its own four
    // operator files — which necessarily import it, and are the only four files in the tree that
    // may. See REGISTER_QUARANTINE_SELECTORS above for why this owns `no-restricted-syntax` rather
    // than extending `no-restricted-imports`.
    files: ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", "scripts/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", "research-ts/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ignores: [
      "research-ts/src/projections/register/**",
      "research-ts/scripts/register-freeze.ts",
      "research-ts/scripts/register-grade.ts",
      "research-ts/src/projections/season-week/steps.ts",
      "research-ts/src/projections/season-week/steps.test.ts",
      "research-ts/src/nightly/reads/record.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...REGISTER_QUARANTINE_SELECTORS],
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    plugins: { functional },
    rules: {
      "functional/prefer-readonly-type": "error",
      "functional/immutable-data": "error",
      "functional/no-let": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // Isolated build output for the e2e suite (see next.config.ts, playwright.config.ts) —
      // generated the same way `.next/**` is, and just as much not source.
      ".next-e2e/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "coverage/**",
      ".claude/**",
      // The prep-site lanes carry their own lint configs (web/, api/, research/, research-ts/).
      "web/**",
      "api/**",
      "research/**",
      "research-ts/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    // Playwright fixtures/specs, not React: `e2e/support/fixtures.ts` destructures a second
    // fixture-function parameter literally named `use` (Playwright's own API, e.g.
    // `managerA: async ({ browser }, use) => { ... }`) which `react-hooks/rules-of-hooks`
    // otherwise flags as an unlawfully-named/placed React Hook call. Scoped to `e2e/**` only —
    // every other directory keeps the full `next/core-web-vitals` rule set.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    // Scoped to src/draft-room/**, src/league-room/**, src/chat-room/**, src/account-room/** and
    // src/admin-room/** ONLY, not src/app/**/*.tsx: files under src/app are Next.js Server
    // Components (page.tsx, layout.tsx, route.ts) that are allowed — and in this codebase's
    // existing route handlers, expected — to import @/draft-engine/@/draft-service/@/league/
    // @/league-service directly (see docs/conventions.md, "Client boundary"). A page can't be
    // told apart from a client component by its filename alone, so the only globs that can't
    // misfire are the five directories that are BROWSER code by construction: everything under
    // src/draft-room/**, src/league-room/**, src/chat-room/**, src/account-room/** (Task 2's
    // profile surface) and src/admin-room/** (Task 5's operator surface).
    //
    // This block also carries SRC_ROOT_ESCAPE_PATTERNS (below), not just the client-boundary
    // patterns: ESLint flat config merges same-named rules across matching configs by shallow
    // overwrite, not by concatenation, so a *second* config block also setting
    // `@typescript-eslint/no-restricted-imports` for a file already matched here would silently
    // replace this whole `patterns` array instead of adding to it — verified empirically, it is
    // exactly how a temp `@/db` import under `src/draft-room/**` stopped being flagged when the
    // source-root-escape rule below was first added as its own same-glob block. The
    // source-root-escape block after this one scopes itself to everywhere in `src/**` EXCEPT
    // these five directories for the same reason, so every file is covered by exactly one
    // `no-restricted-imports` config for this rule.
    files: [
      "src/draft-room/**/*.{ts,tsx}",
      "src/league-room/**/*.{ts,tsx}",
      "src/chat-room/**/*.{ts,tsx}",
      "src/account-room/**/*.{ts,tsx}",
      // Task 5's operator surface: `src/admin-room/**` (the resolution form's live preview and
      // its `fetch()` to `POST /api/admin/flags/[flagId]/resolve`) joins the other four rooms as
      // browser code by construction, so it gets the same client boundary rather than a separate
      // one.
      "src/admin-room/**/*.{ts,tsx}",
    ],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            ...SERVER_ONLY_MODULE_GROUPS.map((group) => ({
              regex: aliasOrRelative(group),
              allowTypeImports: true,
              message: "Client room code (draft-room/league-room/chat-room/account-room/admin-room) must go through the HTTP/SSE boundary (API routes), not import server-only modules as values. `import type` is fine.",
            })),
            ...SRC_ROOT_ESCAPE_PATTERNS,
          ],
        },
      ],
    },
  },
  {
    // Source code may never import upward out of the source root. `scripts/**` and `e2e/**` are
    // build/verification tooling: they are allowed to import `src/**` (and do, via `@/`), but the
    // reverse makes a production module depend on something no bundler, no `next build` and no
    // deployment artifact is guaranteed to carry. `src/data/seed/index.ts` did exactly this with
    // `../../../scripts/lib/env` until Phase 2 Plan A moved that helper to `src/lib/env.ts`; this
    // rule is what stops the next one. There is no `@/` spelling to ban because the alias only
    // maps into `src`, so a relative escape is the only reachable form.
    //
    // `ignores` excludes the five client-room directories: they already carry
    // SRC_ROOT_ESCAPE_PATTERNS via the block above, merged into the same
    // `@typescript-eslint/no-restricted-imports` invocation as the client-boundary patterns —
    // see the comment there for why a second, separately-scoped block targeting the same rule
    // for those files would silently replace rather than extend it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/draft-room/**",
      "src/league-room/**",
      "src/chat-room/**",
      "src/account-room/**",
      "src/admin-room/**",
      // The browser-safe directories carry SRC_ROOT_ESCAPE_PATTERNS in their own block below,
      // merged with the barrel rule — for the same shallow-overwrite reason the five client-room
      // directories are excluded here rather than covered twice.
      "src/matchmaking/**",
      "src/chat/**",
      "src/identity/**",
      "src/help/**",
      "src/reviews/**",
      "src/moderation/**",
      "src/trades/**",
      "src/participation/**",
      "src/money/**",
    ],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: SRC_ROOT_ESCAPE_PATTERNS }],
    },
  },
  {
    // The browser-safe exempt set's own boundary (final whole-branch review, F7). These
    // directories are pure and client-reachable, so what they import is what the browser ships —
    // and `BROWSER_SAFE_BARREL_PATTERNS` is the one rule that catches a barrel import that is
    // otherwise perfectly legal here. SRC_ROOT_ESCAPE_PATTERNS rides along in the SAME
    // `patterns` array rather than in a second same-glob block, because flat config merges
    // same-named rules by shallow overwrite: a separate block would silently replace this one.
    files: BROWSER_SAFE_MODULE_DIRS,
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [...BROWSER_SAFE_BARREL_PATTERNS, ...SRC_ROOT_ESCAPE_PATTERNS] },
      ],
    },
  },
];

export default eslintConfig;
