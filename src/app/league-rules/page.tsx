import { GAME_DEFINITION } from "@/league-room/lib/game-definition";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { Metadata } from "next";
import Link from "next/link";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ReadingFrame, ReadingSection } from "@/components/app-shell/reading-frame";
import { GlossarySection } from "./glossary-section";
import { TermLink } from "./term-link";

// A5: matches this page's own <h1> and the front door's nav label — "How it works", never
// "League rules" (`ShellFooter`'s own docblock, `@/components/app-shell/shell-footer.tsx`).
export const metadata: Metadata = pageTitle("How it works");

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/league-rules";

/**
 * THE PRODUCT'S ONE REFERENCE (Sunday v5, 2026-08-28).
 *
 * This page just became load-bearing. The founder's no-tips ruling of the same day — *"the UX
 * should explain itself, we shouldn't need tips"* — retires the `InfoTip` affordance that used to
 * carry a `GLOSSARY` definition to wherever a manager met the word, and points the curious here
 * instead, through the storefront rail's "How it works". A reference the product now depends on
 * has to actually carry the vocabulary.
 *
 * IT DID NOT. Before this pass the prose named seven of the glossary's twenty-two terms and the
 * `GlossarySection` beneath it printed those same seven. Fifteen words the product shows a
 * manager on a real screen — the draft queue, the lineup lock, the median game, the sit-and-go
 * kickoff, the stake tier, releasing a seat, and nine more — were defined in `src/help/glossary.ts`
 * and reachable from nowhere at all once the tips came out. Every one of them is on the page now,
 * in the chapter where a reader would look for it, with the full entry anchored below.
 *
 * WHAT THE CHAPTERS ARE FOR, beyond navigation: every `ReadingSection` carries an `id`, and every
 * `GLOSSARY` entry carries an `id="term-${key}"`, so a future `TermLink` anywhere in the product
 * can deep-link to either the chapter that explains a thing or the line that defines it. That is
 * the shape the ruling actually asks for — one reference, addressable — rather than a tip
 * reintroduced under another name.
 *
 * B4 (flow analysis journey J08) still holds and is untouched: the page opens with the same
 * plain-language `GAME_DEFINITION` the front door's hero used to lead with, byte-identical (both
 * are swept by `src/integrity/rendered-copy.test.tsx`), before any format vocabulary. A visitor
 * who presses "How it works" asking what fantasy football IS is answered before being taught a
 * rulebook. The honest-limits paragraph survives too, and still does not get the last word.
 *
 * `LEAGUE_CONFIG.regularSeasonWeeks`/`playoffTeams` own the week and team numbers
 * (`browse.ts`'s `PLAYOFF_WEEKS`), so no chapter here types a second copy of one.
 */
