import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NoticeContexts, NoticeType } from "./notices";

/**
 * TEST-ONLY support for this directory's copy sweeps. Nothing in production imports it, which is
 * the point: `NOTICE_SAMPLES` at the bottom used to live in `notices.ts` beside the real
 * templates, and test input in a production module is what the final review named it (LOW 14).
 *
 * `rendered-copy.test.tsx` sweeps what a person SEES, which is the stronger check and the one to
 * prefer. It has two structural blind spots the final whole-branch review found the hard way: it
 * is a hand-maintained list of surfaces, so a directory nobody remembered is swept by nothing
 * (MEDIUM 5), and it renders FIRST PAINT, so copy behind an interaction never mounts (MEDIUM 6).
 * The scans built on the helpers here close both by reading the source of a whole directory.
 */

const REPO_ROOT = process.cwd();

/**
 * Every non-test source file under the given repo-root-relative directories, recursively, with
 * the given extension. Paths come back repo-root-relative, so a failure names its own file.
 *
 * Directory-derived on purpose: this is the half of the copy discipline a hand-written list of
 * `describe` blocks cannot give, because a file that nobody added to the list looks exactly like
 * a file with nothing to say.
 */
export function sourceFilesIn(dirs: readonly string[], extension: string): readonly string[] {
  function walk(dir: string): readonly string[] {
    const full = join(REPO_ROOT, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (!entry.name.endsWith(extension) || entry.name.includes(".test.") || entry.name.startsWith("test-")) return [];
      return [path];
    });
  }
  return dirs.flatMap(walk);
}

/**
 * `source` with everything that is never rendered removed: comments, module specifiers and
 * `className` values.
 *
 * Comments are stripped because they are the ONE category a reader never sees, and this
 * codebase's docblocks use em dashes freely on purpose — the founder rule governs product copy,
 * not engineering prose. Module specifiers are paths, not sentences. `className` values are
 * Tailwind token lists. Nothing else is stripped.
 */
export function renderableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*(?:import|export)\s[^;]*?from\s*["'][^"']*["'];?$/gm, "")
    .replace(/className=(?:"[^"]*"|'[^']*'|\{`[^`]*`\})/g, "");
}

/**
 * Every single-line quoted, single-quoted or interpolation-free templated literal in `code`.
 *
 * Exactly one of the three alternation groups participates in any match — including for an empty
 * literal, where the group is `""` rather than `undefined` — so the chain always resolves.
 */
function literalsIn(code: string): readonly string[] {
  return [...code.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`$\\\n]*)`/g)].map((match) => (match[1] ?? match[2] ?? match[3])!);
}

/** Drops whitespace-only and symbol-only fragments — nothing the copy rules could speak to. */
function meaningful(texts: readonly string[]): readonly string[] {
  return texts.map((text) => text.trim()).filter((text) => /[A-Za-z]/.test(text));
}

/**
 * The candidate copy in one component file: its JSX text nodes plus its string literals.
 *
 * It over-collects, deliberately — an enum value, an element type and a sentence all come back
 * together. That costs nothing, because the rules only fire on a dash, an accusatory word or a
 * passive construction, none of which belong in an identifier either. The alternative, a
 * whitelist of "user-facing props", is precisely the hand-maintained list whose gaps this exists
 * to close.
 *
 * It is BLIND TO COMPOSITION: a sentence assembled from three variables is invisible here. That
 * is why this does not replace the rendered sweep. Between the two, a string has to be both
 * composed at runtime AND unreachable at first paint to escape both.
 */
export function candidateCopyIn(source: string): readonly string[] {
  const code = renderableSource(source);
  // JSX text: what sits between a `>` and the next `<`, expressions excluded.
  const jsxText = [...code.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]!);
  return meaningful([...literalsIn(code), ...jsxText]);
}

/**
 * The candidate copy an operator READS ON A TERMINAL: the literals passed to `console.*` calls,
 * and nothing else.
 *
 * Narrower than `candidateCopyIn` on purpose. A script's `throw` messages and its `Error` strings
 * are developer-facing — the final review checked them by hand and accepted them as such — and
 * sweeping those under the product's copy rules would be a gate that fires on prose it has no
 * claim over. What a script PRINTS is different: an operator reads it the way a member reads a
 * notice, in the product's own voice.
 */
export function consoleCopyIn(source: string): readonly string[] {
  const calls = [...renderableSource(source).matchAll(/console\.(?:log|error|warn|info)\(([\s\S]*?)\);/g)].map((match) => match[1]!);
  return meaningful(calls.flatMap(literalsIn));
}

/**
 * One neutral context per notice type, so `notices.test.ts`'s registry-derived copy sweep has
 * something to render every template with.
 *
 * It lives HERE rather than in `notices.ts` beside the templates (final review, LOW 14: test
 * input in a production module). The property that made it worth having is unchanged by the move
 * — the mapped type `{ [T in NoticeType]: NoticeContexts[T] }` is exhaustive, so a new notice
 * type without a sample here does not compile, and the sweep therefore covers every template on
 * the commit that adds one.
 */
export const NOTICE_SAMPLES: { readonly [T in NoticeType]: NoticeContexts[T] } = {
  draft_auto_picked: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
  review_removed: { reason: "off topic" },
  admin_granted: { grantedByUserId: "bootstrap" },
  operator_warning: { leagueName: "Sunday Money", note: "Keep the trash talk about the teams." },
  chat_message_removed: { leagueName: "Sunday Money", reason: "off topic" },
  stat_week_corrected: { leagueName: "Sunday Money", week: 3, points: 84.2, outcome: "that turns your matchup into a win" },
  trade_proposed: { leagueName: "Sunday Money", proposerTeamName: "Bay Bandits", giveSummary: "Bijan Robinson", getSummary: "Justin Jefferson", note: "one more year of this and I'm out" },
  trade_rejected: { leagueName: "Sunday Money", counterpartyTeamName: "Iron Owls" },
  trade_withdrawn: { leagueName: "Sunday Money", proposerTeamName: "Bay Bandits" },
  trade_executed: { leagueName: "Sunday Money", counterpartyTeamName: "Iron Owls", gaveSummary: "Bijan Robinson", gotSummary: "Justin Jefferson" },
  trade_superseded: { leagueName: "Sunday Money", counterpartyTeamName: "Iron Owls", role: "proposer" },
  trade_reversed: {
    leagueName: "Sunday Money",
    counterpartyTeamName: "Iron Owls",
    gotBackSummary: "Bijan Robinson",
    gaveBackSummary: "Justin Jefferson",
    note: "Two accounts, one household, and this trade is why we looked.",
  },
  tier_blocked_join: { leagueName: "Rookie Snake Room" },
  lineup_auto_set: { leagueName: "Sunday Money", week: 4, carriedFrom: 3, changedPlayers: "" },
  trade_held_for_review: { leagueName: "Sunday Money", counterpartyTeamName: "Iron Owls" },
  trade_blocked: { leagueName: "Sunday Money", note: "Both teams belong to one person." },
};
