import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import { REVIEW_CONFIG } from "@/reviews/config";
import { MODERATION_CONFIG } from "./config";
import { REMOVAL_REASON_VALUES, isRemovalReason, removalPhraseFor, removalSentenceFor } from "./removal";

interface GrepOptions {
  readonly dirs: readonly string[];
  readonly exclude: RegExp;
}

function walk(dir: string, exclude: RegExp): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, exclude);
    if (!/\.tsx?$/.test(entry.name) || exclude.test(entry.name)) return [];
    return [full];
  });
}

/**
 * Every production file (`.ts`/`.tsx`, not matching `exclude`) under the given repo-root-relative
 * `dirs` whose text matches `pattern` — the same "found by grep rather than by memory" idiom
 * `seed-operator.test.ts`'s own `grepSourceTree` uses for ruling 15, applied here as founder
 * decision #2's own drift tripwire: a second literal report/removal reason list anywhere is the
 * thing this test exists to make impossible. Not a proof against a deliberately obfuscated second
 * copy (a computed string built from concatenated fragments would slip past this regex the same
 * way it would slip past `grepSourceTree`'s), only the ordinary accidental-drift class every
 * other source-scan test in this codebase catches.
 */
function grepSourceTree(pattern: RegExp, { dirs, exclude }: GrepOptions): readonly string[] {
  return dirs
    .flatMap((dir) => walk(join(process.cwd(), dir), exclude))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path))
    .sort();
}

describe("the removal vocabulary's one home", () => {
  it("is the only place the removal vocabulary is written down", () => {
    // Founder decision 2: one vocabulary, two record types. A second literal list anywhere is the
    // thing this test exists to make impossible, so it greps rather than trusting the import graph.
    const literals = grepSourceTree(/"abusive"/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
    expect(literals).toEqual(["src/moderation/config.ts"]);
  });

  it("keeps reviews' shipped vocabulary byte for byte, because members have already read it", () => {
    expect(REVIEW_CONFIG.reportReasons).toEqual([
      { value: "spam", label: "Spam or fake", removalPhrase: "spam or fake content" },
      { value: "abusive", label: "Abusive or harassing", removalPhrase: "abusive or harassing content" },
      { value: "other", label: "Something else", removalPhrase: "breaking the review rules" },
    ]);
    // Round-trips the re-export: `REVIEW_CONFIG.reportReasons` IS `MODERATION_CONFIG.reasons`,
    // not a second array that happens to match it today.
    expect(REVIEW_CONFIG.reportReasons).toBe(MODERATION_CONFIG.reasons);
  });

  it("narrows REMOVAL_REASON_VALUES from string to the closed union", () => {
    // The shipped array is typed `readonly string[]`, which widens and lets a typo past the
    // compiler at every call site. `isRemovalReason` is the guard the script and the route both use.
    expect(isRemovalReason("spam")).toBe(true);
    expect(isRemovalReason("Spam")).toBe(false);
    expect(isRemovalReason("harassment")).toBe(false);
    expect(REMOVAL_REASON_VALUES).toEqual(["spam", "abusive", "other"]);
  });

  it("renders the same phrase and sentence @/reviews/config already shipped, unchanged", () => {
    expect(removalPhraseFor("spam")).toBe("spam or fake content");
    expect(removalPhraseFor("other")).toBe("breaking the review rules");
    expect(removalPhraseFor("not-a-real-reason")).toBe("breaking the review rules");
    expect(removalPhraseFor(null)).toBe("breaking the review rules");
    expect(removalSentenceFor("spam")).toBe("Your review was removed for spam or fake content. It can't be edited.");
  });
});
