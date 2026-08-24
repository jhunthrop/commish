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
  /** Both default to nothing, so `/reviews`, `/browse` and `/app/join/[code]` render this bare and
   *  the front door alone fills them in with the approved mock's three links and its CTA (F5). */
  readonly nav?: readonly NavLink[];
  readonly action?: ReactNode;
}

/**
 * The signed-out header: wordmark home link, an optional nav, an optional action, and one
 * `SignInLink`. Replaces three verbatim copies (`/reviews`, `/browse`, `/app/join/[code]`) in the
 * same commit (Task 16, F6/F5). Full-bleed, matching `TopBar`'s own no-`max-w-*` treatment — each
 * page's own `<main>` carries whatever measured width its content wants, not this bar.
 */
export function PublicBar({ intent, nav = [], action = null }: PublicBarProps) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/"
          className="font-display text-xl font-bold uppercase tracking-wide text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          <SignInLink intent={intent} className="text-sm font-medium text-accent underline" />
        </div>
      </div>
    </header>
  );
}
