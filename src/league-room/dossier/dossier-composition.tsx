import { absenceSlotKey, ABSENCE_MODULES, narrativeSlot, NARRATIVE_KEYS } from "@/capsules/narrative-slots";
import { EdgeCell, SourceStrip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import type { PlayerSeasonBody } from "@/league-service/player";
import type { ReactNode } from "react";
import { callCardPropsFor, hasReadCardFor, hasStoryCellFor, sourcesFor, weeksFor } from "../lib/player-season-view";
import { Outlook } from "../outlook/outlook";
import { BooksModule } from "./books-module";
import { CallCard } from "./call-card";
import { NewsList } from "./news-list";
import { RangeRail } from "./range-rail";
import { ReadCard } from "./read-card";
import { RoleModule } from "./role-module";
import { SeasonChartFallback } from "./season-chart-fallback";
import { SeasonStrip } from "./season-strip";
import { SeasonTotalsAndLog } from "./season-totals-and-log";
import { StoryModule } from "./story-module";
import { WhyGroups } from "./why-groups";

/**
 * LAW 1, AND THE ONE FIGURE ON THIS PAGE THAT EARNS CHROMA — *"every number is a delta, not a
 * fact"*. Market rank, expert rank and our own rank all sit quiet and grey in the strip beside
 * this; the disagreement BETWEEN two of them is the only comparison on the screen, so it is the
 * only thing with colour on it.
 *
 * WHICH TWO, AND WHY IT IS NOT OURS. The delta this product exists to sell is our board against
 * the room, and our board holds no rank for the season in progress (`PlayerSeasonBody` carries the
 * full account). Law 7 forbids drawing that one, so the honest delta available today is the one
 * between the two sources that ARE here: what the drafting public did, and what the experts said.
 * `EdgeCell` renders a `null` gap as an untinted dash, so a player either side is missing simply
 * shows the absence — which is the same seam our own rank lands in the day the engine emits one.
 *
 * THE SIGN IS FROM THE EXPERTS' SEAT, and it has to be stated because ranks invert: a LOWER number
 * is a better player. `market - experts` is positive when the market lets him fall past where the
 * experts have him, which is the experts rating him HIGHER — exactly what `EdgeCell`'s positive
 * direction means, with the counterparty named in words rather than implied by the sign.
 *
 * Full-page only (`depth === "full"`) — the peek's own fallback composition never had this cell;
 * moved here unchanged from `players/[playerId]/page.tsx` when Task 7 (fix round 1, IMPORTANT 4)
 * merged the two nearly-identical compositions into one shared component.
 */
function Edge({ body }: { readonly body: PlayerSeasonBody }) {
  const { adp } = body.player;
  const gap = adp === null || body.expertRank === null ? null : adp - body.expertRank;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`${MICRO_LABEL} text-text-faint`}>Experts vs market</span>
      <EdgeCell gap={gap} against="the draft market" />
    </div>
  );
}

export interface DossierCompositionProps {
  readonly body: PlayerSeasonBody;
  /** `null`/`undefined` alike are the SAME "nothing to build the dossier composition from" state
   *  (Player Dossier plan, Task 5) — `undefined` is a fixture predating the dossier, `null` is the
   *  board never having ranked him. Callers fold both into `null` before this prop, once, rather
   *  than each repeating the double-check. */
  readonly dossier: PlayerDossierFacts | null;
  /** Which surface this is: the bottom-sheet peek (capped Outlook, no `Edge` cell, compact Read,
   *  the peek's own historical `WhyGroups` cap) or the full page (none of those caps, plus
   *  `Edge`). The one thing `readVariant`/`whyCap` do not already cover on their own — see this
   *  prop's own two call sites for the exact difference each depth makes. */
  readonly depth: "peek" | "full";
  readonly switcher?: ReactNode;
  readonly played: boolean;
  /** `ReadCard`'s own size — "compact" for the peek, "full" for the page's uncapped Read. */
  readonly readVariant: "compact" | "full";
  /** `WhyGroups`' own cap — `5` for the peek's historical limit, `undefined` for the full page's
   *  "show every group" posture. */
  readonly whyCap?: number;
}

/**
 * THE SHARED DOSSIER COMPOSITION (fix round 1, IMPORTANT 4) — the ~45 lines `player-peek.tsx` and
 * `players/[playerId]/page.tsx` each carried byte-for-byte identically (Task 6's own two call
 * cards through `WhyGroups`, plus the season totals/log and the dossier-null fallback), now built
 * once. The two callers differ only in what `depth`/`readVariant`/`whyCap` state — everything else
 * drawn here is the SAME composition for both surfaces, on purpose: a player who looks different
 * in the peek than on his own page is a bug, not a feature, of this product's shape.
 *
 * CRITICAL 2's OWN FIX LIVES HERE: `SeasonStrip` labels its card `${story.season}` (always LAST
 * season — `dossierFactsFor` never varies `lastSeasonStory` by which season the viewer currently
 * has selected) while charting `weeksFor(body)`, which is `body.season`'s own weeks — the season
 * the viewer is CURRENTLY looking at, most often the current season once it has a scored week.
 * Rendering the strip whenever `body.season !== dossier.lastSeasonStory.season` would print a
 * header naming one season over bars from a different one, with the switcher inside the card
 * moving the bars but never the header. `SeasonStrip` renders ONLY when the two agree — the viewer
 * has actually navigated to the season the story describes — and `SeasonChartFallback` (labeled
 * honestly with whichever season IS selected) covers every other case, including the ordinary
 * default view of a played current season.
 */
