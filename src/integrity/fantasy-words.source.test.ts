import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
 * `src/capsules/template.ts` is named by file rather than by directory: it is the one capsule
 * module that renders to a manager without the writer (the template floor). The rest of
 * `src/capsules` is the writer's prompt and fact sheet, swept by its own tests.
 */
const MANAGER_DIRS = ["src/components", "src/app", "src/league-room", "src/draft-room", "src/draft-hq", "src/chat-room", "src/account-room", "src/admin-room", "src/help"];

const MANAGER_FILES = ["src/capsules/template.ts"];

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
    expect(files).toContain("src/capsules/template.ts");
    expect(files.some((file) => file.includes(".test."))).toBe(false);
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
