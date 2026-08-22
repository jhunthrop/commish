import { describe, expect, it } from "vitest";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { markNoticesReadSchema, resolveFlagSchema } from "./schemas";

describe("markNoticesReadSchema", () => {
  it("accepts one or more notice ids", () => {
    expect(markNoticesReadSchema.safeParse({ noticeIds: ["n1", "n2"] }).success).toBe(true);
  });

  it("refuses an empty list rather than treating it as a no-op", () => {
    const result = markNoticesReadSchema.safeParse({ noticeIds: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Send at least one notice id.");
  });
});

describe("resolveFlagSchema", () => {
  it("accepts every decision this product can carry out today — trade_reversed included, Task 7", () => {
    for (const decision of ["no_action", "warned_user", "content_removed", "trade_reversed"] as const) {
      expect(resolveFlagSchema.safeParse({ decision, note: "n" }).success).toBe(true);
    }
  });

  // `decisionIsAvailable`'s own refine still runs at this boundary (unchanged code, `@/integrity/
  // flags`) — but every declared `ResolutionDecision` is now wired for at least one subject, so
  // there is no longer a decision IN the closed enum this refine can catch. That property moved
  // to `DECISION_WIRED_FOR`'s per-subject axis (`src/integrity/flags.test.ts`'s own vocabulary
  // suite) and to `resolveFlag`'s own subject-aware refusal (`src/integrity-service/flags.test.ts`)
  // — this schema's job is narrower now: reject anything outside the enum entirely, below.
  it("refuses a decision outside the closed enum entirely", () => {
    expect(resolveFlagSchema.safeParse({ decision: "account_restricted", note: "n" }).success).toBe(false);
  });

  // Plan D, Task 5, fix round 1 (Finding 1): `superseded_before_review` IS in the closed enum
  // (`decisionIsAvailable` says the product carries it out) — the boundary refuses it for the
  // narrower reason, `decisionIsOperatorChoosable`, so this is a distinct failure mode from the
  // "outside the enum" refusal above, and gets its own message and its own test.
  it("refuses superseded_before_review from an operator — it is in the enum, but the platform's own word", () => {
    const result = resolveFlagSchema.safeParse({ decision: "superseded_before_review", note: "n" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("This decision is the platform's own, and cannot be chosen by an operator.");
  });

  it("refuses a note past the shared cap, with the same message resolveFlag itself gives", () => {
    const tooLong = "x".repeat(INTEGRITY_CONFIG.moderation.noteMaxLength + 1);
    const result = resolveFlagSchema.safeParse({ decision: "warned_user", note: tooLong });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.`,
    );
  });

  it("accepts a note exactly at the cap", () => {
    const atCap = "x".repeat(INTEGRITY_CONFIG.moderation.noteMaxLength);
    expect(resolveFlagSchema.safeParse({ decision: "no_action", note: atCap }).success).toBe(true);
  });
});
