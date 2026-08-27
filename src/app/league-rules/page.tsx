import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { GlossarySection } from "./glossary-section";
import { TermLink } from "./term-link";

// A5: matches this page's own <h1> and the front door's nav label — "How it works", never
// "League rules" (`ShellFooter`'s own docblock, `@/components/app-shell/shell-footer.tsx`).
export const metadata: Metadata = pageTitle("How it works");

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/league-rules";

/**
 * B4 (flow analysis journey J08; flow analysis finding 3; storefront review E11) — the SAME
 * plain-language definition `FrontDoorHero` leads with, byte-identical (both are swept by
 * `src/integrity/rendered-copy.test.tsx`, the same "quoted phrase, no shared import to pin it
 * against" reasoning `front-door-hero.tsx`'s own docblock argues). This nav destination used to
 * open straight into format vocabulary — "Every league on Commish drafts either snake or
 * auction." was its own first sentence — and never once said what fantasy football IS. A visitor
 * who clicked "How it works" asking that question got a rulebook instead.
 */
const GAME_DEFINITION =
  "A league is a group of managers who draft NFL players, then start the ones they think will " +
  "score most each week. You play one other manager every week of the NFL season. Your team's " +
  "score is whatever your starters do in their real games.";

/**
 * B4's own "how a season goes" — a short bridge between the one-sentence definition above and
 * the format detail below, naming the shape of a season (draft, then weekly matchups, then a
 * short playoff) without a single week number: `LEAGUE_CONFIG.regularSeasonWeeks`/`playoffTeams`
 * already own those facts (`browse.ts`'s own `PLAYOFF_WEEKS`), and a second, hand-typed copy of
 * them here would be a number this page could quietly drift from the config that actually decides
 * it.
 */
const SEASON_SUMMARY =
  "Here is how a season goes. It starts with a live draft, where every manager builds a full " +
  "roster. From there, you play one other manager each week: you choose who starts, and whatever " +
  "they do in their real NFL games becomes your score. The best teams from the regular season " +
  "close it out with a short playoff.";

/**
 * The front door's own "How it works" nav destination (F19) and where the format vocabulary
 * lands (Phase 3.6 addendum, Task 21, Step 4): the seven glossary terms `glossary.source.test.ts`
 * named as unsurfaced (`ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `snake-draft`,
 * `auction-draft`) got their first real caller here.
 *
 * E10 (Task 10): that caller is `TermLink`, not `InfoTip` — this page reads start to finish, so
 * a term is a plain in-page anchor down to `GlossarySection`'s matching entry rather than a
 * second control to click open mid-sentence. `InfoTip` itself is untouched; it still fires
 * everywhere else in the product. `glossary.source.test.ts`'s `UNSURFACED` allowlist stays empty
 * either way — its detection reads any `term="key"` JSX attribute, `TermLink`'s included, not
 * `InfoTip` specifically.
 *
 * B4 (flow analysis): the page now opens with `GAME_DEFINITION` and `SEASON_SUMMARY` before any
 * format detail, and closes its own prose with a way forward — "See open leagues" — rather than
 * the list of what this product cannot do yet. That paragraph survives (a stranger deciding
 * whether to join is owed the honest limits), it simply no longer gets the last word.
 */
export default function LeagueRulesPage() {
  return (
    <>
      <PublicBar intent={PAGE_INTENT} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <PageTitle>How it works</PageTitle>
        <p className="text-lg text-text-primary">{GAME_DEFINITION}</p>
        <p className="text-text-muted">{SEASON_SUMMARY}</p>
        <p className="text-text-muted">
          Every league on Commish drafts either <TermLink term="snake-draft">snake</TermLink> or{" "}
          <TermLink term="auction-draft">auction</TermLink>. A snake draft has every manager pick
          in order, then the order reverses, back and forth, round after round. An auction draft
          lets every manager bid on every player from a shared budget, so nobody is ever locked
          out of a player, only outbid.
        </p>
        <p className="text-text-muted">
          Scoring is one of a small set of presets: Standard, <TermLink term="ppr">PPR</TermLink>{" "}
          (a full point for every catch), <TermLink term="half-ppr">Half PPR</TermLink> (half a
          point for every catch), or{" "}
          <TermLink term="te-premium">PPR with a TE premium</TermLink> (an extra bonus for a catch
          by a tight end on top of PPR). A commissioner may also hand-tune the point values, which
          reads as <TermLink term="custom-scoring">Custom scoring</TermLink> rather than any of
          the four presets.
        </p>
        <p className="text-text-muted">
          Every roster carries a <TermLink term="flex">FLEX</TermLink> spot a running back,
          receiver, or tight end can fill. A superflex league adds a second flex-like spot that
          also accepts a quarterback, so most managers in one start two. Some leagues also play a
          median game: on top of the regular head-to-head matchup, a team&apos;s score is
          compared to the league&apos;s median score that week, and the result counts as a second
          win, loss, or tie.
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
        {/* B4: a way forward, never a dead end — the last word on this page is a next step, not
            the paragraph above it. */}
        <p className="text-text-muted">
          Ready to see who is drafting soon?{" "}
          <Link href="/browse" className="font-medium text-accent underline">
            See open leagues
          </Link>
          .
        </p>
        <GlossarySection />
      </main>
      <PublicFooter />
    </>
  );
}
