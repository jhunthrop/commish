import type { AvatarTone } from "@/identity/avatars";

/**
 * THE TONE TILE'S ONE SPELLING, shared by the two primitives that draw one: a person's `Avatar`
 * and a league's `Crest`.
 *
 * NO `"use client"`, AND THAT IS THE WHOLE REASON THIS FILE EXISTS. The map lived in
 * `avatar.tsx`, which is a client module (`Avatar` runs an `onError` fallback through
 * `useState`), and `crest.tsx` carries no directive on purpose — `Crest` is a `<span>` with a
 * class on it, the kind of thing a server render should be free to emit. Every export of a
 * `"use client"` module reaches the server as a client-reference proxy, so
 * `AVATAR_TONE_CLASS[tone]` inside a server-rendered `Crest` reads a property off a proxy rather
 * than off the map.
 *
 * The third instance of one shape in a week: `chipClassName` out of `segment-group.tsx`
 * (39c12062, `/browse` lost its filter nav) and `BOARD_FORMAT_QUERY_KEY` out of
 * `scoring-format-picker.tsx` (58649c21, the board dropped every `?format=`). This one was found
 * by `client-boundary.source.test.ts`, the sweep those two bought, before a reader met it.
 *
 * A `.tsx` file with no JSX in it, on purpose, the same as `chip.tsx`: `accent-budget.source.test.ts`
 * sweeps `.tsx` and this map fills `bg-accent`, so a `.ts` module would have dodged that guard on
 * a file extension rather than earning its allowlist entry.
 */

/**
 * Preset tiles reuse the existing token roles rather than inventing a fill for each tone: only
 * `accent` and `negative` have a dedicated `-text` role for a solid fill, so those two get one;
 * the rest render their icon in the tone's own text color on the chalk ground the initials
 * fallback already uses.
 */
export const AVATAR_TONE_CLASS: Readonly<Record<AvatarTone, string>> = {
  accent: "bg-accent text-accent-text",
  negative: "bg-negative text-negative-text",
  positive: "bg-surface text-positive",
  warning: "bg-surface text-warning",
  info: "bg-surface text-info",
  neutral: "bg-surface text-text-muted",
};
