import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { termsMoneyDisclosure } from "./disclosure";

// A5.
export const metadata: Metadata = pageTitle("Terms");

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/legal/terms";

/**
 * A minimal, real stub (Phase 3.6, Task 5, Step 5) — `PublicFooter` (Task 16, F19) links here
 * from every public surface, and a footer link to a page nobody wrote is worse than no footer.
 * The addendum's Task 21 Step 4 is this page's real owner and may expand it; this task's own
 * scope is making the link true, never a placeholder or a redirect to a 404.
 */
export default async function TermsPage() {
  const user = await getCurrentUser();
  return (
    <>
      <PublicBar intent={PAGE_INTENT} signedIn={user !== null} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <PageTitle>Terms</PageTitle>
        <p className="text-text-muted">
          Commish is a season-long fantasy football platform: a live draft room, automatic
          scoring, league chat, and a commissioner-free way to run a league. {termsMoneyDisclosure()}
        </p>
        <p className="text-text-muted">
          A league you join or create on this platform is governed by the rules that league
          declares, plus the rules every league shares: no waiver wire, no trade deadline, and no
          keeper or dynasty support, because this product does not have those mechanics yet. A
          card or a league page never claims a feature this product cannot deliver.
        </p>
        <p className="text-text-muted">
          A dispute about a review, a trade, or a member&apos;s conduct is reviewed by a real
          platform operator, not resolved automatically. Reports and flagged trades reach a
          dispute queue an operator works through, and a decision is recorded against the case it
          resolves.
        </p>
        <p className="text-text-muted">
          This platform is a preview: features, scoring, and these terms may change between
          seasons as the product grows.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}
