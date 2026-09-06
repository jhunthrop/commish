"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, EmptyState, ErrorState, Meter, NOT_STARTED_DASH, SegmentGroup, Skeleton, StatPill, Table, type SegmentOption, type TableColumn } from "@/components/ui";
import { BUILD_LABEL_TEXT } from "@/draft-service/sim/classify";
import type { ExposureRow, PickAvailabilityRow, SimSummary } from "@/draft-service/sim/types";
import type { SimRunView } from "@/draft-service/sim/view";
import { showsConfidenceInterval, wilsonInterval } from "./confidence";
import { SIM_RUN_OPTIONS, SIM_SHARPNESS, SIM_SHARPNESS_OPTIONS, type SimSharpnessName } from "./constants";

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as { readonly ok: boolean; readonly data?: T; readonly error?: string };
  if (!response.ok || !body.ok) throw new Error(body.error ?? "Something went wrong asking the simulator.");
  return body.data as T;
}

function survivalTone(rate: number): "positive" | "warning" | "negative" {
  if (rate >= 0.66) return "positive";
  if (rate >= 0.34) return "warning";
  return "negative";
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

interface SimulatorClientProps {
  readonly leagueId: string | null;
  readonly leagueLabel: string;
  readonly teamCount: number;
  readonly rounds: number;
}

export function SimulatorClient({ leagueId, leagueLabel, teamCount, rounds }: SimulatorClientProps) {
  const [slot, setSlot] = useState(1);
  const [sharpnessName, setSharpnessName] = useState<SimSharpnessName>("mixed");
  const [runs, setRuns] = useState<(typeof SIM_RUN_OPTIONS)[number]>(SIM_RUN_OPTIONS[0]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const slotOptions: readonly SegmentOption[] = useMemo(
    () => Array.from({ length: teamCount }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    [teamCount],
  );
  const runOptions: readonly SegmentOption[] = SIM_RUN_OPTIONS.map((n) => ({ value: String(n), label: n.toLocaleString("en-US") }));

  const createRun = useMutation({
    mutationFn: () =>
      fetchJson<SimRunView>("/api/draft/sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, slot, rounds, runs, sharpness: SIM_SHARPNESS[sharpnessName] }),
      }),
    onSuccess: (run) => {
      setActiveRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["draft-sim-list"] });
    },
  });

  const runQuery = useQuery({
    queryKey: ["draft-sim-run", activeRunId],
    queryFn: () => fetchJson<SimRunView>(`/api/draft/sim/${activeRunId}`),
    enabled: activeRunId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 3_000 : false;
    },
  });

  const run = runQuery.data ?? (createRun.data && createRun.data.id === activeRunId ? createRun.data : undefined);
  const summary: SimSummary | undefined = run?.summary !== null && run?.summary !== undefined && "bySlot" in run.summary ? undefined : (run?.summary ?? undefined);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <Card className="flex h-fit flex-col gap-4">
        <span className="text-sm font-semibold text-text-primary">Set the room</span>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-primary">League</span>
          <p className="text-sm text-text-muted">{leagueLabel}</p>
        </div>

        <SegmentGroup label="Your slot" options={slotOptions} value={String(slot)} onChange={(v) => setSlot(Number(v))} />
        <SegmentGroup label="Room sharpness" options={SIM_SHARPNESS_OPTIONS} value={sharpnessName} onChange={(v) => setSharpnessName(v as SimSharpnessName)} />
        <SegmentGroup label="Runs" options={runOptions} value={String(runs)} onChange={(v) => setRuns(Number(v) as (typeof SIM_RUN_OPTIONS)[number])} />

        <Button variant="primary" className="w-full" loading={createRun.isPending} onClick={() => createRun.mutate()}>
          {`Run ${runs.toLocaleString("en-US")} drafts`}
        </Button>

        <p className="text-xs text-text-muted">
          {runs === SIM_RUN_OPTIONS[SIM_RUN_OPTIONS.length - 1]
            ? "10,000 runs computes as a background job. This page checks back on its own; you can leave and come back."
            : "The room drafts market ADP under this league's roster rules, reaching as far off it as the sharpness you set. Your seat drafts our board."}
        </p>
      </Card>

      <div className="flex flex-col gap-6">
        {createRun.isError ? <ErrorState title="The simulator could not start." description={(createRun.error as Error).message} action={<Button onClick={() => createRun.mutate()}>Try again</Button>} /> : null}

        {run === undefined ? (
          createRun.isPending ? (
            <Card>
              <Skeleton lines={4} />
            </Card>
          ) : (
            <EmptyState title="No sim run yet" description="Set the room on the left and run your first sim." action={null} />
          )
        ) : run.status === "failed" ? (
          <ErrorState title="This sim run failed." description={run.error ?? undefined} action={<Button onClick={() => createRun.mutate()}>Try again</Button>} />
        ) : run.status === "pending" || run.status === "running" ? (
          <Card className="flex flex-col gap-2">
            <StatPill label={run.status === "pending" ? "Queued" : "Running"} tone="accent" />
            <p className="text-sm text-text-muted">
              {run.status === "pending"
                ? "Waiting for a worker to pick this run up."
                : `Computing ${run.config.runs.toLocaleString("en-US")} drafts. This page refreshes on its own.`}
            </p>
          </Card>
        ) : summary === undefined ? (
          <EmptyState title="This run covers every slot" description="Find-my-best-slot results are not shown on this page yet; pick a single slot to see the full breakdown." action={null} />
        ) : (
          <>
            <BuildResultsCard summary={summary} teamCount={teamCount} />
            <AvailabilityCard rows={summary.availability} players={run.players} />
            <ExposureCard rows={summary.exposure} players={run.players} />
          </>
        )}
      </div>
    </div>
  );
}

