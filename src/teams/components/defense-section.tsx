"use client";

import Link from "next/link";
import { Stat } from "@/components/ui";
import { usePlayerPageHref } from "@/components/app-shell/shell-leagues";
import type { TeamDefenseSummary } from "../contract";
import { Section } from "./section";

interface DefenseFigure {
  readonly label: string;
  readonly value: string;
}

/** The season's figures and the facts behind them, each a count of real plays. Pure. */
export function defenseFigures(defense: TeamDefenseSummary): readonly DefenseFigure[] {
  const figures: DefenseFigure[] = [
    { label: "Points a game", value: defense.pointsPerGame.toFixed(1) },
    { label: `Points, ${defense.games} games`, value: defense.points.toFixed(1) },
    { label: "Sacks", value: String(defense.facts.sacks) },
    { label: "Takeaways", value: String(defense.facts.takeaways) },
    { label: "Touchdowns", value: String(defense.facts.defensiveTouchdowns + defense.facts.specialTeamsTouchdowns) },
  ];
  if (defense.facts.pointsAllowed !== null) figures.push({ label: `Points allowed, ${defense.facts.gamesWithPointsAllowed} games`, value: String(defense.facts.pointsAllowed) });
  if (defense.adpRank !== null) figures.push({ label: "Market order", value: `DEF${defense.adpRank}` });
  return figures;
}

/**
 * THE TEAM DEFENSE (coordinator's section 8): last season's line under the named scoring, the
 * facts behind it, its place in the market's order among defenses, and the link to the defense
 * row's own analysis page in the reader's league.
 */
export function DefenseSection({ defense }: { readonly defense: TeamDefenseSummary | null }) {
  const hrefFor = usePlayerPageHref();
  const href = defense === null ? null : hrefFor(defense.playerId);
  const basis = defense === null ? "" : `${defense.season} season under ${defense.scoringLabel} scoring, nflverse team defense weeks`;
  return (
    <Section title="Defense" basis={basis} held={defense !== null}>
      {defense === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {defenseFigures(defense).map((figure) => (
              <Stat key={figure.label} label={figure.label} value={figure.value} size="sm" />
            ))}
          </div>
          {href === null ? null : (
            <Link href={href} className="self-start text-sm text-accent underline">
              Defense analysis page
            </Link>
          )}
        </div>
      )}
    </Section>
  );
}
