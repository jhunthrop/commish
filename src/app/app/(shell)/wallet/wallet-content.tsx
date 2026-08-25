import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { Panel } from "@/components/ui";
import { walletAccountFlags, walletSummary } from "@/money-service/read";
import { moneyIsLive } from "@/money/states";
import { getSharedPaymentsProvider } from "@/payments-provider/registry";
import { WalletPanel } from "@/account-room/components/wallet-panel";
import { DepositForm } from "@/account-room/components/deposit-form";
import { WithdrawalForm } from "@/account-room/components/withdrawal-form";
import { KycPanel } from "@/account-room/components/kyc-panel";
import { ExclusionPanel } from "@/account-room/components/exclusion-panel";

/** The dark state's one sentence (Task 12 brief, verbatim) — `FREE_SEASON_ENTRY_FEE_MESSAGE`'s
 *  own idea (`@/league-service/creation`) said about the wallet specifically rather than one
 *  league's entry fee. No separate constant shared with that one: the two surfaces say the same
 *  underlying fact in the register each one already speaks in (a league's fee door versus the
 *  wallet's own front page), and forcing them through one literal string would coincidentally
 *  couple two independent call sites the moment either needed to say it slightly differently. */
const DARK_WALLET_SENTENCE = "Real-money play is not available yet. Every league is free this season.";

/**
 * The wallet's live content: four figures, both money-in/money-out forms, and the two
 * account-standing panels. `bankMethod` is asserted present rather than optional-chained away,
 * because `PaymentsProvider.listSupportedMethods()`'s own contract (`../../../../payments-provider/contract.ts`,
 * the contract suite) requires every implementation to support `"bank"` — a provider that failed
 * to would fail that suite long before this page ever ran.
 */
async function liveWalletContent(userId: string): Promise<ReactNode> {
  const db = getDb();
  const [summary, flags] = await Promise.all([walletSummary(db, userId), walletAccountFlags(db, userId)]);
  const methods = getSharedPaymentsProvider().listSupportedMethods();
  const bankMethod = methods.find((descriptor) => descriptor.method === "bank");
  if (bankMethod === undefined) throw new Error('liveWalletContent: the payments provider named no "bank" method descriptor.');

  return (
    <div className="flex flex-col gap-6">
      <WalletPanel summary={summary} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DepositForm methods={methods} />
        <WithdrawalForm bankMethod={bankMethod} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <KycPanel status={flags.kycStatus} />
        <ExclusionPanel selfExcludedAt={flags.selfExcludedAt} />
      </div>
    </div>
  );
}

/**
 * The wallet's own content, gated on `live` (Task 12): the free-season reality this brief names —
 * money is dark, so the wallet renders honestly TODAY. Dark is ONE sentence and nothing else: no
 * balance figure, no form, never a broken control a caller cannot use (`no mock data on a real
 * surface`, the wire's own honesty contract applied here). `live` defaults to the real
 * `moneyIsLive()` — injectable so a test could exercise the live branch without editing shipped
 * state, `leagueMoneyOrRefuse`'s own idiom (`@/league-service/creation`) — though no production
 * caller, and no test in this task, ever passes anything but the default: `MONEY_STATES.enabled`
 * ships empty with no injection seam of its own, so `page.test.tsx`'s own suite proves only the
 * dark branch, the one every real request reaches. The live branch's rendering is proven at the
 * component level instead (each of the five components' own test suite), plus one composition
 * proof here (`renderWalletContent(userId, true)` against a real seeded row) that the wiring
 * itself — which figure and status goes to which component — is correct.
 *
 * Lives in its own module rather than `page.tsx` (Next.js's page-export validation rejects any
 * named export on a `page.tsx` file beyond a small allowed set — `dynamic`, `generateMetadata`,
 * and a few others — `renderWalletContent` is not one of them, and `next build` fails the whole
 * build on that mismatch).
 */
export async function renderWalletContent(userId: string, live: boolean = moneyIsLive()): Promise<ReactNode> {
  if (!live) {
    return (
      <Panel title="Real-money play">
        <p className="text-sm text-text-muted">{DARK_WALLET_SENTENCE}</p>
      </Panel>
    );
  }
  return liveWalletContent(userId);
}
