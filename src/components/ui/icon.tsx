import {
  AlertTriangle,
  Anchor,
  Check,
  ChevronRight,
  Clock,
  Clover,
  Crown,
  Flame,
  Inbox,
  RefreshCw,
  Rocket,
  Search,
  Shield,
  Trophy,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

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
} as const satisfies Readonly<Record<string, LucideIcon>>;

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
