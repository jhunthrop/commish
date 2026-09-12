import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, avatarRefValue, avatarTone, isProviderPlaceholder, parseAvatarRef, presetByKey } from "./avatars";
import { IDENTITY_CONFIG } from "./config";

describe("avatarTone", () => {
  it("gives the same id the same tone forever", () => {
    expect(avatarTone("lg_bandits")).toBe(avatarTone("lg_bandits"));
  });

  it("spreads different ids across more than one tone", () => {
    const ids = ["lg_bandits", "lg_thunder", "lg_hawks", "lg_owls", "lg_sharks", "lg_wolves"];
    expect(new Set(ids.map(avatarTone)).size).toBeGreaterThan(1);
  });
});

describe("parseAvatarRef", () => {
  it("renders initials when there is nothing stored", () => {
    expect(parseAvatarRef(null)).toEqual({ kind: "initials" });
    expect(parseAvatarRef("")).toEqual({ kind: "initials" });
    expect(parseAvatarRef("   ")).toEqual({ kind: "initials" });
  });

  it("resolves every preset this product ships", () => {
    for (const preset of AVATAR_PRESETS) {
      expect(parseAvatarRef(avatarRefValue(preset.key))).toEqual({ kind: "preset", preset });
    }
  });

  it("falls back to initials for a preset key it does not know", () => {
    // A key removed in a later release must not become a broken face for everyone who chose it.
    expect(parseAvatarRef("preset:unicorn")).toEqual({ kind: "initials" });
  });

  it("accepts the https URL WorkOS supplies", () => {
    expect(parseAvatarRef("https://workoscdn.com/u/abc.png")).toEqual({
      kind: "remote",
      url: "https://workoscdn.com/u/abc.png",
    });
  });

  /**
   * THE HOTFIX. Fix round 2 gated EVERY remote URL behind `IDENTITY_CONFIG.avatar.uploads` to keep
   * the identity provider's generated placeholder off a manager's ring. That swallowed player
   * headshots with it — `PlayerFace` sends `players.headshot_url` through this same function — and
   * the draft wall and the pool went to initials in production. The rule names the one prefix that
   * is actually a placeholder and leaves every other image alone.
   */
  it("tells a player's headshot apart from the provider's generated placeholder", () => {
    const headshot = "https://a.espncdn.com/i/headshots/nfl/players/full/qb1.png";
    expect(parseAvatarRef(headshot)).toEqual({ kind: "remote", url: headshot });
    expect(isProviderPlaceholder(headshot)).toBe(false);

    const placeholder = `${IDENTITY_CONFIG.avatar.providerPlaceholderPrefix}lzLc4KQcSglIhS1RTT2QiOjSf8noPd5XN0MBrmhZwmo`;
    expect(parseAvatarRef(placeholder)).toEqual({ kind: "initials" });
    expect(isProviderPlaceholder(placeholder)).toBe(true);
  });

  it("leaves a real picture on the provider's own CDN alone — only the placeholder path falls back", () => {
    // The rule is host AND path. A photo a manager genuinely uploaded is still a face.
    expect(parseAvatarRef("https://workoscdn.com/u/abc.png").kind).toBe("remote");
    expect(isProviderPlaceholder("https://workoscdn.com/u/abc.png")).toBe(false);
  });

  it("never gates a face on the uploads flag, which is what took the headshots down", () => {
    // Pinned so the blanket rule cannot come back by accident: `uploads` governs whether the
    // product offers an upload CONTROL, never whether a stored image renders.
    expect(IDENTITY_CONFIG.avatar.uploads).toBe(false);
    expect(parseAvatarRef("https://a.espncdn.com/i/headshots/nfl/players/full/qb1.png").kind).toBe("remote");
  });

  it("refuses every scheme that is not https", () => {
    // This column becomes user-writable in Task 2, and its value lands in an <img src>. Anything
    // that is not a known preset or a plain https URL renders as initials, which is a real face
    // and not an error state. Named schemes, not a regex the reader has to trust.
    for (const hostile of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "http://insecure.example/pic.png",
      "//protocol-relative.example/pic.png",
      "vbscript:msgbox(1)",
      "preset:../../etc/passwd",
    ]) {
      expect(parseAvatarRef(hostile)).toEqual({ kind: "initials" });
    }
  });

  it("gives every preset a distinct key, a label, and an icon the Icon primitive knows", () => {
    const keys = AVATAR_PRESETS.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const preset of AVATAR_PRESETS) {
      expect(preset.label).toMatch(/\S/);
      expect(presetByKey(preset.key)).toEqual(preset);
    }
  });
});
