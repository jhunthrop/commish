import {
  AlertTriangle,
  Anchor,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Clover,
  Crown,
  Flame,
  Inbox,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Shield,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  AuctionGlyph,
  ByeWeekGlyph,
  DraftPickGlyph,
  LineupGlyph,
  MatchupGlyph,
  PayoutGlyph,
  PlayoffsGlyph,
  SnakeOrderGlyph,
  TradeGlyph,
  WaiverGlyph,
} from "./glyphs";

/**
 * The shared shape every entry in `ICONS` satisfies — a component that renders an `<svg>` from
 * the props `Icon` passes it (`role`, `aria-label` or `aria-hidden`, `width`, `height`,
 * `className`). Lucide's own `LucideIcon` type is a `LucideProps`-typed component, and
 * `LucideProps` is `SVGProps<SVGSVGElement>` plus a few extra optional fields — a strict superset
 * — so every lucide icon already satisfies this narrower type structurally; `glyphs.tsx`'s ten
 * components are typed directly against it. Widened from `LucideIcon` alone (Task 4, brand
 * adoption pass) the day the map's first non-lucide entry joined it.
 */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** `src/identity/avatars.ts` and other pure modules import `IconName` (type-only) from here. */
export const ICONS = {
  trophy: Trophy,
  users: Users,
  clock: Clock,
  "alert-triangle": AlertTriangle,
  inbox: Inbox,
  "refresh-cw": RefreshCw,
  check: Check,
  x: X,
  "chevron-right": ChevronRight,
  // The quilt's drawer handles and roster toggle (v6 quilt pass) flip a chevron with open
  // state; `chevron-right` covers the horizontal pair via rotate, this one the vertical pair.
  "chevron-down": ChevronDown,
  search: Search,
  // Avatar presets (src/identity/avatars.ts) — our vocabulary, not lucide's: `bolt` maps to
  // lucide's `Zap` because the map's keys are the product's names for these glyphs, which is
  // the whole point of having a map instead of importing lucide-react everywhere.
  shield: Shield,
  flame: Flame,
  anchor: Anchor,
  rocket: Rocket,
  crown: Crown,
  bolt: Zap,
  clover: Clover,
  // The rail's trailing "join or create another league" control (Task 2 Step 6) — the eighteen-
  // name list's first addition in three phases. None of `chevron-right`, `search` or `inbox`
  // means "another one of these", and a page-local `+` glyph in a `<span>` is exactly the
  // page-local visual mapping the founder rule forbids.
  plus: Plus,
  // THE TEN FANTASY-NATIVE GLYPHS (Task 4, brand adoption pass) — `glyphs.tsx`. Our own
  // vocabulary, drawn for this product rather than borrowed from a generic icon set, for the
  // domain concepts a generic glyph was standing in for (or that had no icon at all).
  "draft-pick": DraftPickGlyph,
  "snake-order": SnakeOrderGlyph,
  auction: AuctionGlyph,
  waiver: WaiverGlyph,
  trade: TradeGlyph,
  "bye-week": ByeWeekGlyph,
  lineup: LineupGlyph,
  matchup: MatchupGlyph,
  playoffs: PlayoffsGlyph,
  payout: PayoutGlyph,
} as const satisfies Readonly<Record<string, IconComponent>>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  /** When provided the icon is announced as an image; otherwise it is decorative. */
  readonly label?: string;
  readonly className?: string;
}

/** The one icon entry point. Feature code never imports lucide-react directly. */
export function Icon({ name, size = 20, label, className }: IconProps) {
  const Cmp = ICONS[name];
  return label !== undefined ? (
    <Cmp role="img" aria-label={label} width={size} height={size} className={className} />
  ) : (
    <Cmp aria-hidden="true" width={size} height={size} className={className} />
  );
}
