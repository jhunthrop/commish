import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn } from "@/integrity/test-support";
import { GLOSSARY, type TermKey } from "./glossary";

/**
 * Task 15 (the backend-leverage inventory) found ten of twenty glossary terms with no `InfoTip`
 * caller anywhere in the product. The fix was not to delete them — they are correct definitions
 * of things this product genuinely has — and not to leave them unenforced: it is to make
 * "unsurfaced" a decision somebody makes on purpose, with a reason, in a list a reviewer can
 * read. A term with neither a caller nor an entry here fails this file's first test, which is
 * the point.
 *
 * Three landed on the parent plan's league space (Task 11): `stake-tier` on
 * `league-terms-panel.tsx`'s Stake row, `matchup` on `matchup-panel.tsx`'s own eyebrow label
 * (not `matchup-scoreboard.tsx`, which is ALSO `HomeLeagueCard`'s dense hero and pins "no button
 * at all" for a league with nothing pending), and `standings-record` on `standings-table.tsx`'s
 * Record column header.
 *
 * The remaining seven were format vocabulary — `ppr`, `half-ppr`, `te-premium`, `custom-scoring`,
 * `flex`, `snake-draft` and `auction-draft` — with no page to land on until one existed. The
 * addendum's Task 21 Step 4 built that page (`src/app/league-rules/page.tsx`) and wired all
 * seven there, in the same commit this allowlist emptied: the second test below fails a term
 * left listed here once something actually renders it, so leaving these seven in place after
 * wiring them was never an option.
 *
 * Task 10 (E10) moved those same seven off `InfoTip` and onto `TermLink` — a plain in-page
 * anchor down to that page's own `GlossarySection`, since a reading page reads and does not need
 * a second control to click open mid-sentence. The scan below never cared which component held
 * the `term` prop, only that a real JSX caller carries it, so this stayed a rename in the prose
 * below rather than a change to what the test enforces.
 *
 * The allowlist itself stays — empty is not the same as deleted — because the mechanism it
 * enforces (an unwired term is a decision someone made on purpose, not a silent gap) outlives
 * any one term's own unsurfaced window.
 */
// EMPTY, and it should stay that way. `playoffs` sat here from the no-tips ruling until
// `/league-rules` grew the bracket section that entry was waiting on (Sunday v5, 2026-08-28) —
// the entry is deleted in the same commit that wired it, which is the discipline the reverse
// assertion below exists to enforce.
const UNSURFACED: Readonly<Partial<Record<TermKey, string>>> = {};

/** Every surface a manager can actually be looking at when they might want a term explained.
 *  Directory-derived, the same discipline `room-copy.source.test.ts` already established for the
 *  copy sweeps: a new surface is covered the moment it exists, never only when its author
 *  remembers to add a describe block. */
const SURFACE_DIRS = ["src/app", "src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room"];

const REPO_ROOT = process.cwd();

/**
 * Any JSX caller passing a real `TermKey` through a `term` prop counts as wired — `InfoTip`'s
 * click-to-reveal trigger and `TermLink`'s (`@/app/league-rules/term-link`) plain in-page anchor
 * both qualify, and neither is named here by design: a third way to wire a term some future page
 * invents needs no change to this scan, only a `term="key"` prop of its own.
 */
function glossaryTermsWired(): ReadonlySet<string> {
  const used = new Set<string>();
  for (const file of sourceFilesIn(SURFACE_DIRS, ".tsx")) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const match of text.matchAll(/term="([\w-]+)"/g)) used.add(match[1]!);
  }
  return used;
}

describe("every glossary term is wired to a caller or accounted for", () => {
  it("keeps every glossary term either wired to a real caller or listed with a reason", () => {
    const used = glossaryTermsWired();
    for (const key of Object.keys(GLOSSARY) as TermKey[]) {
      expect(used.has(key) || key in UNSURFACED, `Glossary term "${key}" has no wired caller and no stated reason.`).toBe(true);
    }
  });

  it("never lists a term as unsurfaced while something actually renders it", () => {
    // The reverse direction, which is what stops the allowlist becoming a graveyard: a term that
    // gets wired up in a later task must be deleted from UNSURFACED in that same commit, and this
    // is the assertion that makes forgetting to do so a failing test rather than a stale comment.
    const used = glossaryTermsWired();
    for (const key of Object.keys(UNSURFACED) as TermKey[]) {
      expect(used.has(key), `"${key}" is listed in UNSURFACED but something already renders it — remove the entry.`).toBe(false);
    }
  });

  it("finds real surfaces to scan, so an empty scan can never pass silently", () => {
    const files = sourceFilesIn(SURFACE_DIRS, ".tsx");
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });
});
