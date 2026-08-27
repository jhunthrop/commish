import Link from "next/link";
import type { ReactNode } from "react";
import { SignInLink } from "./sign-in-link";

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

export interface PublicBarProps {
  /** Where THIS bar's own `SignInLink` should return the visitor once they are signed in — every
   *  caller makes an explicit choice, the same reasoning `TopBar`'s `isAdmin` prop states: a page
   *  rendering this makes a decision rather than silently getting a generic sign-in from a page
   *  nobody updated. */
  readonly intent: string | null;
  /**
   * Whether the person reading this is already signed in. REQUIRED, and deliberately not
   * defaulted, for the same reason `intent` is: a page that renders this bar makes a decision
   * rather than silently inheriting one nobody updated.
   *
   * FOUNDER 2026-08-27: "when I'm logged in it still says login on the main page." This bar had
   * no idea — it rendered `SignInLink` unconditionally, so a signed-in member standing on the
   * front door, /browse or /reviews was told to sign in to an account they were already using.
   * The front door even had the answer in hand: it awaits `getCurrentUser()` for `helpLevel` and
   * then never told the header.
   */
  readonly signedIn: boolean;
  /** Both default to nothing, so `/reviews`, `/browse` and `/app/join/[code]` render this bare and
   *  the front door alone fills them in with the approved mock's three links and its CTA (F5). */
  readonly nav?: readonly NavLink[];
  readonly action?: ReactNode;
}

/**
 * The PUBLIC header: wordmark home link, an optional nav, an optional action, and one way
 * through the door — `SignInLink` for a stranger, "Your leagues" for somebody already signed in
 * (`signedIn`). It used to be the "signed-out header", which was an assumption rather than a
 * fact: nothing stops a signed-in member from opening the front door, /browse or /reviews, and
 * every one of them told them to sign in. Replaces three verbatim copies (`/reviews`, `/browse`, `/app/join/[code]`) in the
 * same commit (Task 16, F6/F5). Full-bleed, matching `TopBar`'s own no-`max-w-*` treatment — each
 * page's own `<main>` carries whatever measured width its content wants, not this bar.
 */
export function PublicBar({ intent, signedIn, nav = [], action = null }: PublicBarProps) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/"
          className="font-display text-xl font-semibold tracking-wide text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Commish
        </Link>
        {nav.length === 0 ? null : (
          <nav aria-label="Commish" className="hidden items-center gap-4 text-sm font-medium text-text-primary sm:flex">
            {nav.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          {action}
          {/* Quiet on purpose (E11): with the front door's ink "Take a seat" in `action`, a
              second loud CTA beside it read as two competing doors. Either link here is the
              returning member's, not the stranger's pitch — muted ink, visible on hover.
              Signed in, the door says where it goes: "Your leagues" is the exact heading of the
              page it opens (`/app`), never a second vocabulary for the same place. */}
          {signedIn ? (
            <Link
              href="/app"
              className="text-sm font-medium text-text-muted underline transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Your leagues
            </Link>
          ) : (
            <SignInLink
              intent={intent}
              className="text-sm font-medium text-text-muted underline transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          )}
        </div>
      </div>
    </header>
  );
}
