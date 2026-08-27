"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface AdminConsoleLink {
  readonly href: string;
  readonly label: string;
}

/**
 * The six operator surfaces, one name per route — each label matches that route's own
 * `PageTitle` exactly (`/app/admin/queue/page.tsx`, `holds/page.tsx`, `exclusions/page.tsx`,
 * `leagues/settle/page.tsx`, `leagues/dissolve/page.tsx`, `money/reconcile/page.tsx`), so the
 * nav, the browser tab (A5's per-page `metadata`) and the page heading never disagree.
 */
const ADMIN_CONSOLE_LINKS: readonly AdminConsoleLink[] = [
  { href: "/app/admin/queue", label: "Dispute queue" },
  { href: "/app/admin/holds", label: "Held payouts" },
  { href: "/app/admin/exclusions", label: "Self exclusion" },
  { href: "/app/admin/leagues/settle", label: "Settle league" },
  { href: "/app/admin/leagues/dissolve", label: "Dissolve league" },
  { href: "/app/admin/money/reconcile", label: "Money reconciliation" },
];

export interface AdminConsoleNavProps {
  /** `AppShellProps.user.isAdmin` — the shell's own already-known fact (`TopBarProps` reads the
   *  identical field for its queue icon). This is the REAL gate, checked here rather than trusted
   *  from the URL: `withAdmin` 404s an admin-only PAGE for a non-admin, but `(shell)/layout.tsx`
   *  still renders `AppShell` (and everything inside it) around that 404, so a route-only check
   *  would leak this nav's six links to anyone who guesses `/app/admin/queue`. */
  readonly isAdmin: boolean;
}

/**
 * The operator console index (flow analysis A4/N3 — BLOCKER): five of six admin surfaces had no
 * inbound link anywhere in the product; only `/app/admin/queue` had a door, in `TopBar`. Rendered
 * from the SHELL (`AppShell`, inside `<main>`, above `{children}`) rather than from the queue
 * page's own body, which stays out of this task's file scope — `AdminQueuePage` (and its five
 * siblings) are untouched.
 *
 * Visible ONLY for an admin standing on `/app/admin/*` — never for an ordinary member (checked
 * via `isAdmin`, never inferred from the route alone) and never outside the admin console, so it
 * costs a non-admin's `/app` nothing and never pushes an admin's own leagues home down for the
 * other 99% of an admin's time in the product.
 */
export function AdminConsoleNav({ isAdmin }: AdminConsoleNavProps) {
  const pathname = usePathname();
  if (!isAdmin) return null;
  if (!(pathname?.startsWith("/app/admin") ?? false)) return null;

  return (
    <nav aria-label="Admin console" className="flex flex-wrap items-center gap-4 border-b border-line pb-4 text-sm">
      {ADMIN_CONSOLE_LINKS.map((link) => {
        const isCurrent = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent ? "page" : undefined}
            className={`transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isCurrent ? "font-medium text-text-primary" : "text-text-muted hover:text-text-primary"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
