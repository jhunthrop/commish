import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/support";

/**
 * A minimal, real stub (Phase 3.6, Task 5, Step 5) — see `legal/terms/page.tsx`'s identical
 * docblock for why this exists now rather than as a placeholder or a redirect. The gauntlet
 * filed the absence of a name to complain to as MEDIUM-HIGH for the burned skeptic persona; this
 * page names the real path a report or a flag actually takes, rather than a contact address
 * this task has no owner to staff.
 */
export default function SupportPage() {
  return (
    <>
      <PublicBar intent={PAGE_INTENT} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <PageTitle>Support</PageTitle>
        <p className="text-text-muted">
          A review can be reported from inside the review feed, and a trade the platform flags as
          uneven is held automatically rather than settled quietly. Both land in a dispute queue a
          real platform operator works through, and every decision is recorded against the case it
          resolves.
        </p>
        <p className="text-text-muted">
          The draft room, the league schedule, and scoring run automatically once a league is
          set up, so most leagues never need a person to step in. When something does go wrong,
          it is reviewed, never guessed at.
        </p>
        <p className="text-text-muted">
          Curious how a specific rule works before you join a league? The{" "}
          <Link href="/league-rules" className="font-medium text-accent underline">
            league rules
          </Link>{" "}
          page covers the format vocabulary this product uses.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}
