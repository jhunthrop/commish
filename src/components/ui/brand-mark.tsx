/**
 * THE WHISTLE, the product's own mark (founder-approved, brand adoption pass). Transcribed
 * verbatim from the design asset's paths (`commish-mark.svg` / `commish-mark-light.svg`, both
 * outside the repo) but recolored to design-system TOKENS rather than the asset's own literal
 * hexes — `no-raw-color.source.test.ts` is the reason: `src/design/tokens.ts` is the only file
 * allowed to invent a color, and every other file spends one by NAME. The two source SVGs differ
 * only in their stroke colorway per theme; here the theme swap already happens for free, the
 * same way `Icon`'s `currentColor` strokes do, so ONE markup serves both themes:
 *
 * - the barrel/chamber silhouette fills `surfaceRaised` — the same "a thing lifted off its
 *   surface" role a card or a row uses. In dark the fill visibly lifts (#131B2A over #05070C);
 *   in light `surfaceRaised` is white on paper, a near-invisible step, and the `textPrimary`
 *   outline below is what carries the silhouette there — the fill is along for consistency of
 *   role, not doing light mode's work.
 * - the outline stroke is `textPrimary` — floodlit ink, same role the wordmark beside it renders
 *   in.
 * - the mouth notch and the chamber disc are `accent` — amber at night, brand blue in daylight,
 *   the theme system's own swap (`--color-accent`), never hardcoded.
 */

export interface BrandMarkProps {
  readonly size?: number;
  readonly className?: string;
  /** When provided the mark is announced as an image; otherwise it is decorative — the same
   *  contract `Icon` keeps (`./icon.tsx`). */
  readonly label?: string;
}

export function BrandMark({ size = 24, className = "", label }: BrandMarkProps) {
  const a11yProps = label !== undefined ? { role: "img" as const, "aria-label": label } : { "aria-hidden": "true" as const };
  return (
    <svg
      {...a11yProps}
      width={size}
      height={size}
      viewBox="0 0 260 200"
      className={className}
    >
      {/* body: chamber + flat-topped barrel, one silhouette */}
      <path
        d="M100 34
           l88 0
           a16 16 0 0 1 16 16
           l0 42
           a16 16 0 0 1 -16 16
           l-24 0
           a66 66 0 1 1 -64 -74z"
        className="fill-surface-raised stroke-text-primary"
        strokeWidth={10}
        strokeLinejoin="round"
      />
      {/* ring loop */}
      <circle cx={26} cy={80} r={14} className="fill-none stroke-text-primary" strokeWidth={10} />
      {/* mouth notch on the barrel top */}
      <rect x={140} y={40} width={30} height={12} rx={4} className="fill-accent" />
      {/* the chamber */}
      <circle cx={100} cy={112} r={38} className="fill-accent" />
    </svg>
  );
}

export interface BrandLockupProps {
  readonly size?: number;
  readonly className?: string;
}

/**
 * The mark beside the wordmark, the accent-colored terminal period the two bars already
 * sign off with (`top-bar.tsx`, `public-bar.tsx`) — same typography, now paired with `BrandMark`
 * instead of standing alone. `BrandMark` stays decorative here: the accessible name for "the way
 * home" belongs to whatever wraps this lockup (a `<Link aria-label="Commish">`), the same
 * division of labor `Crest`'s own docblock states for its tile.
 */
export function BrandLockup({ size = 24, className = "" }: BrandLockupProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={size} />
      <span className="font-display text-xl font-extrabold tracking-[-0.01em] text-text-primary">
        Commish<span className="text-accent">.</span>
      </span>
    </span>
  );
}
