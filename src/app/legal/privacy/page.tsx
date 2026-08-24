import { PageTitle } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/legal/privacy";

/**
 * A minimal, real stub (Phase 3.6, Task 5, Step 5) — see `legal/terms/page.tsx`'s identical
 * docblock for why this exists now rather than as a placeholder or a redirect.
 */
export default function PrivacyPage() {
  return (
    <>
      <PublicBar intent={PAGE_INTENT} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <PageTitle>Privacy</PageTitle>
        <p className="text-text-muted">
          Commish signs you in through WorkOS, not a password this platform stores itself.
          Signing in gives us your email address and, if you sign in with a provider like Google,
          the name and avatar that provider shares.
        </p>
        <p className="text-text-muted">
          Inside a league, the members you share it with can see your display name, your team,
          and the moves you make: a draft pick, a lineup, a trade. A stranger browsing the open
          leagues below sees only facts about the league itself, never a name of anyone already
          in it.
        </p>
        <p className="text-text-muted">
          A review you write is shown with your name attached, unedited, next to every other
          member&apos;s review. This platform does not sell personal information to anyone.
        </p>
        <p className="text-text-muted">
          This platform is a preview, and this page will grow into a fuller policy as the product
          does.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}