export function DossierComposition({ body, dossier, depth, switcher, played, readVariant, whyCap }: DossierCompositionProps) {
  const hasReadCard = hasReadCardFor(body);
  const hasStoryCell = hasStoryCellFor(body);
  // CRITICAL 2's own fix — see this component's own docblock for the mismatch this narrowing
  // closes: `null` unless the story's own season is the one currently on screen.
  const matchingStory = dossier !== null && dossier.lastSeasonStory !== null && dossier.lastSeasonStory.season === body.season ? dossier.lastSeasonStory : null;

  return (
    <>
      {dossier === null ? (
        <>
          {/* TODAY'S LAYOUT, UNCHANGED — the binding fallback (Task 5's own rule, kept for both
              surfaces): a player without board facts still gets the source strip (plus, on the
              full page only, the market edge), the Outlook (verdict and capsule included), and
              his season. */}
          {depth === "peek" ? (
            <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
              <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
              <Edge body={body} />
            </div>
          )}
          <Outlook reasons={body.reasons} laws={body.laws} position={body.player.position} capsule={body.capsule} capped={depth === "peek"} />
          {/* A KICKER AND A TEAM DEFENSE LAND HERE, ALWAYS (the 2026-09-06 round): the board
              ranks neither, so `dossier` is null for both and this fallback is their whole page.
              It used to be a source strip of dashes over an empty chart. The role module now
              carries what the archive measurably holds about them, and the chart below it draws
              the season those same weeks came from. */}
          {body.kdefSeason === null ? null : (
            <RoleModule position={body.player.position} usage={null} trend={null} kdef={body.kdefSeason} />
          )}
          <SeasonChartFallback body={body} switcher={switcher} played={played} />
        </>
      ) : (
        <>
          {/* THE CALL, FIRST — the identical adapter both surfaces use (`callCardPropsFor`,
              `league-room/lib/player-season-view.ts`). */}
          <CallCard {...callCardPropsFor(body, dossier)} perGameSentence={narrativeSlot(body.capsule, NARRATIVE_KEYS.perGame)} />

          {/* THREE SEPARATE ROW GRIDS, NOT ONE SIX-ITEM GRID (the peek's own review fix, kept
              identical on both surfaces): a single flat `grid-cols-2` auto-places every child in
              DOM order, so a missing member (most commonly `ReadCard`, absent until the capsule
              sweep reaches him) shifts every LATER pair across the seam. One grid per row keeps a
              missing member's effect confined to its own row: the surviving member spans both
              columns rather than sitting alone on the left with the right column empty. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RangeRail projection={dossier.projection} availability={dossier.availability} />
            <RoleModule
              position={body.player.position}
              usage={dossier.usage}
              trend={dossier.trend}
              writtenTrend={narrativeSlot(body.capsule, NARRATIVE_KEYS.trend)}
              absenceSentence={narrativeSlot(body.capsule, absenceSlotKey(ABSENCE_MODULES.usage))}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ReadCard capsule={body.capsule} variant={readVariant} />
            <div className={hasReadCard ? undefined : "lg:col-span-2"}>
              <BooksModule
                books={dossier.books}
                sentence={narrativeSlot(body.capsule, NARRATIVE_KEYS.books) ?? narrativeSlot(body.capsule, absenceSlotKey(ABSENCE_MODULES.books))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={hasStoryCell ? undefined : "lg:col-span-2"}>
              {matchingStory === null ? (
                <SeasonChartFallback body={body} switcher={switcher} played={played} />
              ) : (
                <SeasonStrip
                  story={matchingStory}
                  weeks={weeksFor(body)}
                  scoringLabel={dossier.basis.scoringLabel}
                  switcher={switcher}
                  sentence={narrativeSlot(body.capsule, NARRATIVE_KEYS.story)}
                />
              )}
            </div>
            {!hasStoryCell ? null : (
              <div className="flex flex-col gap-4">
                {/* The season-ending story service wiring converges post-merge (ruling R-d1) —
                    `story` stays `null` here for now, so this renders only the current
                    designation pill, or nothing, honestly. */}
                <StoryModule story={null} designation={body.injuryDesignation} />
                <NewsList news={body.news} />
              </div>
            )}
          </div>

          {/* THE WHY — `whyCap` is the peek's own historical `5` or the full page's `undefined`
              ("show every group, no expander"). */}
          <WhyGroups reasons={body.reasons} laws={body.laws} position={body.player.position} cap={whyCap} capsule={body.capsule} />
        </>
      )}

      {/* SEASON TOTALS + GAME LOG (founder, 2026-08-30: ESPN-depth) — stays below the fold in
          both compositions, exactly where it always was. */}
      <SeasonTotalsAndLog body={body} />

      {/* News stays below the fold ONLY in the fallback composition (no dossier) — the dossier
          composition already rendered this same list once, beside `StoryModule`, further up.
          Never both: see `NewsList`'s own docblock. */}
      {dossier === null ? <NewsList news={body.news} /> : null}
    </>
  );
}
