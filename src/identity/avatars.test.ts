import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, avatarRefValue, parseAvatarRef, presetByKey } from "./avatars";

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
