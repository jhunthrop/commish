import { InfoTip, PageTitle } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/league-rules";

/**
 * The front door's own "How it works" nav destination (F19) and where the format vocabulary
 * lands (Phase 3.6 addendum, Task 21, Step 4): the seven glossary terms `glossary.source.test.ts`
 * named as unsurfaced (`ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `snake-draft`,
 * `auction-draft`) get their first real `InfoTip` caller here, and are removed from that file's
 * `UNSURFACED` allowlist in the same commit — the allowlist's own second test fails a term left
 * listed once something actually renders it.
 */
export default function LeagueRulesPage() {
  return (
    <>
      <PublicBar intent={PAGE_INTENT} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <PageTitle>How it works</PageTitle>
        <p className="text-text-muted">
          Every league on Commish drafts either snake <InfoTip term="snake-draft" /> or auction{" "}
          <InfoTip term="auction-draft" />. A snake draft has every manager pick in order, then
          the order reverses, back and forth, round after round. An auction draft lets every
          manager bid on every player from a shared budget, so nobody is ever locked out of a
          player, only outbid.
        </p>
        <p className="text-text-muted">
          Scoring is one of a small set of presets: Standard, PPR <InfoTip term="ppr" /> (a full
          point for every catch), Half PPR <InfoTip term="half-ppr" /> (half a point for every
          catch), or PPR with a TE premium <InfoTip term="te-premium" /> (an extra bonus for a
          catch by a tight end on top of PPR). A commissioner may also hand-tune the point
          values, which reads as Custom scoring <InfoTip term="custom-scoring" /> rather than any
          of the four presets.
        </p>
        <p className="text-text-muted">
          Every roster carries a FLEX <InfoTip term="flex" /> spot a running back, receiver, or
          tight end can fill. A superflex league adds a second flex-like spot that also accepts a
          quarterback, so most managers in one start two. Some leagues also play a median game:
          on top of the regular head-to-head matchup, a team&apos;s score is compared to the
          league&apos;s median score that week, and the result counts as a second win, loss, or
          tie.
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
