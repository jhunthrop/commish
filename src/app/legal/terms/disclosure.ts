import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { moneyIsLive } from "@/money/states";

/**
 * Phase 4, Task 13: this page's own money sentence, the SAME `moneyIsLive()` switch every other
 * money-real surface reads — `stakeDisclosure` while the season is dark (every build that exists
 * today), `liveStakeDisclosure` the day a state is enabled. `live` defaults to the real
 * `moneyIsLive()`, injectable so a test can exercise the live branch without editing shipped
 * state, the identical `renderWalletContent`/`FrontDoorHero` idiom.
 *
 * Lives in its own module rather than `page.tsx` — the identical reason `renderWalletContent`
 * lives in its own module (`@/app/app/(shell)/wallet/wallet-content`, that file's own docblock):
 * Next.js's page-export validation rejects any named export on a `page.tsx` file beyond a small
 * allowed set, and `termsMoneyDisclosure` is not one of them.
 */
export function termsMoneyDisclosure(live: boolean = moneyIsLive()): string {
  return live ? MATCHMAKING_CONFIG.liveStakeDisclosure : MATCHMAKING_CONFIG.stakeDisclosure;
}
