import type { IconName } from "@/components/ui/icon";
import { IDENTITY_CONFIG } from "./config";

export type AvatarTone = "accent" | "positive" | "negative" | "warning" | "neutral";

export type AvatarPresetKey =
  | "shield" | "flame" | "anchor" | "rocket" | "crown" | "bolt" | "trophy" | "clover";

export interface AvatarPreset {
  readonly key: AvatarPresetKey;
  /** The visible name in the picker and the avatar's accessible label. */
  readonly label: string;
  readonly icon: IconName;
  readonly tone: AvatarTone;
}

/**
 * A preset is an icon and a pigment. Both already exist in the design system, so a face costs
 * no object store, no CDN and no bytes over the wire beyond what the app already ships. That is
 * the entire reason this half of Step 15 lands in a plan with no founder-supplied resources.
 *
 * Eight, not thirty: a picker a manager can scan in one glance beats a wall they scroll past.
 */
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { key: "shield", label: "Shield", icon: "shield", tone: "accent" },
  { key: "flame", label: "Flame", icon: "flame", tone: "negative" },
  { key: "anchor", label: "Anchor", icon: "anchor", tone: "neutral" },
  { key: "rocket", label: "Rocket", icon: "rocket", tone: "warning" },
  { key: "crown", label: "Crown", icon: "crown", tone: "warning" },
  { key: "bolt", label: "Bolt", icon: "bolt", tone: "accent" },
  { key: "trophy", label: "Trophy", icon: "trophy", tone: "positive" },
  { key: "clover", label: "Clover", icon: "clover", tone: "positive" },
];

const BY_KEY: ReadonlyMap<string, AvatarPreset> = new Map(AVATAR_PRESETS.map((p) => [p.key, p]));

export function presetByKey(key: string): AvatarPreset | undefined {
  return BY_KEY.get(key);
}

export function avatarRefValue(key: AvatarPresetKey): string {
  return `${IDENTITY_CONFIG.avatar.presetPrefix}${key}`;
}

export type AvatarRef =
  | { readonly kind: "preset"; readonly preset: AvatarPreset }
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "initials" };

/**
 * The one place a stored avatar value becomes something renderable.
 *
 * The default in every unrecognized case is `initials`, never an error and never a broken image:
 * `Avatar` always has a name to fall back to, so "we do not know what this is" and "this person
 * has not chosen" produce the same, perfectly fine, face.
 *
 * Only `https://` is ever handed to an `<img src>`. This column is user-writable after Task 2,
 * and an avatar URL is the shortest path from a text field to script execution in every other
 * manager's browser.
 */
export function parseAvatarRef(stored: string | null): AvatarRef {
  const value = (stored ?? "").trim();
  if (value === "") return { kind: "initials" };
  if (value.startsWith(IDENTITY_CONFIG.avatar.presetPrefix)) {
    const preset = presetByKey(value.slice(IDENTITY_CONFIG.avatar.presetPrefix.length));
    return preset === undefined ? { kind: "initials" } : { kind: "preset", preset };
  }
  if (value.startsWith(IDENTITY_CONFIG.avatar.allowedUrlPrefix)) return { kind: "remote", url: value };
  return { kind: "initials" };
}
