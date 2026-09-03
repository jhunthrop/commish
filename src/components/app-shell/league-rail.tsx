"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { Icon } from "@/components/ui/icon";
import { Crest } from "@/components/ui/crest";
import { UI_CONFIG } from "@/components/ui/config";
import type { ApiEnvelope } from "@/lib/api/respond";
import { isHomeBody } from "@/league-room/lib/home-body";
import { railStateLine } from "@/league-room/lib/rail-line";
import type { RailLeague } from "./shell-data";
import { RailDot, RailWords } from "./rail-row";

/**
 * LAW 3's "the rail never renders beside its own page": `/app` IS the rail's full-page form
 * (`/app/leagues` is its standing redirect), so the rail yields the whole edge there rather
 * than repeating itself beside the same rows. Exported for the component test.
 */
export function railHiddenOn(pathname: string | null): boolean {
  return pathname === "/app" || pathname === "/app/leagues";
}

/** "Bay Bandits. 4th of 12 · next: vs Mudville Nine." — the row's accessible name is the
 *  league's REAL name plus its one state line, never its monogram (the crest's text is
 *  `aria-hidden`), so the collapsed rail loses nothing to a screen reader when the words are
 *  visually hidden. */
function accessibleNameFor(league: RailLeague, stateLine: string): string {
  return `${league.name}. ${stateLine}.`;
}

export interface LeagueRailProps {
  readonly leagues: readonly RailLeague[];
  readonly className?: string;
}

/**
 * THE LEAGUE RAIL, one component in its first two sizes (the rail redesign, 2026-09-03; the
 * founder-approved blueprint in `.superpowers/mocks/`):
 *
 * - COLLAPSED (56px, `lg`+): a vertical strip of monogram chips (`monogramsFor` marks, law 1)
 *   with typed dots (amber = yours to act on, red = live now, law 2), ordered by urgency with a
 *   divider before the quiet leagues — `shellData` already ordered them; this renders, it never
 *   re-sorts. Below `lg` it stays the horizontal scrolling strip.
 * - FLYOUT (268px, `lg`+): hover or focus anywhere on the rail expands the WHOLE rail as an
 *   absolutely-positioned overlay — no layout shift, the grid column keeps the collapsed width.
 *   Each row is the same link as its chip, now with its words visible (`RailWords`): full name
 *   and one state line. Esc and mouse-out close; Esc leaves focus where it stood, which is the
 *   row the reader was on. Rows are the tap targets — the flyout renders no verbs at all.
 *
 * SUNDAY FORM (law 4 of the canvas brief): the shell read's live lines are deliberately
 * degraded ("Live now" — `shellData` skips the score cache on purpose). When the flyout OPENS
 * with a live league on it, ONE `fetch("/api/home")` — the same lazy-on-open idiom as the peek
 * card's history fetch, and the same cache-backed read `HomeBoard` polls — upgrades live rows
 * to real margins ("Live · you lead 84.20 to 71.60", the rich tier of `railStateLine`). Until
 * it lands, or if it fails, the degraded line stands: honest, never wrong. Nothing is fetched
 * while the flyout is closed, and nothing at all on a Tuesday rail with no live league.
 *
 * A client component because `aria-current` reads `usePathname()` (ruling 8, as amended) and
 * because open/close is interaction state. Still one `<nav>` whose links are the chips
 * themselves — opening the flyout adds no second set of focus targets, the words simply appear
 * beside the chip a keyboard user is already on.
 */
