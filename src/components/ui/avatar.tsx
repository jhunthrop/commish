import { parseAvatarRef, type AvatarTone } from "@/identity/avatars";
import { Icon } from "./icon";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** The person's display name — the source of the initials fallback. */
  readonly name: string;
  /** The STORED avatar ref (`users.avatar_url`), not a URL. `parseAvatarRef` decides what it is. */
  readonly avatar?: string | null;
  readonly size?: AvatarSize;
  /** Provide to make the avatar an accessible image; omit to leave it decorative. */
  readonly label?: string;
  readonly className?: string;
}

const SIZE: Readonly<Record<AvatarSize, string>> = {
  sm: "size-6 text-xs",
  md: "size-8 text-sm",
  lg: "size-12 text-lg",
};

const ICON_SIZE: Readonly<Record<AvatarSize, number>> = {
  sm: 14,
  md: 18,
  lg: 26,
};

/**
 * Preset tiles reuse the existing token roles rather than inventing a fill for each tone: only
 * `accent` and `negative` have a dedicated `-text` role for a solid fill (see
 * docs/design-system.md, "Semantic-on-fill"), so those two get one; `positive`/`warning`/`info`/
 * `neutral` render their icon in the tone's own text color on the same neutral surface the
 * initials fallback already uses — the same choice `Badge` makes for the tones it does not fill.
 *
 * Exported because `Crest` (`./crest`) fills its own tile from this SAME map — a league's crest
 * and its members' avatars share one palette (Phase 3.6, Task 3, Step 4), which means one map,
 * not two copies that could drift.
 */
export const AVATAR_TONE_CLASS: Readonly<Record<AvatarTone, string>> = {
  accent: "bg-accent text-accent-text",
  negative: "bg-negative text-negative-text",
  positive: "bg-surface-elevated text-positive",
  warning: "bg-surface-elevated text-warning",
  info: "bg-surface-elevated text-info",
  neutral: "bg-surface-elevated text-text-muted",
};

/** First letter of the first and last words, upper-cased. "Ada Byron Lovelace" → "AL". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Decorative by default — an avatar almost always sits beside the same person's name, and
 * announcing it twice is noise. Pass `label` when the avatar stands alone.
 */
export function Avatar({ name, avatar, size = "md", label, className = "" }: AvatarProps) {
  const ref = parseAvatarRef(avatar ?? null);
  const a11y = label === undefined ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return (
    <span
      {...a11y}
      className={
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill " +
        `border border-line bg-surface-elevated font-semibold text-text-primary ${SIZE[size]} ${className}`
      }
    >
      {ref.kind === "preset" ? (
        <span className={`flex size-full items-center justify-center ${AVATAR_TONE_CLASS[ref.preset.tone]}`}>
          <Icon name={ref.preset.icon} size={ICON_SIZE[size]} />
        </span>
      ) : ref.kind === "remote" ? (
        // eslint-disable-next-line @next/next/no-img-element -- parseAvatarRef already enforces the https-only allowlist; next/image is still not used because that would need a per-host allowlist we do not have
        <img src={ref.url} alt="" className="size-full object-cover" />
      ) : (
        <span>{initialsFor(name)}</span>
      )}
    </span>
  );
}
