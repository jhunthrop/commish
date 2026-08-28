import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { ButtonLink, Panel } from "@/components/ui";
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

  // LAW 4 ON THE MONEY SURFACE: the balance is the column a reader keeps coming back to, so it
  // stays put on the left while the four things you DO with money sit beside it, two per row.
  // The old shape stacked five full-width rows, which put the balance off screen the moment a
  // reader scrolled to the form that spends it.
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="lg:sticky lg:top-4">
        <WalletPanel summary={summary} />
      </div>
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <DepositForm methods={methods} />
          <WithdrawalForm bankMethod={bankMethod} />
        </div>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <KycPanel status={flags.kycStatus} />
          <ExclusionPanel selfExcludedAt={flags.selfExcludedAt} />
        </div>
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
    // The dark season's honest page, composed rather than orphaned (self review D1/R1,
    // 2026-08-27): the one sentence stays the headline fact, the story below it is the
    // free-season trust story said plainly, and the way out is real.
    //
    // GAMEDAY (law 4, and the spec's own dash rule) CHANGES ONE THING AND KEEPS THE CONTRACT.
    // What shipped before was a single 655px panel stranded in the top-left of a 1440px page —
    // 87% of the wallet was empty, on the surface a reader arrives at anxiously. The fix is NOT
    // to invent a balance: `WalletPanel` renders the same four figures it will render when money
    // is live, every one of them `NOT_STARTED_DASH`, because *"a dash is not a zero"* is the
    // spec's own rule for a fact that has not happened yet. Still no form, no broken control, no
    // invented number — dark still means dark. What a reader now learns is the SHAPE of the page
    // they will read later, which is the honest thing a dormant money surface can teach.
    return (
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <WalletPanel summary={null} />
        <Panel title="Real-money play">
          <div className="flex max-w-prose flex-col items-start gap-3">
            <p className="text-sm text-text-primary">{DARK_WALLET_SENTENCE}</p>
            <p className="text-sm text-text-muted">
              When real-money leagues open, this page is where your balance lives: deposits, entry fees, winnings and
              withdrawals, each shown to the cent. Until then there is nothing to hold here, and no number on this page
              will ever be an invented one.
            </p>
            <ButtonLink href="/browse" variant="secondary">
              Browse free leagues
            </ButtonLink>
          </div>
        </Panel>
      </div>
    );
  }
  return liveWalletContent(userId);
}