export function LeagueRail({ leagues, className = "" }: LeagueRailProps) {
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [richLines, setRichLines] = useState<ReadonlyMap<string, string> | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  const anyLive = leagues.some((league) => league.state === "live");

  useEffect(() => {
    if (!open || !anyLive) return;
    let cancelled = false;

    async function upgradeLiveLines(): Promise<void> {
      try {
        const response = await fetch("/api/home");
        const envelope = (await response.json()) as ApiEnvelope<unknown>;
        if (cancelled || !envelope.ok || !isHomeBody(envelope.data)) return;
        setRichLines(new Map(envelope.data.leagues.map((league) => [league.id, railStateLine(league, "rich")])));
      } catch {
        // The degraded shell line ("Live now") stays on screen — this fetch exists to sharpen
        // the flyout, never to be the thing that can break the rail.
      }
    }

    void upgradeLiveLines();
    return () => {
      cancelled = true;
    };
  }, [open, anyLive]);

  // LAW 3: `/app` is this component's own full-page size — nothing renders beside it.
  if (railHiddenOn(pathname)) return null;

  const crestSize = UI_CONFIG.shell.crestSizePx;
  const widthVars = {
    "--rail-width": `${UI_CONFIG.shell.railWidthPx}px`,
    "--rail-flyout": `${UI_CONFIG.shell.railFlyoutWidthPx}px`,
  } as CSSProperties;
  const firstQuietIndex = leagues.findIndex((league) => league.state === "quiet");
  const wordsClassName = `hidden ${open ? "lg:flex" : ""}`;

  // The a11y disable below: the nav's listeners are the flyout's open/close ENHANCEMENT, not
  // the interaction itself — every action in the rail is a real link (keyboard reachable, with
  // full accessible names carrying the same words the flyout shows); hover/focus merely reveal
  // the words visually and Escape re-hides them. No functionality exists only behind these
  // handlers, which is exactly the case the rule's own docs carve out for visual disclosure on
  // a container.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <nav
      ref={navRef}
      aria-label="Your leagues"
      data-testid="league-rail"
      data-expanded={open}
      style={widthVars}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!navRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      // The grid track reads `--rail-width` off this element and never changes with `open`:
      // the flyout below is an absolutely-positioned OVERLAY, so nothing to the right moves.
      // `sticky` is itself a positioned box, so the flyout's `absolute` resolves against this
      // element — no extra `relative` needed (the two would conflict).
      className={`border-b border-line bg-surface lg:sticky lg:top-0 lg:w-[var(--rail-width)] lg:self-start lg:border-b-0 lg:border-r ${className}`}
    >
      <div
        className={`flex flex-row items-center gap-2 overflow-x-auto px-3 py-2 lg:max-h-dvh lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-y-auto lg:px-2 lg:py-3 ${
          open ? "lg:absolute lg:left-0 lg:top-0 lg:z-40 lg:w-[var(--rail-flyout)] lg:border lg:border-line lg:bg-surface lg:shadow-lg" : ""
        }`}
      >
        {leagues.map((league, index) => {
          const isCurrent = pathname?.startsWith(`/app/leagues/${league.id}`) ?? false;
          const stateLine = (league.state === "live" ? richLines?.get(league.id) : undefined) ?? league.stateLine;
          return (
            <Fragment key={league.id}>
              {index === firstQuietIndex && index > 0 ? (
                // The divider between what needs the manager (or is live) and what is quiet —
                // decoration only, the order itself already said it.
                <span aria-hidden="true" className="hidden border-line lg:mx-2 lg:my-0.5 lg:block lg:border-t" />
              ) : null}
              <Link
                href={`/app/leagues/${league.id}`}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={accessibleNameFor(league, stateLine)}
                // D4's "you are here" ring, unchanged from the pre-flyout rail (`ThemeSwitcher`'s
                // checked-chip idiom): the current tile keeps its ring in both sizes.
                className={`relative flex shrink-0 items-center gap-2.5 rounded-md lg:p-1 ${open ? "lg:hover:bg-surface-elevated" : ""} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isCurrent ? "ring-2 ring-edge ring-offset-2 ring-offset-surface" : ""
                }`}
              >
                <span className="relative shrink-0" style={{ width: crestSize, height: crestSize }}>
                  <Crest id={league.id} name={league.name} mark={league.monogram} size={crestSize} />
                  <RailDot state={league.state} reducedMotion={reducedMotion} />
                </span>
                <RailWords name={league.name} stateLine={stateLine} state={league.state} className={wordsClassName} />
              </Link>
            </Fragment>
          );
        })}
        <Link
          href="/app#create-league"
          aria-label="Find or start a league"
          className="flex shrink-0 items-center gap-2.5 rounded-md text-text-muted transition-colors hover:text-text-primary lg:mt-auto lg:p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span
            className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-line"
            style={{ width: crestSize, height: crestSize }}
          >
            <Icon name="plus" size={18} />
          </span>
          {/* LAW 1's last clause: the + gets words in the flyout. */}
          <span aria-hidden="true" className={`${wordsClassName} font-display text-sm font-semibold`}>
            Find or start a league
          </span>
        </Link>
      </div>
    </nav>
  );
}