export default async function LeagueRulesPage() {
  const user = await getCurrentUser();
  return (
    <ReadingFrame title="How it works" kicker="Reference" lede={GAME_DEFINITION} intent={PAGE_INTENT} signedIn={user !== null}>
      <ReadingSection id="season" title="How a season goes">
        <p>
          It starts with a live draft, where every manager builds a full roster. From there, you
          play <TermLink term="matchup">one other manager</TermLink> each week: you choose who
          starts, and whatever they do in their real NFL games becomes your score. The best teams
          from the regular season close it out with a{" "}
          <TermLink term="playoffs">short playoff</TermLink>.
        </p>
      </ReadingSection>

      <ReadingSection id="drafts" title="Drafts">
        <p>
          Every league on Commish drafts either <TermLink term="snake-draft">snake</TermLink> or{" "}
          <TermLink term="auction-draft">auction</TermLink>. A snake draft has every manager pick
          in order, then the order reverses, back and forth, round after round. An auction draft
          lets every manager bid on every player from a shared budget, so nobody is ever locked
          out of a player, only outbid.
        </p>
        <p>
          In a snake league you rank the <TermLink term="draft-slot">draft slots</TermLink> you
          want before the room opens, and the draw gives each manager their highest-ranked slot
          still free. When it is your turn you are{" "}
          <TermLink term="on-the-clock">on the clock</TermLink>, with a countdown running. Rank
          players into <TermLink term="queue">your queue</TermLink> beforehand; if that clock runs
          out the room picks for you: your queue first, then the best player your roster needs. A
          draft never stalls on one manager.
        </p>
      </ReadingSection>

      <ReadingSection id="scoring" title="Scoring">
        <p>
          Scoring is one of a small set of presets: Standard,{" "}
          <TermLink term="ppr">PPR</TermLink> (a full point for every catch),{" "}
          <TermLink term="half-ppr">Half PPR</TermLink> (half a point for every catch), or{" "}
          <TermLink term="te-premium">PPR with a TE premium</TermLink> (an extra bonus for a catch
          by a tight end on top of PPR). Standard pays for yards and touchdowns and nothing for a
          catch. A commissioner may also hand-tune the point values, which reads as{" "}
          <TermLink term="custom-scoring">Custom scoring</TermLink> rather than any of the four
          presets.
        </p>
      </ReadingSection>

      <ReadingSection id="rosters" title="Rosters and lineups">
        <p>
          Every roster carries a <TermLink term="flex">FLEX</TermLink> spot a running back,
          receiver, or tight end can fill. A{" "}
          <TermLink term="superflex">superflex</TermLink> league adds a second flex-like spot that
          also accepts a quarterback, so most managers in one start two. Everyone else on your
          roster sits on <TermLink term="bench">the bench</TermLink>, scoring nothing that week
          but still yours to start later.
        </p>
        <p>
          Set your starters before the week&apos;s first game kicks off. That kickoff is the{" "}
          <TermLink term="lineup-lock">lineup lock</TermLink> for the whole week, not player by
          player, so nobody swaps a starter out after seeing how the early games went.
        </p>
      </ReadingSection>

      <ReadingSection id="standings" title="Standings and playoffs">
        <p>
          Standings rank every team by its{" "}
          <TermLink term="standings-record">record</TermLink> first: wins, losses and ties so far
          this season. Some leagues also play a{" "}
          <TermLink term="median-game">median game</TermLink>, where your score is compared to the
          league median that week on top of your head-to-head matchup, and the result counts as a
          second win, loss, or tie. Once the regular season ends, the top teams play the{" "}
          <TermLink term="playoffs">playoff bracket</TermLink>: win and you advance, lose and your
          season is over.
        </p>
      </ReadingSection>

      <ReadingSection id="house-leagues" title="House leagues and open seats">
        <p>
          A Commish <TermLink term="house-league">house league</TermLink> is one the platform
          itself runs rather than a commissioner: the rules are the same in every one, and a new
          one opens whenever one fills, so there is always a seat to take.
        </p>
        <p>
          Most open leagues are{" "}
          <TermLink term="sit-and-go">sit-and-go</TermLink>: there is no draft time on the
          calendar, and the room drafts on its own shortly after the last seat fills.{" "}
          <TermLink term="release-seat">Releasing your seat</TermLink> before that puts it back on
          the board for someone else. Every league also carries a{" "}
          <TermLink term="stake-tier">stake tier</TermLink>, which describes how seriously it
          plays. It is a label, not an entry fee.
        </p>
      </ReadingSection>

      <ReadingSection id="reviews" title="Reviews">
        <p>
          Reviews on this site are ordered by when they were written and are never filtered by
          rating. A <TermLink term="verified-reviewer">verified reviewer</TermLink> badge marks a
          review left by someone who has actually played here.{" "}
          <Link href="/reviews" className="font-medium text-accent underline">
            Read what managers are saying
          </Link>
          .
        </p>
      </ReadingSection>

      <ReadingSection id="limits" title="What this product does not do yet">
        <p>
          This product does not yet support a waiver wire, a trade deadline, or keeper and dynasty
          formats. A card or a league page never claims one of those, because a feature this
          product cannot deliver has no business on a page a stranger reads to decide whether to
          join.
        </p>
        {/* B4: a way forward, never a dead end — the last word on this page is a next step, not
            the paragraph above it. */}
        <p>
          <Link href="/browse" className="font-medium text-accent underline">
            See who is drafting soon
          </Link>
          .
        </p>
      </ReadingSection>

      <GlossarySection />
    </ReadingFrame>
  );
}
