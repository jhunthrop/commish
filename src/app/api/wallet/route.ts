import { getDb } from "@/db/client";
import { ok } from "@/lib/api/respond";
import { walletSummary } from "@/money-service/read";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import type { WalletBody } from "@/account-room/contract";
import { walletRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The wallet's own read door (Task 12): `walletSummary` through the envelope, verbatim — the
 * same "one data source, one wire shape" discipline `GET /api/notices` follows for its own page.
 * `walletSummary` is a SUM over `money_entries`, never the `money_accounts` rollup (`./read.ts`'s
 * own module docblock), and it legitimately answers all zeros for a member the book has never
 * seen — no gate needed here, only the caller's own identity: there is no route anywhere that
 * takes a user id from the request body, the same `GET /api/notices` discipline.
 *
 * The `/app/wallet` PAGE does not call this route — a Server Component reads `walletSummary`
 * directly, `ProfilePage`'s own idiom (`src/app/app/(shell)/profile/page.tsx`). This door exists
 * for anything that reaches the wallet's figures from the browser instead: a future balance
 * widget, a script, an e2e check.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const limited = walletRateLimited(userId);
    if (limited !== null) return limited;

    const summary = await walletSummary(getDb(), userId);
    return ok<WalletBody>({ summary });
  });
}
