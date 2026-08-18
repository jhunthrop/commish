import { describe, it, expect } from "vitest";
import { LEAGUE_CONFIG } from "./config";
import { generateInviteCode } from "./invite-code";

describe("generateInviteCode", () => {
  it("is the configured length, drawn only from the configured alphabet", () => {
    let seed = 0;
    const code = generateInviteCode(() => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280));
    expect(code).toHaveLength(LEAGUE_CONFIG.invite.codeLength);
    expect([...code].every((ch) => LEAGUE_CONFIG.invite.alphabet.includes(ch))).toBe(true);
  });

  it("is a pure function of the injected randomness", () => {
    expect(generateInviteCode(() => 0)).toBe(LEAGUE_CONFIG.invite.alphabet[0]!.repeat(LEAGUE_CONFIG.invite.codeLength));
    expect(generateInviteCode(() => 0.999999)).toBe(LEAGUE_CONFIG.invite.alphabet.at(-1)!.repeat(LEAGUE_CONFIG.invite.codeLength));
  });

  it("draws from an alphabet with no character a person could misread", () => {
    for (const ambiguous of ["I", "L", "O", "0", "1"]) {
      expect(LEAGUE_CONFIG.invite.alphabet).not.toContain(ambiguous);
    }
  });
});