function BuildResultsCard({ summary, teamCount }: { readonly summary: SimSummary; readonly teamCount: number }) {
  const showCi = showsConfidenceInterval(summary.runs);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-primary">
        {`What wins from pick ${summary.slot}`}
        <span className="ml-2 text-xs font-normal text-text-muted">{`${summary.runs.toLocaleString("en-US")} runs · finish rate top-3 of ${teamCount}`}</span>
      </h2>
      <div className="flex flex-col gap-3">
        {summary.builds.map((build) => {
          const ci = showCi ? wilsonInterval(Math.round(build.top3FinishRate * build.runsWithLabel), build.runsWithLabel) : null;
          return (
            <div key={build.label} className="flex flex-col gap-1">
              <Meter label={`${BUILD_LABEL_TEXT[build.label]} (${build.runsWithLabel} runs)`} value={Math.round(build.top3FinishRate * 100)} max={100} />
              {ci !== null ? <span className="text-xs text-text-muted">{`95% confidence: ${percent(ci.low)} to ${percent(ci.high)}`}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-muted">
        {`A build is read off your first six rounds. Baseline for any build with no real edge: ${percent(summary.baselineTop3Rate)} (3 of ${teamCount} teams finish top-3 by arithmetic alone).`}
      </p>
    </Card>
  );
}

function AvailabilityCard({ rows, players }: { readonly rows: readonly PickAvailabilityRow[]; readonly players: SimRunView["players"] }) {
  const columns: readonly TableColumn<PickAvailabilityRow>[] = [
    { key: "pick", header: "Your pick", cell: (row) => `${row.round}.${String(row.pickNumber).padStart(2, "0")}` },
    {
      key: "best",
      header: "Realistic best available",
      cell: (row) => (row.expectedBestAvailable === null ? NOT_STARTED_DASH : `${players[row.expectedBestAvailable.playerId]?.name ?? row.expectedBestAvailable.playerId} (${row.expectedBestAvailable.position})`),
    },
    {
      key: "odds",
      header: "Odds they last",
      cell: (row) => <StatPill label={percent(row.survivalRate)} tone={survivalTone(row.survivalRate)} />,
    },
    {
      key: "fallback",
      header: "If gone",
      cell: (row) => (row.fallbacks.length === 0 ? NOT_STARTED_DASH : row.fallbacks.map((f) => players[f.playerId]?.name ?? f.playerId).join(", ")),
    },
  ];
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-primary">Who is really there at your picks</h2>
      <Table
        caption="Availability at each of your picks"
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.pickNumber)}
        empty={<EmptyState title="No picks in this run" description="Increase rounds to see pick-by-pick availability." action={null} />}
      />
      <p className="text-xs text-text-muted">{"Odds come from where each player actually went across the sim's own runs, never from a single ADP number."}</p>
    </Card>
  );
}

function ExposureCard({ rows, players }: { readonly rows: readonly ExposureRow[]; readonly players: SimRunView["players"] }) {
  const top = rows.slice(0, 12);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-primary">Exposure report</h2>
      {top.length === 0 ? (
        <EmptyState title="No exposure yet" description="Run a sim to see who lands on your roster most often." action={null} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {top.map((row) => (
            <li key={row.playerId} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-primary">{`${players[row.playerId]?.name ?? row.playerId} (${row.position})`}</span>
              <span className="font-mono tabular-nums text-text-muted">{percent(row.rosterShare)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-muted">{"Your de facto team before you draft it: how often each player landed on this seat's roster across the runs."}</p>
    </Card>
  );
}
