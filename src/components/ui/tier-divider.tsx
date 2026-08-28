import type { TierGrade } from "@/design/tokens";
import { MICRO_LABEL } from "./config";

export interface TierDividerProps {
  /** The grade this band opens. Four literals, closed (`TIER_GRADES`, `@/design/tokens`). */
  readonly grade: TierGrade;
  /** What the band is, in the manager's own words: "Elite backs", "Round 3 targets". */
  readonly label: string;
  readonly className?: string;
}

/**
 * The badge's fill and the letter printed on it, per grade — the pairing `TOKENS.tier` designs
 * together, spelled out here as literal Tailwind classes.
 *
 * Written out per grade rather than composed from the grade string, for the reason
 * `PositionBadge`'s own map states: Tailwind ships only the utilities it can see LITERALLY in the
 * source, so a template-built `bg-tier-${grade}` would generate no CSS at all and the band would
 * render as an unfilled rectangle in production while passing every test in development.
 */
const TIER_CLASS: Readonly<Record<TierGrade, string>> = {
  S: "bg-tier-s text-tier-s-on",
  A: "bg-tier-a text-tier-a-on",
  B: "bg-tier-b text-tier-b-on",
  C: "bg-tier-c text-tier-c-on",
};

/**
 * The break between two tiers of a draft board — law 1's grade channel, made of a graded badge, a
 * micro-label, and a rule running out to the edge of the list.
 *
 * WHY THIS IS A CLASS AND NOT AN INLINE STYLE, which is the one real decision in this file. The
 * tier palette is TWO designed palettes over one ladder (`TOKENS.tier`): dark carries the approved
 * mock's bright pigments, and light re-derives the same four hues dark enough that white ink sits
 * on them and the badge still clears WCAG 1.4.11's 3:1 against a near-white page. Choosing between
 * those two in React means reading the resolved theme, and nothing here can — the theme is a
 * `data-theme` attribute on the document plus an OS media query, resolved in CSS, and a server
 * render has no answer at all. An inline style would therefore have had to pick one palette, which
 * in practice means shipping the dark values everywhere and losing the daylight badge entirely.
 *
 * So the four grades reach the DOM as classes over per-theme custom properties (`--commish-tier-*`,
 * emitted by `src/design/generate-css.ts` and aliased in `globals.css`), and the badge repaints
 * itself when the theme switches under it. This is what separates a tier grade from a TEAM colour:
 * a team code arrives at runtime off the stats feed and is unbounded, so it can only ever be an
 * inline style; a grade is one of four literals and can be written out in full.
 *
 * THE LETTER IS THE COLOURBLIND CHANNEL AND IT IS ALWAYS TEXT. Adjacent rungs of this ramp are
 * close in hue on purpose — red, amber, gold, a warmth that cools as the grade falls — which is
 * what makes it read as one ladder rather than four unrelated stickers, and which is exactly why
 * `tokens.test.ts` does not hold tier pairs to the position stickers' pairwise-hue rule. The price
 * of that decision is that the grade is never recoverable from the colour alone, so the letter can
 * never be dropped, dimmed to decoration or replaced by the fill. Without it a manager with
 * deuteranopia sees four bands he cannot rank, which is worse than a board with no tiers at all.
 *
 * The rule is `aria-hidden`: it is the band's geometry, not its content, and a screen reader
 * already hears the grade and the label.
 */
export function TierDivider({ grade, label, className = "" }: TierDividerProps) {
  return (
    <div data-grade={grade} className={`flex items-center gap-2 ${className}`}>
      {/* THE BAND IS A FILLED PLATE, NOT A LETTER BESIDE A LINE (2026-08-28). Rendered rather
          than read, the old shape was a 20px stamp, a grey micro-label and a hairline running to
          the edge — and at sixty rows the hairline was the loudest part of it, so the ladder read
          as a series of separators rather than as bands with names. The reference product the
          founder pointed at fills its break across the name column and it reads instantly.

          So the letter and the label sit on ONE tier-coloured plate, sized to the words. That is
          not a new ground and needs no new contrast solve: `bg-tier-*` with `text-tier-*-on` is
          the exact pairing `tokens.test.ts` already proves at AA body contrast (≥4.5:1) in both
          themes for all four grades, and the label takes the same role the letter does at the
          same size. What changes is how much of it there is.

          It does not get louder than the data it divides. The plate stops at its own text — it
          never spans the row, never repeats per row, and is one 20px line between bands of ten.
          `rounded-sm` and a square-cornered letter keep it a stamp rather than a pill, which is
          still what tells it apart from the position sticker a few pixels below. */}
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-display leading-display ${TIER_CLASS[grade]}`}
      >
        <span className="text-xs font-semibold">{grade}</span>
        <span className={MICRO_LABEL}>{label}</span>
      </span>
      {/* Law 4: the rule takes the leftover width so the band separates two KINDS of thing
          without spending vertical space on a heading block. It stays, quietly, because the plate
          alone floats — but it is now the band's tail rather than its body. `h-px` and the
          decorative `line` role, never `edge` — nothing here is a control. */}
      <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-line" />
    </div>
  );
}
