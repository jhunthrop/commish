import Link from "next/link";

export interface FooterLink {
  readonly href: string;
  readonly label: string;
}

/**
 * The trust links every public surface promises. Named once, here, so the component that names
 * the targets is also the one whose own test checks them (F19). A footer link to a page nobody
 * wrote is worse than no footer, so this list is the contract those pages have to honor.
 *
 * `/league-rules` IS NOT ON THIS LIST, and that is the fix round's ruling (2026-09-10). The
 * STOREFRONT NAV owns it, under the name `/league-rules`'s own `<h1>` uses: "How it works".
 * This footer carried a fourth entry pointing at the same page with the same words, so every
 * surface rendering both a nav and a footer — the front door, `/browse`, all four reading pages
 * — offered one page twice, which is what broke `reading-frame.test.tsx` ("Found multiple
 * elements with the role link and name How it works") and what P3's spirit rules out: a second
 * spelling of a door that already exists on the screen.
 *
 * WHY THE FOOTER YIELDED RATHER THAN THE NAV. The alternative was to relabel this entry back to
 * "League rules", which is what `public-footer.test.tsx` asserted and what `shell-footer.test.
 * tsx` still records as the deliberate difference between the two footers. That fixes the
 * collision by giving one page two names, which is the worse defect and the one N15 rules out
 * by name — and `/league-rules`'s own heading, the storefront nav and the signed-in shell footer
 * already agree the name is "How it works", so "League rules" was the odd spelling out, not the
 * canonical one. One page, one name, one door per screen.
 *
 * The two public surfaces that rendered this footer under a nav-less `PublicBar` — the seat-hold
 * room and the invite landing — now pass `STOREFRONT_NAV`, so nothing lost a route: see
 * `ReadingFrame`'s own docblock for the identical defect it records fixing on `/support`.
 */
export const PUBLIC_FOOTER_LINKS: readonly FooterLink[] = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/support", label: "Support" },
];

/**
 * The signed-out footer, rendered by all four public surfaces (the front door, `/reviews`,
 * `/browse`, `/app/join/[code]`) — Task 16, F19. A footer written four times is the duplication
 * this task exists to end.
 */
export function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <nav aria-label="Legal and support" className="flex w-full flex-wrap items-center gap-4 px-4 py-6 text-sm text-text-muted">
        {PUBLIC_FOOTER_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
