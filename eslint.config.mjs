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
];

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

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["src/**/*.tsx"], rules: { ...jsxA11y.flatConfigs.strict.rules } },
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
    // Scoped to src/draft-room/** and src/league-room/** ONLY, not src/app/**/*.tsx: files
    // under src/app are Next.js Server Components (page.tsx, layout.tsx, route.ts) that are
    // allowed — and in this codebase's existing route handlers, expected — to import
    // @/draft-engine/@/draft-service/@/league/@/league-service directly (see
    // docs/conventions.md, "Client boundary"). A page can't be told apart from a client
    // component by its filename alone, so the only globs that can't misfire are the three
    // directories that are BROWSER code by construction: everything under src/draft-room/**,
    // src/league-room/** and src/chat-room/**.
    //
    // This block also carries SRC_ROOT_ESCAPE_PATTERNS (below), not just the client-boundary
    // patterns: ESLint flat config merges same-named rules across matching configs by shallow
    // overwrite, not by concatenation, so a *second* config block also setting
    // `@typescript-eslint/no-restricted-imports` for a file already matched here would silently
    // replace this whole `patterns` array instead of adding to it — verified empirically, it is
    // exactly how a temp `@/db` import under `src/draft-room/**` stopped being flagged when the
    // source-root-escape rule below was first added as its own same-glob block. The
    // source-root-escape block after this one scopes itself to everywhere in `src/**` EXCEPT
    // these three directories for the same reason, so every file is covered by exactly one
    // `no-restricted-imports` config for this rule.
    files: ["src/draft-room/**/*.{ts,tsx}", "src/league-room/**/*.{ts,tsx}", "src/chat-room/**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            ...SERVER_ONLY_MODULE_GROUPS.map((group) => ({
              regex: aliasOrRelative(group),
              allowTypeImports: true,
              message: "Client room code (draft-room/league-room/chat-room) must go through the HTTP/SSE boundary (API routes), not import server-only modules as values. `import type` is fine.",
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
    // `ignores` excludes the three client-room directories: they already carry
    // SRC_ROOT_ESCAPE_PATTERNS via the block above, merged into the same
    // `@typescript-eslint/no-restricted-imports` invocation as the client-boundary patterns —
    // see the comment there for why a second, separately-scoped block targeting the same rule
    // for those files would silently replace rather than extend it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/draft-room/**", "src/league-room/**", "src/chat-room/**"],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: SRC_ROOT_ESCAPE_PATTERNS }],
    },
  },
];

export default eslintConfig;
