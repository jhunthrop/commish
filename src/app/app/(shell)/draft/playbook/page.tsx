import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { Card, EmptyState, Meter, PageTitle, type SegmentOption } from "@/components/ui";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { totalRosterSlots } from "@/draft-engine";
import { LeaguePicker } from "@/draft-hq/league-picker";
import { myDraftLeagues, nextDraftingLeague, type DraftLeagueRow } from "@/draft-hq/league-context";
import { DraftSubnav } from "@/draft-hq/subnav";
import { SlotStrip } from "@/draft-hq/playbook/slot-strip";
import { canonicalSimFor, describeBuild, scarcityCurve } from "@/draft-hq/playbook/service";
import { BUILD_LABELS, type BuildLabel } from "@/draft-service/sim/classify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Playbook");

const BASE_PATH = "/app/draft/playbook";

const BUILD_TITLE: Readonly<Record<BuildLabel, string>> = {
  "hero-RB": "Hero-RB",
  "zero-RB": "Zero-RB",
  "robust-RB": "Robust RB",
  "early-TE": "Early TE",
  "late-QB": "Late-round QB",
};

const BUILD_CLAIM: Readonly<Record<BuildLabel, string>> = {
  "hero-RB": "One running back early, then the board's own best player every round after.",
  "zero-RB": "No running back through the first three rounds, on purpose.",
  "robust-RB": "Two or more running backs inside the first three rounds.",
  "early-TE": "A tight end inside the first two rounds, ahead of the room.",
  "late-QB": "No quarterback drafted anywhere in the first six rounds.",
};

function leaguePickerOptions(leagues: readonly DraftLeagueRow[]): readonly SegmentOption[] {
  const options: SegmentOption[] = [];
  if (leagues.length > 0) options.push({ value: "next", label: "Next draft" });
  for (const league of leagues) options.push({ value: league.leagueId, label: league.leagueName });
  options.push({ value: "generic", label: "Generic (PPR, 12-team)" });
  return options;
}

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * THE PLAYBOOK (spec §8) — strategy cards, the slot advisor, and the scarcity curve, every number
 * a real sim or real replacement-level data rather than a hand-written hot take. Reuses
 * `requestSimRun`'s own cache (`canonicalSimFor`) so a Playbook read and a Simulator run of the
 * identical league+slot never disagree, and reuses `LeaguePicker` for league context exactly like
 * The Board and the Simulator.
 */
export default async function DraftPlaybookPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const db = getDb();
  const params = await searchParams;
  const leagueParam = typeof params.league === "string" ? params.league : undefined;
  const slotParam = typeof params.slot === "string" ? Number(params.slot) : undefined;

  const leagues = await myDraftLeagues(db, user.id);

  let selected: DraftLeagueRow | null = null;
  let isGeneric = leagueParam === "generic";
  if (!isGeneric) {
    if (leagueParam !== undefined) {
      selected = leagues.find((league) => league.leagueId === leagueParam) ?? null;
      if (selected === null) isGeneric = true;
    } else {
      selected = await nextDraftingLeague(db, user.id);
      if (selected === null) isGeneric = true;
    }
  }

  const shape = selected === null ? { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } : { teamCount: selected.teamCount, rosterSlots: selected.rosterSlots };
  const slot = slotParam !== undefined && Number.isInteger(slotParam) && slotParam >= 1 && slotParam <= shape.teamCount ? slotParam : 1;
  const leagueId = isGeneric ? null : (selected?.leagueId ?? null);

  const [sim, curve] = await Promise.all([
    canonicalSimFor(db, user.id, { leagueId, shape, slot }),
    scarcityCurve(db, shape, totalRosterSlots(shape.rosterSlots)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <DraftSubnav current="playbook" />
      <div className="flex flex-col gap-1">
        <PageTitle>Playbook</PageTitle>
        <p className="text-sm text-text-muted">{"Every strategy tested under your league's rules, from your slot."}</p>
      </div>

      <LeaguePicker
        options={leaguePickerOptions(leagues)}
        value={isGeneric ? "generic" : leagueParam !== undefined ? (selected?.leagueId ?? "next") : "next"}
        basePath={BASE_PATH}
        extraQuery={{ slot: String(slot) }}
      />

      {sim.outcome === "no_evidence_board" ? (
        <EmptyState title="No evidence board yet" description="The Playbook needs the evidence board populated before it can sim any strategy honestly." action={null} />
      ) : sim.outcome === "over_budget" ? (
        <EmptyState title="Too many sims running" description="Wait for one of your in-flight sims to finish, then reload this page." action={null} />
      ) : sim.outcome === "league_not_found" ? (
        <EmptyState title="That league could not be found" description="Pick a different league above." action={null} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {BUILD_LABELS.map((label) => {
              const build = sim.summary!.builds.find((b) => b.label === label)!;
              return (
                <Card key={label} className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold text-text-primary">{BUILD_TITLE[label]}</h2>
                  <p className="text-sm text-text-muted">{BUILD_CLAIM[label]}</p>
                  <Meter label="Top-3 finish rate" value={Math.round(build.top3FinishRate * 100)} max={100} />
                  <p className="text-xs text-text-muted">{describeBuild(build, sim.summary!.runs, sim.summary!.baselineTop3Rate)}</p>
                </Card>
              );
            })}
          </div>

          {curve !== null ? (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-text-primary">Positional scarcity, drawn</h2>
              <p className="text-sm text-text-muted">{"Value over replacement at each round's own leading pick. The cliff is where you spend; the plateau is where you wait."}</p>
              <div className="flex items-end gap-1" style={{ height: "64px" }}>
                {curve.map((point) => {
                  const max = curve[0]!.valueOverReplacement || 1;
                  const heightPct = Math.max(2, Math.round((Math.max(0, point.valueOverReplacement) / max) * 100));
                  return <div key={point.round} title={`Round ${point.round}: ${point.valueOverReplacement.toFixed(1)} pts over replacement`} className="flex-1 rounded-t-sm bg-surface-inset" style={{ height: `${heightPct}%` }} />;
                })}
              </div>
              <div className="flex justify-between text-xs text-text-muted">
                <span>{`R${curve[0]!.round}`}</span>
                <span>{`R${curve[curve.length - 1]!.round}`}</span>
              </div>
            </Card>
          ) : (
            <Card className="text-sm text-text-muted">The scarcity curve needs the evidence board populated; it is not shown for this league yet.</Card>
          )}

          <Card className="flex flex-col gap-3">
            <span className="text-sm font-semibold text-text-primary">The slot advisor</span>
            <p className="text-sm text-text-muted">Every slot has its own book. Pick yours; the whole Playbook recomputes.</p>
            <SlotStrip teamCount={shape.teamCount} slot={slot} basePath={BASE_PATH} leagueQuery={isGeneric ? "generic" : leagueParam !== undefined ? (selected?.leagueId ?? null) : null} />
            <p className="text-xs text-text-muted">
              {`From slot ${slot}, ${sim.summary!.runs} simulated rooms measured a ${Math.round(sim.summary!.baselineTop3Rate * 100)}% baseline top-3 rate.`}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
