import { GLOSSARY, type TermKey } from "@/help/glossary";
import { Panel } from "@/components/ui";

/**
 * The seven format-vocabulary terms this page's own prose links to (E10, Task 10) — the same
 * set `glossary.source.test.ts`'s `UNSURFACED` allowlist named as unwired before the addendum's
 * Task 21 gave them a page to land on. Order matches the order each term first appears in the
 * prose above, so a reader scanning down finds them in the sequence they were promised.
 */
export const LEAGUE_RULES_GLOSSARY_TERMS: readonly TermKey[] = ["snake-draft", "auction-draft", "ppr", "half-ppr", "te-premium", "custom-scoring", "flex"];

/**
 * `/league-rules`'s own glossary — every `TermLink` on this page jumps here, to the matching
 * `id="term-${key}"`, and reads the FULL entry (`GLOSSARY[key].detail`), not just the short line
 * `InfoTip`'s `guided` mode prints inline. A reading page reads: the definition is one anchor
 * away, never a second control to open (E10).
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
