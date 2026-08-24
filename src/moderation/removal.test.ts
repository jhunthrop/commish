import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import { REVIEW_CONFIG } from "@/reviews/config";
import { MODERATION_CONFIG } from "./config";
import { REMOVAL_REASON_VALUES, chatRemovalPhraseFor, removalPhraseFor, removalSentenceFor } from "./removal";

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
    // `removalPhrase` (reviews' own reading) is unchanged from what shipped before fix round 1.
    // `chatRemovalPhrase` (fix round 1) is the new, chat-domain sibling field — present on every
    // entry, but reviews' own `removalPhraseFor` never reads it.
    expect(REVIEW_CONFIG.reportReasons).toEqual([
      { value: "spam", label: "Spam or fake", removalPhrase: "spam or fake content", chatRemovalPhrase: "spam or fake content" },
      { value: "abusive", label: "Abusive or harassing", removalPhrase: "abusive or harassing content", chatRemovalPhrase: "abusive or harassing content" },
      { value: "other", label: "Something else", removalPhrase: "breaking the review rules", chatRemovalPhrase: "breaking the chat rules" },
    ]);
    // Round-trips the re-export: `REVIEW_CONFIG.reportReasons` IS `MODERATION_CONFIG.reasons`,
    // not a second array that happens to match it today.
    expect(REVIEW_CONFIG.reportReasons).toBe(MODERATION_CONFIG.reasons);
  });

  it("keeps REMOVAL_REASON_VALUES narrowed to the closed union", () => {
    // `@/reviews/config`'s re-exported array is deliberately widened back to `readonly string[]`
    // (so `scripts/remove-review.ts`'s own `.includes` check keeps compiling unchanged) — THIS
    // one stays narrow, which is the whole reason the two exports are not the same binding.
    expect(REMOVAL_REASON_VALUES).toEqual(["spam", "abusive", "other"]);
  });

  it("renders the same phrase and sentence @/reviews/config already shipped, unchanged", () => {
    expect(removalPhraseFor("spam")).toBe("spam or fake content");
    expect(removalPhraseFor("other")).toBe("breaking the review rules");
    expect(removalPhraseFor("not-a-real-reason")).toBe("breaking the review rules");
    expect(removalPhraseFor(null)).toBe("breaking the review rules");
    expect(removalSentenceFor("spam")).toBe("We removed your review for spam or fake content. It cannot be edited.");
  });

  /**
   * Fix round 1 (review HIGH): `removalPhraseFor`'s generic fallback ("breaking the review
   * rules") was leaking into chat's own removal notice and, before the same round's other fix,
   * the room-visible tombstone. `chatRemovalPhraseFor` is the chat-domain twin: identical for the
   * two content-neutral reasons, different for the catch-all one.
   */
  it("renders a chat-domain fallback for the catch-all reason, and the same content-neutral phrases everywhere else", () => {
    expect(chatRemovalPhraseFor("spam")).toBe("spam or fake content");
    expect(chatRemovalPhraseFor("abusive")).toBe("abusive or harassing content");
    expect(chatRemovalPhraseFor("other")).toBe("breaking the chat rules");
    expect(chatRemovalPhraseFor("not-a-real-reason")).toBe("breaking the chat rules");
    expect(chatRemovalPhraseFor(null)).toBe("breaking the chat rules");
    // Never reviews' own words, for a reason that maps to the catch-all in either domain.
    expect(chatRemovalPhraseFor("other")).not.toBe(removalPhraseFor("other"));
  });
});
