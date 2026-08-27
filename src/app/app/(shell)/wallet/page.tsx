import type { Metadata } from "next";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { renderWalletContent } from "./wallet-content";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>.
export const metadata: Metadata = pageTitle("Wallet");

/**
 * The account room's wallet page (Task 12) — the first user-facing money surface. Renders no
 * `TopBar` and no `<main>` of its own; `(shell)/layout.tsx` supplies both, `ProfilePage`'s own
 * discipline. A Server Component reading through the service layer directly, outside the
 * client-boundary rule (`src/account-room/**`'s own) — the actual reads live in
 * `./wallet-content.tsx` (`renderWalletContent`'s own docblock explains why it is a separate
 * module rather than a second export here).
 */
export default async function WalletPage() {
  const user = await requireCurrentUser();
  const content = await renderWalletContent(user.id);
  return (
    <>
      <PageTitle>Wallet</PageTitle>
      {content}
    </>
  );
}
