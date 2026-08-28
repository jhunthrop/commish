"use client";

import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { Icon } from "@/components/ui/icon";
import type { LiveState } from "../contract";

export interface LiveStatePillProps {
  readonly liveState: LiveState | null;
}

/**
 * The top bar's one live fact (Phase 3.6, Task 10, Step 3) — ICON-ONLY (Task 13, Step 1c, a
 * reconciliation review follow-up). The pill used to print its whole sentence ("Sunday · 7 games
 * live") and was hidden below `sm` to make room for it, which is the exact regression `TopBar`'s
 * own docblock already warns about: a breakpoint is not the fix, because it drops the live-game
 * signal on precisely the device people watch games beside. The fix is the discipline `TopBar`
 * already applies to its OTHER controls (`NoticeInbox`'s trigger, the Queue link): icon-only AT
 * EVERY WIDTH, unconditionally, with the sentence carried as the accessible name rather than as
 * visible text. A glyph (`flame`, already in `ICONS` — this plan's one new icon was spent
 * elsewhere) plus the live count is what a sighted visitor sees; a screen reader hears the full
 * sentence, unchanged.
 *
 * NOT `Badge`/`StatPill`: this row's own 360px budget (Task 13's own 360px battery caught the
 * regression, operator + a heavily-notified account + a live window is the row's real worst
 * case) has no room left for a chip's padding and glow ring, so this renders the SAME bare,
 * no-background shape `NoticeInbox`'s own icon+count trigger already uses in this exact row —
 * consistent with its neighbors rather than a second, heavier idiom.
 *
 * Renders NOTHING when `liveState` is `null` (ruling 12: nothing live means no pill, never one
 * that pulses on a Tuesday in July).
 *
 * The pulse is a real reduced-motion branch, not a cosmetic one (Task 13, Step 5): the pill still
 * renders and still announces under `prefers-reduced-motion`, it simply stops animating — the
 * same "the fact stays, the motion goes" rule `Celebration` already keeps.
 *
 * The pulse lives on the GLYPH ONLY, never on the digit (Task 13's own axe pass caught this by
 * running the real animation, not just the numbers): `animate-pulse` dips opacity to 50% at its
 * midpoint, and a role's contrast against `surface` is proven at FULL opacity only
 * (`tokens.test.ts`) — a readable count riding the same dip fails color-contrast for roughly half
 * of every cycle. The icon is decorative (`aria-hidden` by default, no `label`), so it dipping is
 * free; the count stays at a constant, always-compliant opacity.
 *
 * GAMEDAY, LAW 1: IT IS `negative`, THE LIVE FAMILY, AND IT USED TO BE `accent`. Colour is a
 * legend and each of the six channels has exactly one meaning: green means MONEY (an entry fee, a
 * seat filling, the fill of a verb) and red is the whole LIVE family — a draft clock tightening,
 * a live chip's dot, a game happening right now. A flame in the money pigment says "there is money
 * here" to anyone reading the legend rather than the words, which is precisely what law 1 exists
 * to make possible. This is the same correction the app chrome took in two other places, and it is
 * the most-seen instance of the mistake in the product: this pill renders in `TopBar`, on every
 * signed-in page. `GameStateChip`'s live state and `Countdown`'s `hot` tone already spend
 * `negative` for the identical fact, so this is a third surface joining one channel, not a fourth
 * opinion about what live looks like.
 */
export function LiveStatePill({ liveState }: LiveStatePillProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (liveState === null) return null;

  const gameWord = liveState.gamesLive === 1 ? "game" : "games";
  const sentence = `${liveState.weekday} · ${liveState.gamesLive} ${gameWord} live`;

  return (
    <>
      <span className="flex items-center gap-0.5 text-negative">
        <Icon name="flame" size={16} className={reducedMotion ? "" : "animate-pulse"} />
        <span aria-hidden="true" className="font-mono text-xs font-semibold tabular-nums">
          {liveState.gamesLive}
        </span>
      </span>
      {/* The icon is decorative and the digit is `aria-hidden` (it is folded into this sentence),
          so this `sr-only` sibling is the one thing a screen reader announces — the same
          "visible digits, hidden sentence" shape `Countdown` already uses. */}
      <span className="sr-only">{sentence}</span>
    </>
  );
}
