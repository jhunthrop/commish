import { AlertTriangle, Check, ChevronRight, Clock, Inbox, RefreshCw, Search, Trophy, Users, X, type LucideIcon } from "lucide-react";

const ICONS = {
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
