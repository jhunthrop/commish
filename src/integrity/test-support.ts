import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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
 * the given extension — PLUS any entry in `paths` that is itself a single file rather than a
 * directory, swept as-is. A roster entry can name a whole directory (the common case: a new
 * component or module in it is covered the moment it exists) or one exact file (for the rarer
 * case where only one file in an otherwise out-of-scope directory carries user-facing copy, and
 * sweeping its siblings would pull in strings a different sweep, or no sweep at all, actually
 * owns). Paths come back repo-root-relative, so a failure names its own file.
 *
 * Directory-derived on purpose: this is the half of the copy discipline a hand-written list of
 * `describe` blocks cannot give, because a file that nobody added to the list looks exactly like
 * a file with nothing to say. The single-file form does not weaken that — it is additive, named
 * exactly like every other roster entry, and a directory entry still sweeps everything under it.
 */
export function sourceFilesIn(paths: readonly string[], extension: string): readonly string[] {
  function isSweepable(name: string): boolean {
    return name.endsWith(extension) && !name.includes(".test.") && !name.startsWith("test-");
  }
  function walk(relativePath: string): readonly string[] {
    const full = join(REPO_ROOT, relativePath);
    if (!existsSync(full)) return [];
    if (statSync(full).isFile()) return isSweepable(basename(relativePath)) ? [relativePath] : [];
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const path = join(relativePath, entry.name);
      if (entry.isDirectory()) return walk(path);
      return isSweepable(entry.name) ? [path] : [];
    });
  }
  return paths.flatMap(walk);
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
 * Every static segment of every backtick template literal in `code` — the text between (or
 * around) `${...}` interpolations.
 *
 * Fix round 1 (review HIGH): the extractor this replaced matched a whole backtick literal only
 * via `` `([^`$\\\n]*)` `` — a character class that EXCLUDES `$` outright, so any template
 * literal containing so much as one `${...}` interpolation failed to match at all and vanished
 * from every sweep built on it, whole. That is how `KICKOFF_REFUSALS.tooFar`
 * (`@/league-service/draft-schedule.ts`) shipped a real em dash in member-facing 422 copy: it is
 * a template literal with one interpolation (`` `Pick a time within ${...} days...` ``), and
 * `league-service-copy.source.test.ts` never saw it at all, not even the non-dash parts.
 *
 * This walks the source by hand instead of matching it with one regex, because an interpolation
 * can itself contain nested `{}` (a ternary inside an object literal, a template literal inside
 * the expression) that a lazy non-greedy regex would stop at the FIRST `}` — silently splitting
 * one interpolation into two "segments" and corrupting the static text on either side of it. Brace
 * depth is counted explicitly instead. An escaped character (`` \` ``, `\$`) is skipped rather
 * than treated as the start of a close or an interpolation, and — unlike the regex it replaced —
 * a segment may contain a newline: a multi-line template literal is exactly as real a place for
 * copy to live as a single-line one, and excluding newlines was the SAME class of gap this fix
 * closes, just a quieter manifestation of it.
 */
function templateSegmentsIn(code: string): readonly string[] {
  const segments: string[] = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] !== "`") {
      i += 1;
      continue;
    }
    i += 1; // past the opening backtick
    let segment = "";
    while (i < code.length && code[i] !== "`") {
      if (code[i] === "\\") {
        // Kept in the segment (not dropped): an escaped character is never the start of an
        // interpolation or the close, but it is still real content of the string — `it\`s fine`
        // reads as "it`s fine" in the value this literal actually holds at runtime.
        segment += code[i] + (code[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (code[i] === "$" && code[i + 1] === "{") {
        segments.push(segment);
        segment = "";
        i += 2;
        let depth = 1;
        while (i < code.length && depth > 0) {
          if (code[i] === "{") depth += 1;
          else if (code[i] === "}") depth -= 1;
          i += 1;
        }
        continue;
      }
      segment += code[i];
      i += 1;
    }
    segments.push(segment);
    i += 1; // past the closing backtick (or end of input on an unterminated literal — harmless,
    // since the outer `while` simply stops)
  }
  return segments;
}

/**
 * Every single-line quoted or single-quoted literal, plus every static segment of every backtick
 * template literal (`templateSegmentsIn`, above) — including ones with interpolations, which the
 * fix round 1 rewrite of that function is what makes possible.
 *
 * Exactly one of the two quote-style alternation groups participates in any regex match —
 * including for an empty literal, where the group is `""` rather than `undefined` — so the chain
 * always resolves; template segments are collected separately and appended.
 */
function literalsIn(code: string): readonly string[] {
  const quoted = [...code.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)].map((match) => (match[1] ?? match[2])!);
  return [...quoted, ...templateSegmentsIn(code)];
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
  draft_auto_started: { leagueName: "Sunday Money" },
  draft_pick_skipped: { leagueName: "Sunday Money" },
  draft_fill_triggered: { leagueName: "Sunday Money", graceLabel: "5 minutes" },
  house_league_filled: { leagueName: "Open 12-team League 3" },
  draft_kickoff_rolled: {
    leagueName: "Sunday Money",
    newKickoffAt: "Friday 11 September, 8:00 PM UTC",
    rollSentence: "This draft moved once because the room was not full.",
    startTimingSentence: "The draft starts as soon as the last seat is taken, or when your commissioner starts it.",
    showReleaseParagraph: false,
  },
  draft_fill_reversed: { leagueName: "Sunday Money" },
};
