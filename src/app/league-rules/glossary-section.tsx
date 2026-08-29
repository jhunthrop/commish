import { GLOSSARY, type TermKey } from "@/help/glossary";
import { Panel } from "@/components/ui";

/**
 * EVERY TERM THE PRODUCT DEFINES, in the order this page's own prose introduces it.
 *
 * It used to be seven — the format-vocabulary set `glossary.source.test.ts`'s `UNSURFACED`
 * allowlist named as unwired before the addendum's Task 21 gave them a page to land on. The
 * founder's no-tips ruling (2026-08-28) changed what this list has to be: with `InfoTip` retired,
 * this section is the ONLY place in the product a `GLOSSARY` definition reaches a reader, so a
 * term missing from it is a word the product shows a manager and never explains anywhere. All
 * twenty-two are here now.
 *
 * DERIVED, NOT DUPLICATED, in the direction that matters: the ORDER is written out (a reader
 * scanning down should meet terms in the sequence the chapters promised them, which no automatic
 * ordering knows), while `glossary.test.ts`'s own completeness check is what makes a term added
 * to `GLOSSARY` and forgotten here fail loudly rather than quietly go undefined.
 */
export const LEAGUE_RULES_GLOSSARY_TERMS: readonly TermKey[] = [
  // How a season goes
  "matchup",
  "playoffs",
  // Drafts
  "snake-draft",
  "auction-draft",
  "draft-slot",
  "on-the-clock",
  "queue",
  // Scoring
  "ppr",
  "half-ppr",
  "te-premium",
  "custom-scoring",
  // Rosters and lineups
  "flex",
  "superflex",
  "bench",
  "lineup-lock",
  // Standings and playoffs
  "standings-record",
  "median-game",
  // House leagues and open seats
  "house-league",
  "sit-and-go",
  "release-seat",
  "stake-tier",
  // Reviews
  "verified-reviewer",
];

/**
 * `/league-rules`'s own glossary — every `TermLink` on this page jumps here, to the matching
 * `id="term-${key}"`, and reads the FULL entry (`GLOSSARY[key].detail`), not just the short line
 * `InfoTip`'s `guided` mode used to print inline. A reading page reads: the definition is one
 * anchor away, never a second control to open (E10, and now the whole product's only answer).
 */
export function GlossarySection() {
  return (
    <Panel title="Glossary">
      <dl className="flex flex-col gap-4">
        {LEAGUE_RULES_GLOSSARY_TERMS.map((key) => {
          const entry = GLOSSARY[key];
          return (
            <div key={key} id={`term-${key}`} className="scroll-mt-4">
              <dt className="font-medium text-text-primary">{entry.term}</dt>
              <dd className="text-sm text-text-muted">{entry.detail}</dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}
