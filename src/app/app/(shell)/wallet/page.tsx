import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { renderWalletContent } from "./wallet-content";

export const dynamic = "force-dynamic";

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
