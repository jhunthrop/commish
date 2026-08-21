import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyViolations } from "./copy-rules";
import { candidateCopyIn, sourceFilesIn } from "./test-support";

/**
 * THE HOUSE COPY RULES, APPLIED TO SOURCE RATHER THAN TO A RENDER.
 *
 * `rendered-copy.test.tsx` beside this file sweeps what a person SEES, which is the stronger
 * check and the one to prefer. But it can only see what a first paint puts on screen, and it is a
 * hardcoded list of `describe` blocks — a new surface is covered only if its author remembers to
 * add one. The final whole-branch review found both halves of that gap, and both had already let
 * a violation ship:
 *
 *  - MEDIUM 5: `src/chat-room/**` had never been added to the rendered sweep at all, so the room
 *    tombstone read "A message was removed." — literally on
 *    `INTEGRITY_CONFIG.notices.passiveConstructions` — through review, adjudication and a fix
 *    round, locked in by three assertions that all agreed with each other.
 *  - MEDIUM 6: `src/admin-room/components/resolution-form.tsx`'s `content_removed` hint carried
 *    an em dash. The rendered sweep mounts that form at first paint, where `decision` initializes
 *    to `decisions[0]` — the fixture's `no_action` — so the offending branch never mounted.
 *
 * A source scan is blind to composition (a sentence assembled from three variables is invisible
 * here) and that is exactly why it does not REPLACE the rendered sweep. What it does is close the
 * two gaps that are structural rather than careless: it is DIRECTORY-DERIVED, so a new component
 * file is swept the moment it exists, and it reads every literal in the file rather than only the
 * ones a particular interaction state paints. Between the two, a string has to be both composed
 * at runtime AND unreachable at first paint to escape.
 *
 * Both findings were reproduced against this file before their fixes landed: re-injecting either
 * string reddens the scan for the file it lives in.
 */

/** The two client-room directories the review named. The other rooms are swept by the rendered
 *  sweep's own `describe` blocks; these two are added here rather than there because the gap
 *  that let 5 and 6 ship was not "somebody forgot a block", it was that a hand-maintained list
 *  cannot cover a directory. */
const ROOM_DIRS = ["src/chat-room", "src/admin-room"];

const REPO_ROOT = process.cwd();

const files = sourceFilesIn(ROOM_DIRS, ".tsx");

describe("the chat room and the admin room write in the house voice", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    // Its own tests, and the module holding this scan's helpers, are the things DOING the
    // checking rather than things being checked — the same exclusion `flag-only.test.ts`'s own
    // walker makes, asserted here so widening the filter cannot silently pull them in.
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });

  /** A directory that does not exist answers empty rather than throwing — the scan names its
   *  directories by hand, and a rename should not take the whole suite down with an ENOENT. */
  it("answers empty for a directory that is not there", () => {
    expect(sourceFilesIn(["src/no-such-room"], ".tsx")).toEqual([]);
  });

  it.each(files)("%s says nothing that breaks the copy rules", (file) => {
    const offenders = candidateCopyIn(readFileSync(join(REPO_ROOT, file), "utf8")).flatMap((text) =>
      copyViolations(text).map((violation) => ({ text, ...violation })),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * The scan's own proof of bite, so it never becomes a green test over an extractor that stopped
   * extracting. These are the two strings the review actually found, in the two shapes they
   * actually had: a JSX text node and a ternary branch of a prop.
   */
  it("catches both real findings, in the shapes they shipped in", () => {
    const tombstone = `<p className="italic text-text-muted">A message was removed.</p>`;
    expect(candidateCopyIn(tombstone).flatMap(copyViolations)).toContainEqual({ rule: "passive", found: "was removed" });

    const hint = `hint={decision === "content_removed" ? "Your own words. The member reads a general reason instead — see below." : "Your own words."}`;
    expect(candidateCopyIn(hint).flatMap(copyViolations)).toContainEqual({ rule: "dash", found: "—" });
  });

  /** And its own proof it is not simply blanking everything: a docblock em dash is exempt (the
   *  founder rule is about product copy, not engineering prose) while the same character one line
   *  later, in a rendered string, is not. */
  it("exempts comments and nothing else", () => {
    const source = `/** An engineering note — with a dash. */\nconst label = "Ready — set";`;
    expect(candidateCopyIn(source)).toEqual(["Ready — set"]);
  });
});
