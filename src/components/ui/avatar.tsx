export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** The person's display name — the source of the initials fallback. */
  readonly name: string;
  readonly src?: string | null;
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
export function Avatar({ name, src, size = "md", label, className = "" }: AvatarProps) {
  const a11y = label === undefined ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return (
    <span
      {...a11y}
      className={
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill " +
        `border border-border bg-surface-elevated font-semibold text-text-primary ${SIZE[size]} ${className}`
      }
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar URLs are arbitrary remote hosts; next/image would need a per-host allowlist we do not have in Phase 1
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span>{initialsFor(name)}</span>
      )}
    </span>
  );
}
