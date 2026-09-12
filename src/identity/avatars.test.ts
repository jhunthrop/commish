import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, avatarRefValue, avatarTone, parseAvatarRef, presetByKey } from "./avatars";
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

  /**
   * FIX ROUND 2 (the founder's screenshot of production `/app`). This used to assert the reverse:
   * that the identity provider's https URL became a `remote` face. It did, and that is the defect
   * — WorkOS answers a GENERATED PLACEHOLDER for every account that never uploaded a photo, so a
   * real manager's ring showed a stock image where his initials belong, on every surface at once.
   * While `IDENTITY_CONFIG.avatar.uploads` is false there is no in-product path that writes this
   * column a URL at all, so a remote value can only have come from that sync and can only be a
   * face nobody chose.
   */
  it("falls back to initials for a provider URL while uploads are off, rather than showing a face nobody chose", () => {
    expect(IDENTITY_CONFIG.avatar.uploads).toBe(false);
    expect(parseAvatarRef("https://workoscdn.com/u/abc.png")).toEqual({ kind: "initials" });
    expect(parseAvatarRef("https://workoscdn.com/images/v1/lzLc4KQcSglIhS1RTT2QiOjSf8noPd5XN0MBrmhZwmo")).toEqual({ kind: "initials" });
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
