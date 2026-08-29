import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ReadingFrame } from "@/components/app-shell/reading-frame";

// A5.
export const metadata: Metadata = pageTitle("Support");

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/support";

/**
 * The operator dispute path's user-facing entry (Phase 3.6 addendum, Task 21, Step 4) — the
 * thing the 3.5 loop deferred, and the gap the gauntlet filed MEDIUM-HIGH for the burned-skeptic
 * persona: nobody to complain to. This page names the real path a report or a held trade
 * actually takes today, what it does and does not do, and it names the things that have no path
 * today AS things that have no path today, rather than implying one that does not exist.
 */
export default async function SupportPage() {
  const user = await getCurrentUser();
  return (
    <ReadingFrame
      title="Support"
      kicker="Disputes and reports"
      lede="A report or a held trade lands in a dispute queue a real platform operator works through, in the order it arrives. Nothing in that queue settles itself."
      intent={PAGE_INTENT}
      signedIn={user !== null}
    >
        <p>
          Reporting a review or a chat message flags it for an operator to review. It does not
          remove the content right away, and it does not notify the person you reported. A trade
          the platform flags as uneven is held automatically instead of settling quietly, and it
          stays held until an operator makes a decision.
        </p>
        <p>
          There is no published timeline for a decision today. An operator works through the
          queue in the order reports and held trades arrive, and every decision is recorded
          against the case it resolves.
        </p>
        <p>
          Two things can be reported today: a review, from inside the review feed, and a chat
          message, from inside a league&apos;s chat. Both reach the same queue, and both are the
          real way to reach an operator right now.
        </p>
        <p>
          Some things this platform does not offer yet: a way to contact an operator directly, a
          way to see the status of a report once you file it, an incident or status page, and an
          email once something reported gets fixed. Reporting a review or a message is the path
          that exists today.
        </p>
        <p>
          The draft room, the league schedule, and scoring run automatically once a league is
          set up, so most leagues never need an operator to step in.
        </p>
        {/* N15's one-name rule: this link used to read "league rules", which is the ROUTE's name
            and not the page's — a stranger following it landed on a page headed "How it works"
            and a signed-in manager reached the same page by a third name. It also undersold what
            is there now: the no-tips ruling made that page the product's whole reference, not a
            format glossary. */}
        <p>
          <Link href="/league-rules" className="font-medium text-accent underline">
            How it works
          </Link>{" "}
          defines every format, scoring and season term this product uses.
        </p>
    </ReadingFrame>
  );
}
