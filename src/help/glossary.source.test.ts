import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn } from "@/integrity/test-support";
import { GLOSSARY, type TermKey } from "./glossary";

/**
 * Task 15 (the backend-leverage inventory) found ten of twenty glossary terms with no `InfoTip`
 * caller anywhere in the product. The fix is not to delete them — they are correct definitions of
 * things this product genuinely has — and not to leave them unenforced: it is to make "unsurfaced"
 * a decision somebody makes on purpose, with a reason, in a list a reviewer can read. A term with
 * neither a caller nor an entry here fails this file's first test, which is the point.
 *
 * Three land on the parent plan's league space (Task 11): `stake-tier`, `matchup` and
 * `standings-record` are read off `standings-table.tsx`, `matchup-panel.tsx` and
 * `league-terms-panel.tsx`, all three already in that task's Files block, and the assignment is
 * recorded there rather than duplicated as a step here (Task 15 Step 4's ledger note).
 *
 * Seven are format vocabulary — `ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`,
 * `snake-draft` and `auction-draft` — and land on the league-rules page this addendum's Task 21
 * Step 4 creates, which names them explicitly as "where the format vocabulary lands... and
 * Task 15 Step 4's orphan glossary terms... get their first real caller."
 */
const UNSURFACED: Readonly<Partial<Record<TermKey, string>>> = {
  "stake-tier": "Parent Task 11: the league-terms panel it retones is the honest home, not built yet.",
  matchup: "Parent Task 11: the matchup panel it retones is the honest home, not built yet.",
  "standings-record": "Parent Task 11: the standings table it retones is the honest home, not built yet.",
  ppr: "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4 — its first real caller.",
  "half-ppr": "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4.",
  "te-premium": "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4.",
  "custom-scoring": "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4.",
  flex: "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4.",
  "snake-draft": "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4.",
  "auction-draft": "Format vocabulary. Lands on the league-rules page, addendum Task 21 Step 4.",
};

/** Every surface a manager can actually be looking at when they might want a term explained.
 *  Directory-derived, the same discipline `room-copy.source.test.ts` already established for the
 *  copy sweeps: a new surface is covered the moment it exists, never only when its author
 *  remembers to add a describe block. */
const SURFACE_DIRS = ["src/app", "src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room"];

const REPO_ROOT = process.cwd();

function infoTipTermsUsed(): ReadonlySet<string> {
  const used = new Set<string>();
  for (const file of sourceFilesIn(SURFACE_DIRS, ".tsx")) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const match of text.matchAll(/term="([\w-]+)"/g)) used.add(match[1]!);
  }
  return used;
}

describe("every glossary term is wired to an InfoTip or accounted for", () => {
  it("keeps every glossary term either wired to an InfoTip or listed with a reason", () => {
    const used = infoTipTermsUsed();
    for (const key of Object.keys(GLOSSARY) as TermKey[]) {
      expect(used.has(key) || key in UNSURFACED, `Glossary term "${key}" has no InfoTip caller and no stated reason.`).toBe(true);
    }
  });

  it("never lists a term as unsurfaced while something actually renders it", () => {
    // The reverse direction, which is what stops the allowlist becoming a graveyard: a term that
    // gets wired up in a later task must be deleted from UNSURFACED in that same commit, and this
    // is the assertion that makes forgetting to do so a failing test rather than a stale comment.
    const used = infoTipTermsUsed();
    for (const key of Object.keys(UNSURFACED) as TermKey[]) {
      expect(used.has(key), `"${key}" is listed in UNSURFACED but an InfoTip already renders it — remove the entry.`).toBe(false);
    }
  });

  it("finds real surfaces to scan, so an empty scan can never pass silently", () => {
    const files = sourceFilesIn(SURFACE_DIRS, ".tsx");
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });
});
