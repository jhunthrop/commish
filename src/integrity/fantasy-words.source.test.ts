import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tradingVocabularyViolations } from "./copy-rules";
import { candidateCopyIn, sourceFilesIn } from "./test-support";

/**
 * FANTASY WORDS, NOT TRADING WORDS (founder, 2026-09-07), APPLIED TO SOURCE.
 *
 * "We say market everywhere like this is a stock trading app, it's a fantasy football app." Every
 * word a manager reads is fantasy football's own: ADP, a reach, a steal, drafters, "he is going
 * later than he should". The trader's vocabulary (`TRADING_VOCABULARY` in `copy-rules.ts`) never
 * renders. Internal identifiers, table names and research docs keep their names, so this sweeps
 * what `candidateCopyIn` reads as copy (string literals and JSX text, comments and imports
 * exempt) and `tradingVocabularyViolations` subtracts the identifier literals a scan cannot tell
 * from prose.
 *
 * Same shape as `room-copy.source.test.ts` next door and for the same reason: directory-derived,
 * so a component added next month is swept the moment it exists. Wider than `ROOM_DIRS` because
 * the ruling is about every manager-facing surface, and the draft board, the Draft HQ sub-nav,
 * the reason chip and the arriving-soon pages all live outside the rooms. Both `.tsx` and `.ts`
 * are walked: the sentence builders this round rewrote (`draft-hq/board/copy.ts`,
 * `league-room/outlook/verdict.ts`, `draft-room/lib/market-order-note.ts`) are plain modules,
 * and a sweep that skipped them would miss the exact strings the ruling was about.
 *
 * `MANAGER_FILES` names the capsule modules by file rather than by directory: the template is the one
 * that renders to a manager without the writer, and the sheet and prompt modules are what the model
 * quotes back to one (refrains round, 2026-09-07). The rest of `src/capsules` is machinery.
 */
const MANAGER_DIRS = ["src/components", "src/app", "src/league-room", "src/draft-room", "src/draft-hq", "src/chat-room", "src/account-room", "src/admin-room", "src/help", "src/teams", "src/search"];

/**
 * THE DIRECTORIES THAT RENDER A COMPONENT AND ARE DELIBERATELY NOT SWEPT, each with its reason.
 * The site search fix round (2026-09-08) found `src/teams` rendering "Market order" for a day
 * because a new directory of components was never added to `MANAGER_DIRS`; the completeness
 * test below walks `src` and fails on any directory holding a non-test `.tsx` that is in neither
 * list, so the next new directory is a decision somebody records rather than a gap nobody sees.
 */
const EXCLUDED_COMPONENT_DIRS: Readonly<Record<string, string>> = {
  "src/design": "the theme provider and the token layer: a context wrapper that renders no copy of its own",
};

/**
 * The capsule modules whose strings a manager reads or a model quotes back to one: the template
 * floor, the fact sheet (`render.ts`, `render-depth.ts`), the slot briefs (`narrative.ts`), the
 * writer's instructions (`prompt.ts`), the bundle contract (`bundle.ts`) and the transport
 * (`write.ts`). Named by file rather than by directory because the rest of `src/capsules` is
 * config and machinery (the banned-vocabulary list itself holds these words, on purpose). The only
 * allowlisted literal in any of them is an identifier (`market_unlisted`, a `BoardReason` code).
 */
const MANAGER_FILES = [
  "research-ts/src/capsules/template.ts",
  "research-ts/src/capsules/render.ts",
  "research-ts/src/capsules/render-depth.ts",
  "research-ts/src/capsules/narrative.ts",
  "research-ts/src/capsules/prompt.ts",
  "research-ts/src/capsules/bundle.ts",
  "research-ts/src/capsules/write.ts",
];

const REPO_ROOT = process.cwd();

const files = [...sourceFilesIn(MANAGER_DIRS, ".tsx"), ...sourceFilesIn(MANAGER_DIRS, ".ts"), ...MANAGER_FILES];

describe("every manager-facing surface speaks fantasy football, never trading", () => {
  it("finds the files to sweep, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
    // Every swept directory is pinned by name, LITERALLY, never by iterating `MANAGER_DIRS`
    // (the discipline `room-copy.source.test.ts` and `no-uppercase.source.test.ts` both name).
    expect(files.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/app"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/draft-hq"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/help"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/teams"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/search"))).toBe(true);
    expect(files).toContain("research-ts/src/capsules/template.ts");
    expect(files).toContain("research-ts/src/capsules/render.ts");
    expect(files).toContain("research-ts/src/capsules/prompt.ts");
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });

  /** COMPLETENESS: every top-level directory under `src` that renders a component is either swept
   *  or excluded by name with a reason. A directory in both lists is a contradiction and fails too. */
  it("sweeps, or names and excuses, every directory under src that renders a component", () => {
    const topLevelDirs = readdirSync(join(REPO_ROOT, "src"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/${entry.name}`);
    const rendering = topLevelDirs.filter((dir) => sourceFilesIn([dir], ".tsx").length > 0);
    expect(rendering.length).toBeGreaterThanOrEqual(10);
    const unaccounted = rendering.filter((dir) => !MANAGER_DIRS.includes(dir) && EXCLUDED_COMPONENT_DIRS[dir] === undefined);
    expect(unaccounted, "a directory rendering components must be in MANAGER_DIRS or EXCLUDED_COMPONENT_DIRS with a reason").toEqual([]);
    expect(Object.keys(EXCLUDED_COMPONENT_DIRS).filter((dir) => MANAGER_DIRS.includes(dir))).toEqual([]);
    for (const [dir, reason] of Object.entries(EXCLUDED_COMPONENT_DIRS)) {
      expect(rendering, `${dir} is excused but renders nothing; drop the exclusion`).toContain(dir);
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(files)("%s says nothing in a trader's words", (file) => {
    const offenders = candidateCopyIn(readFileSync(join(REPO_ROOT, file), "utf8")).flatMap((text) =>
      tradingVocabularyViolations(text).map((violation) => ({ text, ...violation })),
    );
    expect(offenders).toEqual([]);
  });

  /** The scan's own proof of bite: the shapes the ruling's inventory actually found. */
  it("catches the real findings, in the shapes they shipped in", () => {
    const heading = `<th scope="col" className="px-2 py-2 text-right">Market ADP</th>`;
    expect(candidateCopyIn(heading).flatMap(tradingVocabularyViolations)).toContainEqual({ rule: "tradingVocabulary", found: "Market" });

    const template = "return { text: `priced ${early} pick${early === 1 ? \"\" : \"s\"} early`, tone: \"neutral\" };";
    expect(candidateCopyIn(template).flatMap(tradingVocabularyViolations)).toContainEqual({ rule: "tradingVocabulary", found: "priced" });

    const prop = `<Movement places={gap} against="the market" />`;
    expect(candidateCopyIn(prop).flatMap(tradingVocabularyViolations)).toContainEqual({ rule: "tradingVocabulary", found: "market" });
  });

  /** And its proof it is not simply blanking everything: a docblock mention is exempt, an
   *  identifier literal is exempt, and the same word one line later in a rendered string is not. */
  it("exempts comments and identifier literals, and nothing else", () => {
    const source = `/** The market's own read. */\ncase "market_anchor":\n  return "The market has him at 99.7.";`;
    const offenders = candidateCopyIn(source).flatMap(tradingVocabularyViolations);
    expect(offenders).toEqual([{ rule: "tradingVocabulary", found: "market" }]);
  });
});
