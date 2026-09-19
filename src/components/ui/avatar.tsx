"use client";

import { useEffect, useState } from "react";
import { parseAvatarRef } from "@/identity/avatars";
import { AVATAR_TONE_CLASS } from "./avatar-tone";
import { Icon } from "./icon";

/**
 * SIDELINE'S FACE STEPS. `sm` (28) rides a message bubble, `md` (32) a row or a nav, `lg` (40) a
 * stack of faces on a card, `xl` (52) sits inside a 56px headshot ring, `2xl` (96) is the account
 * room's own header face, and `3xl` (128) sits inside the 132px ring on a player's own page.
 * `PlayerFace` pairs each ring with one of these; nothing else reaches for the two largest.
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/** Which of Sideline's rings the face wears: amber for you, rose for your opponent this week. */
export type AvatarRing = "self" | "rival";

export interface AvatarProps {
  /** The person's display name — the source of the initials fallback. */
  readonly name: string;
  /** The STORED avatar ref (`users.avatar_url`), not a URL. `parseAvatarRef` decides what it is. */
  readonly avatar?: string | null;
  readonly size?: AvatarSize;
  /** Provide to make the avatar an accessible image; omit to leave it decorative. */
  readonly label?: string;
  /** A 2px ring in your colour or your rival's. A club ring is `PlayerFace`'s job, not this one. */
  readonly ring?: AvatarRing;
  readonly className?: string;
}

const SIZE: Readonly<Record<AvatarSize, string>> = {
  /** 24, inside the 28px ring a dense sheet row carries (the approved sheet's 26px face). */
  xs: "size-6 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-13 text-lg",
  /** 96 — the account room's own header face (Sideline, 2026-09-11). The scale had no step
   *  between 52 and 128 and the account room wanted neither: at 128 a face is a hero image, and
   *  the hero of the account room is the manager's NAME beside their face. */
  "2xl": "size-24 text-2xl",
  /** 128 — the player page's own hero, inside `PlayerFace`'s 132px club ring. */
  "3xl": "size-32 text-3xl",
};

const ICON_SIZE: Readonly<Record<AvatarSize, number>> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 26,
  "2xl": 48,
  "3xl": 56,
};

const RING: Readonly<Record<AvatarRing, string>> = {
  self: "ring-2 ring-self",
  rival: "ring-2 ring-negative",
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
 * A person's face in a circle: their photo, their chosen preset, or their initials in the display
 * face on chalk. Decorative by default (it almost always sits beside the same person's name, and
 * `Manager` guarantees that); pass `label` when it stands alone.
 *
 * A remote image that fails to load falls back to the initials, keyed on the url so a new ref
 * gets its own chance. That one state is why this is a client component.
 */
export function Avatar({ name, avatar, size = "md", label, ring, className = "" }: AvatarProps) {
  const ref = parseAvatarRef(avatar ?? null);
  const remoteUrl = ref.kind === "remote" ? ref.url : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    setFailedUrl(null);
  }, [remoteUrl]);
  const showImage = remoteUrl !== null && failedUrl !== remoteUrl;
  const a11y = label === undefined ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  const ringClass = ring === undefined ? "" : ` ${RING[ring]}`;
  return (
    <span
      {...a11y}
      data-ring={ring}
      className={
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill " +
        `bg-surface font-display font-bold text-text-muted ${SIZE[size]}${ringClass} ${className}`.trimEnd()
      }
    >
      {ref.kind === "preset" ? (
        <span className={`flex size-full items-center justify-center ${AVATAR_TONE_CLASS[ref.preset.tone]}`}>
          <Icon name={ref.preset.icon} size={ICON_SIZE[size]} />
        </span>
      ) : showImage ? (
        // Lazy and async (draft-room performance round, item 6): a room opens with a hundred-odd
        // headshots, and the browser fetches the ones near the viewport first, the rest as they
        // scroll near, none of them holding the first paint.
        // eslint-disable-next-line @next/next/no-img-element -- parseAvatarRef already enforces the https-only allowlist; next/image is still not used because that would need a per-host allowlist we do not have
        <img src={remoteUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover object-top" onError={() => setFailedUrl(remoteUrl)} />
      ) : (
        <span>{initialsFor(name)}</span>
      )}
    </span>
  );
}
