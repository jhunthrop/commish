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
  it("accepts every decision this product can carry out today", () => {
    for (const decision of ["no_action", "warned_user", "content_removed"] as const) {
      expect(resolveFlagSchema.safeParse({ decision, note: "n" }).success).toBe(true);
    }
  });

  it("refuses a decision no plan in this phase owns, at the boundary, naming the field", () => {
    const result = resolveFlagSchema.safeParse({ decision: "trade_reversed", note: "n" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("This product can't carry out that decision yet.");
    expect(result.error?.issues[0]?.path).toEqual(["decision"]);
  });

  it("refuses a decision outside the closed enum entirely", () => {
    expect(resolveFlagSchema.safeParse({ decision: "account_restricted", note: "n" }).success).toBe(false);
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
