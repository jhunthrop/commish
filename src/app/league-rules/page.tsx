import { PageTitle } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/league-rules";

/**
 * A minimal, real stub (Phase 3.6, Task 5, Step 5) — the front door's own "How it works" nav
 * link points here (F19), and a nav item pointing at a route nobody created is the
 * footer-to-a-404 failure with a bigger font.
 *
 * The addendum's Task 21 Step 4 is this page's real owner: it wires the seven glossary terms
 * `glossary.source.test.ts`'s own `UNSURFACED` list names as landing here (`ppr`, `half-ppr`,
 * `te-premium`, `custom-scoring`, `flex`, `snake-draft`, `auction-draft`) through real `InfoTip`
 * triggers. This stub does NOT wire them — plain prose only — so that list stays exactly as
 * accurate as it is today; wiring them here ahead of that task would be scope this task does not
 * own, landing a change to a file (`glossary.source.test.ts`) this task's own brief never names.
 */
export default function LeagueRulesPage() {
  return (
    <>
      <PublicBar intent={PAGE_INTENT} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <PageTitle>How it works</PageTitle>
        <p className="text-text-muted">
          Every league on Commish drafts either snake or auction. A snake draft has every manager
          pick in order, then the order reverses, back and forth, round after round. An auction
          draft lets every manager bid on every player from a shared budget, so nobody is ever
          locked out of a player, only outbid.
        </p>
        <p className="text-text-muted">
          Scoring is one of a small set of presets: Standard, PPR (a full point for every catch),
          Half PPR (half a point for every catch), or PPR with a TE premium (an extra bonus for a
          tight end&apos;s catch on top of PPR). A commissioner may also hand-tune the point
          values, which reads as Custom scoring rather than any of the four presets.
        </p>
        <p className="text-text-muted">
          Every roster carries a FLEX spot a running back, receiver, or tight end can fill. A
          superflex league adds a second flex-like spot that also accepts a quarterback, so most
          managers in one start two. Some leagues also play a median game: on top of the regular
          head-to-head matchup, a team&apos;s score is compared to the league&apos;s median score
          that week, and the result counts as a second win, loss, or tie.
        </p>
        <p className="text-text-muted">
          A Commish house league is one the platform itself runs rather than a commissioner: the
          rules are the same in every one, and a new one opens whenever one fills, so there is
          always a seat to take.
        </p>
        <p className="text-text-muted">
          This product does not yet support a waiver wire, a trade deadline, or keeper and
          dynasty formats. A card or a league page never claims one of those, because a feature
          this product cannot deliver has no business on a page a stranger reads to decide
          whether to join.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}
