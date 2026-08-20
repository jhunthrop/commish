import { describe, expect, it } from "vitest";
import { INTEGRITY_CONFIG } from "./config";
import { NOTICE_SAMPLES, NOTICE_TEMPLATES, renderNotice, type NoticeType } from "./notices";

const TYPES = Object.keys(NOTICE_TEMPLATES) as readonly NoticeType[];

describe("NOTICE_TEMPLATES", () => {
  it("renders a title and a body for every type this product can send", () => {
    for (const type of TYPES) {
      const notice = renderNotice(type, NOTICE_SAMPLES[type]);
      expect(notice.title).toMatch(/\S/);
      expect(notice.body).toMatch(/\S/);
    }
  });

  it("never accuses the member of anything", () => {
    // The spec's denylist check. It runs over OUR words, rendered with a neutral sample context:
    // the one place member-visible text comes from outside this file is the operator's own
    // removal reason, which is quoted verbatim on purpose (the same call `removalPhraseFor`
    // already made in Phase 2) and must not be silently filtered.
    for (const type of TYPES) {
      const { title, body } = renderNotice(type, NOTICE_SAMPLES[type]);
      const text = `${title} ${body}`.toLowerCase();
      for (const term of INTEGRITY_CONFIG.notices.accusatoryTerms) {
        expect(text).not.toContain(term);
      }
    }
  });

  it("uses no em-dash, because this file is nothing but user-facing copy", () => {
    for (const type of TYPES) {
      const { title, body } = renderNotice(type, NOTICE_SAMPLES[type]);
      expect(`${title} ${body}`).not.toMatch(/[—–]/);
    }
  });

  // Fix round 1, FIX 6: the founder's active-voice rule, beside the em-dash and denylist
  // sweeps above so a future template that slips back into "was made"/"was removed"/"is kept"
  // fails mechanically rather than waiting for a reviewer to reread the copy.
  it("never uses a passive construction — the platform names itself as the one who acted", () => {
    for (const type of TYPES) {
      const { title, body } = renderNotice(type, NOTICE_SAMPLES[type]);
      const text = `${title} ${body}`.toLowerCase();
      for (const phrase of INTEGRITY_CONFIG.notices.passiveConstructions) {
        expect(text).not.toContain(phrase);
      }
    }
  });

  it("says what happened and what it means, in the second person, without jargon", () => {
    const autoPick = renderNotice("draft_auto_picked", NOTICE_SAMPLES.draft_auto_picked);
    expect(autoPick.title).toBe("We made your pick for you");
    expect(autoPick.body).toBe(
      "The clock ran out on pick 24 in Sunday Money, so we used your queue and drafted Bijan Robinson (RB). Set your queue before your next draft so this doesn't happen again.",
    );

    const removed = renderNotice("review_removed", NOTICE_SAMPLES.review_removed);
    expect(removed.title).toBe("We removed your review");
    expect(removed.body).toBe("An operator removed your review. We keep your review on file exactly as you wrote it.");
  });

  it("fails the type checker rather than the reader when a type has no template", () => {
    // NOTICE_TEMPLATES is a Record over the full union, so adding a NoticeType without adding
    // its copy does not compile. Asserted here too so the property is visible in the suite.
    expect([...TYPES].sort()).toEqual(["draft_auto_picked", "review_removed"]);
  });
});
