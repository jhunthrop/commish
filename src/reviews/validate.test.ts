import { describe, it, expect } from "vitest";
import { REVIEW_CONFIG } from "./config";
import { validateReviewDraft } from "./validate";

const LONG_ENOUGH = "This league is exactly what I wanted from a fantasy platform.";

describe("validateReviewDraft", () => {
  it("accepts a rating in range with a body inside the length window", () => {
    expect(validateReviewDraft({ rating: 3, body: LONG_ENOUGH })).toEqual({ ok: true });
  });

  it("rejects a rating below the floor", () => {
    const result = validateReviewDraft({ rating: 0, body: LONG_ENOUGH });
    expect(result).toEqual({ ok: false, message: "Choose a rating from 1 to 5." });
  });

  it("rejects a rating above the ceiling", () => {
    const result = validateReviewDraft({ rating: 6, body: LONG_ENOUGH });
    expect(result).toEqual({ ok: false, message: "Choose a rating from 1 to 5." });
  });

  it("rejects a non-integer rating", () => {
    const result = validateReviewDraft({ rating: 3.5, body: LONG_ENOUGH });
    expect(result.ok).toBe(false);
  });

  it("rejects a body shorter than the floor, after trimming", () => {
    const result = validateReviewDraft({ rating: 5, body: "   too short   " });
    expect(result).toEqual({
      ok: false,
      message: `Say a little more, at least ${REVIEW_CONFIG.body.minLength} characters.`,
    });
  });

  // Both trim cases below are written so the PADDING is what decides the outcome. The two that
  // used to carry these names exercised trimming only on the accept side, with bodies long
  // enough to pass either way — so deleting `.trim()` and rating the raw length passed all eight
  // tests in this file. These are the two that cannot.
  it("refuses a body whose whitespace is the only thing carrying it over the floor", () => {
    const oneShort = "x".repeat(REVIEW_CONFIG.body.minLength - 1);
    const padded = `   ${oneShort}   `; // raw length is over the floor; trimmed length is not.
    expect(padded.length).toBeGreaterThanOrEqual(REVIEW_CONFIG.body.minLength);
    expect(validateReviewDraft({ rating: 4, body: padded })).toEqual({
      ok: false,
      message: `Say a little more, at least ${REVIEW_CONFIG.body.minLength} characters.`,
    });
  });

  it("accepts a body whose whitespace is the only thing carrying it over the ceiling", () => {
    const atCeiling = "x".repeat(REVIEW_CONFIG.body.maxLength);
    const padded = `  ${atCeiling}  `; // raw length is over the ceiling; trimmed length is exactly it.
    expect(padded.length).toBeGreaterThan(REVIEW_CONFIG.body.maxLength);
    expect(validateReviewDraft({ rating: 4, body: padded })).toEqual({ ok: true });
  });

  it("rejects a body longer than the ceiling", () => {
    const result = validateReviewDraft({ rating: 5, body: "x".repeat(REVIEW_CONFIG.body.maxLength + 1) });
    expect(result).toEqual({
      ok: false,
      message: `Keep it under ${REVIEW_CONFIG.body.maxLength} characters.`,
    });
  });

  it("accepts a body exactly at each boundary", () => {
    expect(validateReviewDraft({ rating: 1, body: "x".repeat(REVIEW_CONFIG.body.minLength) })).toEqual({ ok: true });
    expect(validateReviewDraft({ rating: 5, body: "x".repeat(REVIEW_CONFIG.body.maxLength) })).toEqual({ ok: true });
  });

  it("rates the trimmed length, not the raw length, at the floor boundary", () => {
    const padded = `  ${"x".repeat(REVIEW_CONFIG.body.minLength)}  `;
    expect(validateReviewDraft({ rating: 4, body: padded })).toEqual({ ok: true });
  });
});
