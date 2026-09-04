import type { SVGProps } from "react";

/**
 * THE TEN FANTASY-NATIVE GLYPHS (brand adoption pass, Task 4). Transcribed verbatim from the
 * approved asset paths (`commish-<name>.svg`, outside the repo) — one small component per glyph,
 * the same "drop-in compatible with how `Icon` invokes lucide" shape `icon.tsx` already keeps:
 * `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, round caps and
 * joins. Every accent element (the asset's `var(--icon-accent, #FFB627)`) is recolored to the
 * `accent` token by Tailwind class rather than the literal — `no-raw-color.source.test.ts`'s rule
 * applies here exactly as it does to `BrandMark`.
 *
 * `{...props}` lands LAST on every `<svg>`, so a caller's own `width`/`height`/`className`/aria
 * props (the ones `Icon` passes) override the defaults, while the fixed shape below — nobody
 * calls this with their own `stroke` or `viewBox` — stays put.
 */

export type GlyphProps = SVGProps<SVGSVGElement>;

/** Draft pick — a numbered card in a stack. */
export function DraftPickGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 10V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4Z" />
      <path d="M15 6.5v2M15 11v2M15 15.5v2" className="stroke-accent" />
    </svg>
  );
}

/** Snake order — the draft board's reversing rail, with its own turn dot. */
export function SnakeOrderGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h11" />
      <path d="m17 3 3 3-3 3" />
      <circle cx={4} cy={18} r={1.6} className="fill-accent" stroke="none" />
    </svg>
  );
}

/** Auction — a rising gavel over the winning bid's underline. */
export function AuctionGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m13 3 8 8M9 7l8 8M13 3 9 7M21 11l-4 4" />
      <path d="m11 9-7.4 7.4a2 2 0 0 0 2.8 2.8L13.8 11.8" />
      <path d="M14 21h7" className="stroke-accent" />
    </svg>
  );
}

/** Waiver — a claim slip with the wire's own arrow. */
export function WaiverGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 14V4a1 1 0 0 1 1-1h6l4 4v14H9a1 1 0 0 1-1-1v-2" />
      <path d="M14 3v4h4" />
      <path d="M2 15.5h8.5m-3.2-3.2 3.2 3.2-3.2 3.2" className="stroke-accent" />
    </svg>
  );
}

/** Trade — two arrows exchanging in opposite directions. */
export function TradeGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 8h16m-4-4 4 4-4 4" className="stroke-accent" />
      <path d="M20 16H4m4 4-4-4 4-4" />
    </svg>
  );
}

/** Bye week — a calendar page with the empty week's own dot. */
export function ByeWeekGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x={3} y={4} width={18} height={17} rx={2} />
      <path d="M8 2v4M16 2v4M3 9h18" />
      <path d="M8.5 13.5H12L8.5 17H12M14.5 12.5h2.6l-2.6 2.7h2.6" />
      <circle cx={17} cy={17.5} r={1.5} className="fill-accent" stroke="none" />
    </svg>
  );
}

/** Lineup — three rows, a bench dot beside each starter bar. */
export function LineupGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx={5} cy={6} r={1.6} className="fill-accent" stroke="none" />
      <rect x={9} y={4.4} width={12} height={3.2} rx={1.6} className="fill-accent" stroke="none" />
      <circle cx={5} cy={12} r={1.6} />
      <rect x={9} y={10.4} width={12} height={3.2} rx={1.6} />
      <circle cx={5} cy={18} r={1.6} />
      <rect x={9} y={16.4} width={12} height={3.2} rx={1.6} />
    </svg>
  );
}

/** Matchup — two flags facing off, the leader's own filled pennant. */
export function MatchupGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.5 21V3.5" />
      <path d="M4.5 4l7 2.4-7 2.4Z" />
      <path d="M19.5 21V8" />
      <path d="M19.5 8.5 12.5 11l7 2.4Z" className="fill-accent stroke-accent" />
    </svg>
  );
}

/** Playoffs — a bracket's own single elimination line, the final round's dot lit. */
export function PlayoffsGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 5h3M3 10h3M6 5v5M6 7.5h4M3 14h3M3 19h3M6 14v5M6 16.5h4M10 7.5v9M10 12h5" />
      <circle cx={17.5} cy={12} r={2} className="fill-accent" stroke="none" />
    </svg>
  );
}

/** Payout — a stacked pot, its top plate filled. */
export function PayoutGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <ellipse cx={12} cy={6} rx={7} ry={2.5} className="fill-accent" />
      <path d="M5 6v5.5C5 12.9 8.1 14 12 14s7-1.1 7-2.5V6" />
      <path d="M5 11.5V17c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5.5" />
    </svg>
  );
}
