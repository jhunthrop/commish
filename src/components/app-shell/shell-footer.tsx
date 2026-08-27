import Link from "next/link";

interface ShellFooterLink {
  readonly href: string;
  readonly label: string;
}

/**
 * The quiet trio-plus-one every signed-in route now owns (flow analysis A3/N2): support, how
 * the product works, and the two legal pages, reachable from all 17 `(shell)` routes instead of
 * only from `PublicFooter` (`./public-footer.tsx`), which `AppShell` never renders. Order and
 * labels follow the settled A3 design — "Support · How it works · Terms · Privacy" — deliberately
 * NOT `PublicFooter`'s own list: "How it works" matches `/league-rules`'s own `<h1>`
 * (`src/app/league-rules/page.tsx`) and the front door's nav label (`src/app/page.tsx:37`), never
 * `PublicFooter`'s "League rules" — a signed-in manager should see the same name for a route the
 * front door already taught them, not a second name invented here for the same page (N15).
 */
export const SHELL_FOOTER_LINKS: readonly ShellFooterLink[] = [
  { href: "/support", label: "Support" },
  { href: "/league-rules", label: "How it works" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
];

export interface ShellFooterProps {
  /** Extra classes from the caller — `AppShell` uses this to place the footer under the content
   *  column only (`lg:col-start-2 lg:row-start-3`), matching `TopBar`/`LeagueRail`'s own pattern
   *  for reaching into the shell's grid. */
  readonly className?: string;
}

/**
 * The signed-in shell's own footer (flow analysis A3, N2 — BLOCKER: a manager in a money
 * dispute, mid-draft, had no route to support without signing out or typing a URL). Rendered by
 * `AppShell` (`./app-shell.tsx`) beneath the content column, so it never appears inside the
 * `(room)` group — that group has its own chrome (`RoomRail`/`RoomDock`) and never renders
 * `AppShell` at all (`src/app/app/(room)/drafts/[draftId]/page.tsx`).
 *
 * Deliberately quieter than `PublicFooter`: `text-xs`, no `border-t` band competing with the
 * content it sits under, muted-only links with no separate background band. Sunday Standard —
 * this is wayfinding, never a second navigation bar fighting the page for ink. Survives 390px
 * the same way `PublicFooter` does: `flex-wrap`, no fixed width, no horizontal scroll.
 */
export function ShellFooter({ className = "" }: ShellFooterProps) {
  return (
    <footer className={`px-4 py-4 ${className}`}>
      <nav aria-label="Support and legal" className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        {SHELL_FOOTER_LINKS.map((link) => (
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
