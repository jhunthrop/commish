import Link from "next/link";

export interface FooterLink {
  readonly href: string;
  readonly label: string;
}

/**
 * The four trust links every public surface promises. Named once, here, so the component that
 * names the targets is also the one whose own test checks them (F19) — Task 21 creates the pages
 * behind these four paths; this list is the contract those pages have to honor, not the other
 * way around. A footer link to a page nobody wrote is worse than no footer, so a page is created
 * here only over Task 16's dead body: this task's own scope is the link, not the destination.
 */
export const PUBLIC_FOOTER_LINKS: readonly FooterLink[] = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/support", label: "Support" },
  { href: "/league-rules", label: "League rules" },
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
