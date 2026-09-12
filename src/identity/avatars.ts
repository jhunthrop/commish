import type { IconName } from "@/components/ui/icon";
import { IDENTITY_CONFIG } from "./config";

export type AvatarTone = "accent" | "positive" | "negative" | "warning" | "info" | "neutral";

/** Every `AvatarTone`, in a fixed order — the palette `avatarTone` below hashes into. Order is
 *  part of the contract: reordering this array reassigns every existing tone. */
const AVATAR_TONE_ORDER: readonly AvatarTone[] = ["accent", "positive", "negative", "warning", "info", "neutral"];

/**
 * FNV-1a — the same small, stable string hash `draftOrderFor`'s own `hashString`
 * (`@/draft-service/order.ts`) uses, copied rather than imported: that module's hash seeds a
 * draft shuffle, and this one only picks an index into a six-entry palette.
 */
function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A deterministic tone for any stable string id — the same id resolves to the same tone forever,
 * with no column to migrate. `Crest` (`@/components/ui/crest`) is the one caller today: a
 * league's rail tile and its members' avatars come from this one palette, which is what makes
 * the rail and the room read as one object rather than two colorways (Phase 3.6, Task 3, Step 4).
 */
export function avatarTone(seed: string): AvatarTone {
  return AVATAR_TONE_ORDER[hashSeed(seed) % AVATAR_TONE_ORDER.length]!;
}

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
  // THE PROVIDER'S GENERATED PLACEHOLDER IS AN ABSENCE, and every other image is an image.
  // Resolved HERE, the one place a stored value becomes something renderable, so every surface
  // agrees at once rather than each deciding for itself — and narrowed to the one prefix that is
  // actually a placeholder, because the first cut of this gated ALL remote URLs and took player
  // headshots down with it (see `isProviderPlaceholder`).
  if (value.startsWith(IDENTITY_CONFIG.avatar.allowedUrlPrefix)) {
    return isProviderPlaceholder(value) ? { kind: "initials" } : { kind: "remote", url: value };
  }
  return { kind: "initials" };
}

/**
 * Whether a stored image URL is the identity provider's GENERATED placeholder rather than a
 * picture anybody chose (`IDENTITY_CONFIG.avatar.providerPlaceholderPrefix`).
 *
 * Exported because two sides read it and must agree: `parseAvatarRef` above, which covers the
 * rows already written, and `syncUserFromWorkOS` (`@/lib/auth/user-sync`), which stops writing new
 * ones. A manager who DID upload a photo to the provider keeps it through both.
 *
 * DELIBERATELY NARROW. Whatever else is in this column — a player's headshot from the stats feed
 * on its way through `PlayerFace`, a real uploaded avatar when Plan D lands — is a real image and
 * renders. The regression this shape exists to prevent is the one the blanket version caused:
 * every face in the draft room and the pool fell back to initials in production.
 */
export function isProviderPlaceholder(url: string): boolean {
  return url.startsWith(IDENTITY_CONFIG.avatar.providerPlaceholderPrefix);
}
