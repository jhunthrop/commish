import Link from "next/link";
import type { ReactNode } from "react";
import { RAIL_LABEL } from "@/components/ui/config";
import { SignInLink } from "./sign-in-link";

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/**
 * THE STOREFRONT NAV, once (Gameday, 2026-08-28).
 *
 * The front door defined these two links privately and every OTHER public surface rendered this
 * bar bare — so a stranger who landed on `/support`, `/legal/terms` or `/league-rules` from a
 * search result had exactly one door back into the product, and it was the wordmark. The links
 * are the same two the front door always shipped; what changed is that they belong to the bar
 * rather than to one page, so a reading page cannot be built without them.
 *
 * "How it works" points at `/league-rules`, whose own `<h1>` reads "How it works" — a signed-in
 * manager and a stranger see one name for one page (N15's rule, applied to the second surface it
 * was always about). The front door appends its conditional "Reviews" entry to THIS list rather
 * than keeping a third copy of the base.
 */
export const STOREFRONT_NAV: readonly NavLink[] = [
  { href: "/browse", label: "Open leagues" },
  { href: "/league-rules", label: "How it works" },
];

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
      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        {/* The mark: the condensed face at its earned weight, with the amber full stop every
            v5 mock signs off with — the one place the furniture colour appears in the rail's
            left half. */}
        <Link
          href="/"
          className="font-display text-xl font-extrabold tracking-[-0.01em] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Commish<span className="text-accent">.</span>
        </Link>
        {nav.length === 0 ? null : (
          {/* Order-last + full width below sm: the rail wraps to its own row on a phone instead
              of vanishing — the store track found the no-way-back defect reopened at 390. */}
          <nav aria-label="Commish" className={`order-last flex w-full items-center gap-6 ${RAIL_LABEL} text-text-muted sm:order-none sm:w-auto`}>
            {nav.map((link) => {
              // `intent` is every caller's own path (it is where sign-in returns), so it also
              // answers which rail label is the page under the reader's feet — that one carries
              // the amber underline, the broadcast rail's here-marker.
              const active = link.href === intent;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`pb-0.5 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active ? "text-text-primary shadow-[inset_0_-2px_0_0_var(--commish-color-accent)]" : ""
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="flex items-center gap-4">
          {action}
          {/* The returning member's door, in the rail register but quiet — the verb beside it is
              the stranger's pitch, and two loud doors read as competing (E11, unchanged). */}
          {signedIn ? (
            <Link
              href="/app"
              className={`${RAIL_LABEL} text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            >
              Your leagues
            </Link>
          ) : (
            <SignInLink
              intent={intent}
              className={`${RAIL_LABEL} text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            />
          )}
        </div>
      </div>
    </header>
  );
}
