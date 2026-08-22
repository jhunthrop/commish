import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyViolations } from "./copy-rules";
import { candidateCopyIn, sourceFilesIn } from "./test-support";

/**
 * A THIRD directory this house-voice discipline reaches, beside `room-copy.source.test.ts`
 * (`.tsx` in `ROOM_DIRS`) and `script-copy.source.test.ts` (`.ts` in `scripts`, `console.*`
 * arguments only).
 *
 * Phase 3 Plan D, Task 2 fix round F2. `src/participation` ships user-facing copy as plain `.ts`
 * exports — `VERIFIED_BADGE_LABEL`, `VERIFIED_BADGE_TOOLTIP`, `TIER_COMPOSITION_LABEL` — and
 * NONE of it is JSX, so it sits outside
 * both existing scans: `room-copy.source.test.ts` only walks `.tsx` files, and this directory has
 * none. Task 2's own report claimed these strings were "swept by `room-copy.source.test.ts`,
 * which reads `src/league-room` since Plan C" — true of the STRINGS ONCE THEY REACH a `.tsx`
 * consumer (`public-league-list.tsx`, `browse-filters.tsx`), false of the SOURCE they are
 * declared in, which is exactly the gap a directory-derived scan is supposed to close rather than
 * leave to whichever consumer happens to render them first.
 *
 * `candidateCopyIn` (not `consoleCopyIn`): it collects every string literal in a file, not only
 * `console.*` arguments — the right net for a directory whose whole surface is exported string
 * constants, not JSX text nodes or terminal output. It also, like every candidate-copy scan in
 * this file, over-collects vocabulary values (`"newcomer"`, `"veteran"`) alongside real copy —
 * cheap, because `copyViolations` only fires on a dash, an accusatory term or a passive
 * construction, none of which belong in an identifier either.
 */
const REPO_ROOT = process.cwd();

const files = sourceFilesIn(["src/participation"], ".ts");

describe("src/participation writes its user-facing copy in the house voice", () => {
  it("finds the files to sweep, so an empty scan can never pass silently", () => {
    // THREE, not four: `contract.ts` held `ParticipationSummary` and nothing else, and it was
    // deleted with `participationFor` (final review F12) when the reviewer found neither had a
    // production consumer. The floor is named rather than derived on purpose — a scan whose floor
    // is "however many files there happen to be" cannot notice a directory going quiet.
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain(join("src", "participation", "composition.ts"));
    expect(files).toContain(join("src", "participation", "tier.ts"));
    expect(files).toContain(join("src", "participation", "verified.ts"));
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });

  it("answers empty for a directory that is not there", () => {
    expect(sourceFilesIn(["src/no-such-participation"], ".ts")).toEqual([]);
  });

  it.each(files)("%s says nothing that breaks the copy rules", (file) => {
    const offenders = candidateCopyIn(readFileSync(join(REPO_ROOT, file), "utf8")).flatMap((text) =>
      copyViolations(text).map((violation) => ({ text, ...violation })),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * THE PROOF OF BITE, so this scan can never become a green test over an extractor that stopped
   * extracting. Reproduces the shape an em dash would actually ship in: a plain string-literal
   * export, the exact shape `TIER_COMPOSITION_LABEL` already uses.
   * Verified live against the real files by injecting an em dash into
   * `TIER_COMPOSITION_LABEL.open` (`"Open — to everyone"`), re-running this file, watching
   * `%s says nothing that breaks the copy rules` for `composition.ts` redden with a `dash`
   * violation naming the injected text, and reverting.
   */
  it("catches a dash injected into a string-literal export, the shape a real violation would ship in", () => {
    const source = 'export const TIER_COMPOSITION_LABEL = {\n  open: "Open — to everyone",\n};';
    expect(candidateCopyIn(source).flatMap(copyViolations)).toContainEqual({ rule: "dash", found: "—" });
  });
});
