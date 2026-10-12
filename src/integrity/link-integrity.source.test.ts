import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreservingLines } from "@/design/test-support";
import { sourceFilesIn } from "./test-support";

/**
 * LINK INTEGRITY, APPLIED TO SOURCE (link audit, 2026-09-04 — the founder's "we have numerous
 * links across the apps that don't work"). Six surface rebuilds in 48 hours moved and retired
 * routes and anchors; the hrefs pointing at them did not all move along. This sweep makes that
 * class of defect a test failure instead of a founder report:
 *
 * 1. It inventories every route the app actually serves — every `page.tsx` and `route.ts` under
 *    `src/app`, route groups dropped, dynamic segments kept as wildcards — plus every literal
 *    `id="..."` a fragment link could target, plus every file under `public/`.
 * 2. It inventories every internal link target in source: string and template literals in
 *    `href=`/`intent=` attributes, `router.push`/`router.replace`, `redirect(...)`,
 *    `history.pushState(...)` calls, AND every bare string literal that spells an absolute
 *    path (`action-href.ts` builds hrefs in plain returns; a call-site-only scan would miss
 *    exactly the file most likely to go stale). A template segment that is one whole `${...}`
 *    expression normalizes to a wildcard (`/app/leagues/${id}/players` matches
 *    `/app/leagues/[leagueId]/players`).
 * 3. It FAILS for any internal link whose normalized target matches no served route, and any
 *    fragment href whose anchor id exists nowhere in swept source.
 *
 * A target this scan cannot resolve statically (a template that interleaves text and expression
 * inside one segment, a path assembled from variables) is NOT silently skipped: it must carry an
 * entry in `MANUAL_AUDIT`, each with a reason, so a new unresolvable href surfaces here and gets
 * a human look — the discipline `accent-budget.source.test.ts`'s allowlist established. There
 * are no `next.config.ts`/`vercel.json` redirects today; if either ever grows one, its targets
 * join the inventory here.
 */

const SWEPT_DIRS = ["src"] as const;

/** Comments are stripped before extraction, so a docblock retelling a retired route's history
 *  (there are many) is prose, not a link — the carve-out every source sweep here makes. */
const files = [...sourceFilesIn(SWEPT_DIRS, ".tsx"), ...sourceFilesIn(SWEPT_DIRS, ".ts")];

// ---------------------------------------------------------------------------------------------
// The served surface: routes, anchors, public files.
// ---------------------------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

/** Every route the app serves, as segment arrays; `[param]` segments match any one segment. */
function servedRoutes(): readonly (readonly string[])[] {
  const routes: string[][] = [];
  function walk(dir: string, segments: readonly string[]): void {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // A route group `(shell)` changes no URL; every other directory is a path segment.
        const next = /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name];
        walk(join(dir, entry.name), next);
      } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
        routes.push([...segments]);
      }
    }
  }
  walk("src/app", []);
  return routes;
}

const ROUTES = servedRoutes();

/**
 * Every literal anchor id in swept source — the pool a fragment link may target. `anchorId=`
 * counts as a declaration too: `TradeInbox` takes the id as a prop and renders it onto its own
 * `<section id={anchorId}>`, so the literal is spelled at the call site, one hop from the DOM.
 */
function anchorIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const file of files) {
    const source = stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, file), "utf8"));
    for (const match of source.matchAll(/\b(?:id|anchorId)=(?:"([^"]+)"|\{"([^"]+)"\}|\{`([^`$]+)`\})/g)) {
      ids.add(match[1] ?? match[2] ?? match[3] ?? "");
    }
  }
  return ids;
}

const ANCHOR_IDS = anchorIds();

function isPublicFile(segments: readonly string[]): boolean {
  return segments.length > 0 && existsSync(join(REPO_ROOT, "public", ...segments));
}

// ---------------------------------------------------------------------------------------------
// Extraction: every internal link target a source file spells.
// ---------------------------------------------------------------------------------------------

interface FoundTarget {
  readonly file: string;
  readonly raw: string;
}

/** Call sites whose string argument IS a navigation target, wherever it points. */
const CALL_SITE_PATTERNS: readonly RegExp[] = [
  /\b(?:href|intent)=\{?\s*(["'`])(.*?)\1/g,
  /\brouter\.(?:push|replace|prefetch)\(\s*(["'`])(.*?)\1/g,
  /\b(?:redirect|permanentRedirect)\(\s*(["'`])(.*?)\1/g,
  /\bpushState\(\s*[^,()]*,\s*[^,()]*,\s*(["'`])(.*?)\1/g,
];

/** Bare literals that spell an absolute path — pass 2's catch for hrefs built in plain
 *  expressions (`action-href.ts`, contract `path` fields) rather than at a call site. Absolute
 *  paths only, never bare `#…` strings: a `"#"` column header, a `#${pick.pickNumber}` display
 *  string and a hex color literal are all prose, while a REAL fragment link spelled outside an
 *  href is something this codebase does not do. */
const BARE_LITERAL_PATTERN = /(["'`])(\/(?:\\.|(?!\1)[^\\\n])*)\1/g;

function extractTargets(): readonly FoundTarget[] {
  const found: FoundTarget[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const source = stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, file), "utf8"));
    const record = (raw: string): void => {
      const key = `${file} ${raw}`;
      if (seen.has(key) || raw === "") return;
      seen.add(key);
      found.push({ file, raw });
    };
    for (const pattern of CALL_SITE_PATTERNS) {
      for (const match of source.matchAll(pattern)) record(match[2] ?? "");
    }
    for (const match of source.matchAll(BARE_LITERAL_PATTERN)) record(match[2] ?? "");
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Normalization and matching.
// ---------------------------------------------------------------------------------------------

type Normalized =
  | { readonly kind: "internal"; readonly segments: readonly string[]; readonly fragment: string | null }
  | { readonly kind: "fragment"; readonly fragment: string }
  | { readonly kind: "external" }
  | { readonly kind: "not-a-link" }
  | { readonly kind: "unresolvable" };

const WILDCARD = "[dyn]";

/** True for a literal that is plainly not a URL path: prose, separators, regex sources. */
function notALink(raw: string): boolean {
  return /\s/.test(raw) || raw.startsWith("//") || raw.includes("*") || raw.includes("\\") || raw.includes("|") || raw.includes("<");
}

function normalize(raw: string): Normalized {
  if (/^(?:https?:|mailto:|tel:|data:)/.test(raw)) return { kind: "external" };
  if (raw.startsWith("#")) {
    const fragment = raw.slice(1);
    return fragment === "" || fragment.includes("${") ? { kind: "unresolvable" } : { kind: "fragment", fragment };
  }
  if (!raw.startsWith("/") || notALink(raw)) return { kind: "not-a-link" };

  const [beforeFragment, ...fragmentParts] = raw.split("#");
  const fragment = fragmentParts.length > 0 ? fragmentParts.join("#") : null;
  const path = (beforeFragment ?? "").split("?")[0] ?? "";
  const segments: string[] = [];
  for (const segment of path.split("/").slice(1)) {
    if (segment === "") continue; // a trailing slash, or the root path itself
    if (/^\$\{[^{}]*\}$/.test(segment)) segments.push(WILDCARD);
    else if (segment.includes("${")) return { kind: "unresolvable" };
    else segments.push(segment);
  }
  if (fragment !== null && fragment.includes("${")) return { kind: "unresolvable" };
  return { kind: "internal", segments, fragment };
}

function matchesServedRoute(segments: readonly string[]): boolean {
  return ROUTES.some(
    (route) =>
      route.length === segments.length &&
      route.every((routeSegment, index) => {
        const linkSegment = segments[index] ?? "";
        // A dynamic route segment takes anything — including a wildcard link segment. A LITERAL
        // route segment takes only its own literal: letting a wildcard satisfy it too (the first
        // draft's rule) meant `/app/${x}/edit` could "match" `/app/leagues/[leagueId]` purely by
        // length, hiding stale templated hrefs (review finding, 2026-09-04).
        return routeSegment.startsWith("[") ? true : linkSegment !== WILDCARD && routeSegment === linkSegment;
      }),
  );
}

// ---------------------------------------------------------------------------------------------
// The allowlists — every entry carries its reason, in review, the sweep discipline.
// ---------------------------------------------------------------------------------------------

/**
 * Whole files whose leading-slash literals are not links into this app at all — external API
 * path SUFFIXES joined onto a vendor base URL. Swept-dir-shaped exemption, with the reason.
 */
const NOT_ROUTE_FILES: ReadonlyMap<string, string> = new Map([
  ["research/src/stats/tank01/config.ts", "Tank01 RapidAPI endpoint suffixes (/getNFLPlayerList, ...), joined onto the vendor base URL — no internal navigation."],
  ["research/src/projections/odds/snapshot.ts", "The Odds API endpoint suffixes (/events, /events/${eventId}/odds), joined onto the vendor base URL — no internal navigation."],
]);

/**
 * Targets the static resolver genuinely cannot follow — each one audited by hand (see
 * `docs/superpowers/research/2026-09-04-link-audit.md`) and re-audited whenever it changes,
 * because an entry here that stops appearing in source fails the staleness check below.
 * Keyed `file: raw`, exact, so an exemption never travels to a second call site unreviewed.
 */
const MANUAL_AUDIT: ReadonlyMap<string, string> = new Map([
  [
    "src/league-room/components/room-shell.tsx: ${base}/${next.surface}",
    "The drawer's pushState: base is /app/leagues/[leagueId] and surface is one of DRAWER_SURFACES, each a served sub-route (players/standings/trades/activity) — surfaceFromPathname round-trips the same strings.",
  ],
  [
    "src/app/app/(shell)/wallet/wallet-content.tsx: #${WALLET_DEPOSIT_ANCHOR}",
    "Same-file constant, value \"wallet-deposit\" — rendered as <div id={WALLET_DEPOSIT_ANCHOR}> forty lines up.",
  ],
  [
    "src/app/app/(shell)/wallet/wallet-content.tsx: #${WALLET_IDENTITY_ANCHOR}",
    "Same-file constant, value \"wallet-identity\" — rendered as <div id={WALLET_IDENTITY_ANCHOR}> forty lines up.",
  ],
  [
    "src/app/league-rules/term-link.tsx: #term-${term}",
    "TermLink's contract with GlossarySection's id={`term-${key}`}: both sides template the same GLOSSARY keys, so every minted fragment has its anchor by construction.",
  ],
]);

/**
 * Internal-looking literals that are NOT links into this app's route table, each with the
 * reason it is exempt rather than broken. Keyed `file: raw`, exact.
 */
const NOT_ROUTES: ReadonlyMap<string, string> = new Map([
  [
    "src/components/app-shell/admin-console-nav.tsx: /app/admin",
    "A pathname.startsWith guard deciding whether the console nav renders at all — a route PREFIX (every /app/admin/* page is served), never an href.",
  ],
  [
    "src/components/app-shell/rail-nav.tsx: /app/drafts",
    "RAIL_LINKS' `also` field: an active-state pathname prefix for the draft rooms living under /app/drafts/[draftId] — the row's own href is /app/draft/mock-drafts.",
  ],
]);

// ---------------------------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------------------------

const targets = extractTargets();

describe("link integrity: every internal link lands on a served route", () => {
  it("finds the app's own routes at all (the walker is not silently sweeping nothing)", () => {
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(matchesServedRoute([])).toBe(true); // "/" — src/app/page.tsx
    expect(matchesServedRoute(["app", "join", WILDCARD])).toBe(true);
    expect(matchesServedRoute(["no", "such", "route"])).toBe(false);
    // The review's own probes (2026-09-04): a wildcard must never satisfy a LITERAL route
    // segment, or a stale templated href hides behind any same-length route.
    expect(matchesServedRoute(["app", WILDCARD, "edit"])).toBe(false); // no /app/*/edit exists
    expect(matchesServedRoute(["app", WILDCARD])).toBe(false); // no /app/[x] route exists
    expect(matchesServedRoute(["app", "leagues", WILDCARD, "players"])).toBe(true); // real dynamic
  });

  it("routes every internal href/push/redirect target to a served route or public file", () => {
    const broken: string[] = [];
    for (const { file, raw } of targets) {
      if (NOT_ROUTE_FILES.has(file)) continue;
      const normalized = normalize(raw);
      if (normalized.kind !== "internal") continue;
      if (NOT_ROUTES.has(`${file}: ${raw}`)) continue;
      if (matchesServedRoute(normalized.segments) || isPublicFile(normalized.segments)) continue;
      broken.push(`${file}: "${raw}" matches no served route`);
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });

  it("lands every fragment link on an anchor id that exists somewhere in source", () => {
    const broken: string[] = [];
    for (const { file, raw } of targets) {
      if (NOT_ROUTE_FILES.has(file)) continue;
      const normalized = normalize(raw);
      const fragment =
        normalized.kind === "fragment" ? normalized.fragment : normalized.kind === "internal" ? normalized.fragment : null;
      if (fragment === null) continue;
      if (!ANCHOR_IDS.has(fragment)) broken.push(`${file}: "${raw}" targets #${fragment}, an id no swept source declares`);
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });

  it("carries a manual-audit entry, with a reason, for every target the resolver cannot follow", () => {
    const unlisted: string[] = [];
    for (const { file, raw } of targets) {
      if (NOT_ROUTE_FILES.has(file)) continue;
      if (normalize(raw).kind !== "unresolvable") continue;
      if (!MANUAL_AUDIT.has(`${file}: ${raw}`)) {
        unlisted.push(`${file}: "${raw}" is not statically resolvable and has no manual-audit entry`);
      }
    }
    expect(unlisted, unlisted.join("\n")).toEqual([]);
  });

  it("keeps every allowlist honest: each entry still occurs in swept source", () => {
    const spelled = new Set(targets.map((target) => `${target.file}: ${target.raw}`));
    const sweptWithTargets = new Set(targets.map((target) => target.file));
    const stale = [
      ...[...MANUAL_AUDIT.keys(), ...NOT_ROUTES.keys()].filter((key) => !spelled.has(key)),
      ...[...NOT_ROUTE_FILES.keys()].filter((file) => !sweptWithTargets.has(file)),
    ];
    expect(stale, `stale allowlist entries: ${stale.join(", ")}`).toEqual([]);
  });
});
