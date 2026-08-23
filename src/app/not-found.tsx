import Link from "next/link";
import { EmptyState } from "@/components/ui";

const LINK_CLASS =
  "inline-flex h-10 items-center justify-center rounded-md px-4 text-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/**
 * A wrong URL is not a failure, so this is an `EmptyState` and not an `ErrorState`: no
 * `role="alert"`, no apology, no retry (retrying the same missing URL cannot help). Two ways on,
 * because the two things a visitor could have been looking for are a league they are in and a
 * league they might join.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
      <EmptyState
        icon="search"
        title="We couldn't find that page."
        description="That link may be outdated. Your leagues are still where you left them."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/app" className={`${LINK_CLASS} bg-accent text-accent-text hover:brightness-110`}>
              Go to your leagues
            </Link>
            <Link href="/browse" className={`${LINK_CLASS} border border-line text-text-primary hover:bg-surface-elevated`}>
              Browse open leagues
            </Link>
          </div>
        }
      />
    </main>
  );
}
