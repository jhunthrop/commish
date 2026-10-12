import type { Metadata } from "next";
import { withAdmin } from "@/app/api/admin/_shared";
import { JobRerunControl } from "@/admin-room/components/job-rerun-control";
import { Badge, PageTitle, Table, type TableColumn } from "@/components/ui";
import { getDb } from "@research/db/client";
import { deadLetterJobs, recentRuns, scheduleStatuses, type DeadLetterRow, type RecentRunRow, type ScheduleStatusRow } from "@/jobs/admin-view";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Jobs");

/** Minute-precision UTC, mono, unambiguous: operators compare these against cron hours and log
 *  lines, where a locale-pretty date would only add translation work. */
function instant(iso: string | null): string {
  return iso === null ? "-" : `${iso.slice(0, 16).replace("T", " ")}Z`;
}

function mono(text: string): React.ReactNode {
  return <span className="whitespace-nowrap font-mono text-text-muted">{text}</span>;
}

/**
 * A JOB'S STATE AS A CHIP TONE, and never a literal colour. `running` is the LIVE channel — the
 * one thing on the page that is happening right now — where it used to be `warning`, which in
 * Sideline is the rose a clock running out wears. A job that is merely working is not in trouble.
 */
const statusTone = (status: string): "negative" | "positive" | "live" | "neutral" =>
  status === "failed" || status === "abandoned" ? "negative" : status === "succeeded" ? "positive" : status === "running" ? "live" : "neutral";

/** Two facts in one cell, the identifier over the detail — how this operator surface keeps four
 *  columns (`TOKENS.density.maxColumns`) without dropping anything an operator reads. */
function stacked(lead: React.ReactNode, under: React.ReactNode): React.ReactNode {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium text-text-primary">{lead}</span>
      <span className="text-xs text-text-muted">{under}</span>
    </span>
  );
}

function deadLetterColumns(): readonly TableColumn<DeadLetterRow>[] {
  // FOUR COLUMNS. The status chip and the instant it died belong to the job that died, so they
  // ride its own cell rather than buying two more columns on a six-column table.
  return [
    {
      key: "job",
      header: "Job",
      cell: (row) => (
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{`${row.name} #${row.jobId}`}</span>
            <Badge tone="negative">{row.status}</Badge>
          </span>
          <span className="text-xs text-text-muted">{`died ${instant(row.finishedAt)}`}</span>
        </span>
      ),
    },
    { key: "attempts", header: "Attempts", cell: (row) => mono(`${row.attempts}/${row.maxAttempts}`), numeric: true },
    {
      key: "error",
      header: "Last error",
      cell: (row) => <span className="break-words text-text-muted">{row.lastError ?? "No error text recorded."}</span>,
    },
    { key: "action", header: <span className="sr-only">Action</span>, cell: (row) => <JobRerunControl jobId={row.jobId} /> },
  ];
}

function scheduleColumns(): readonly TableColumn<ScheduleStatusRow>[] {
  return [
    {
      key: "schedule",
      header: "Schedule",
      cell: (row) => stacked(row.name, row.description),
    },
    { key: "cron", header: "Cron", cell: (row) => mono(`${row.cron} (${row.timezone})`) },
    { key: "cursor", header: "Evaluated to", cell: (row) => mono(instant(row.cursor)), hideOnNarrow: true },
    {
      key: "lastFire",
      header: "Last fire",
      cell: (row) =>
        row.lastFire === null ? (
          <span className="text-text-muted">No fire yet.</span>
        ) : (
          <span className="flex items-center gap-2">
            {mono(instant(row.lastFire.at))}
            <Badge tone={statusTone(row.lastFire.jobStatus)}>{row.lastFire.jobStatus}</Badge>
          </span>
        ),
    },
  ];
}

function runColumns(): readonly TableColumn<RecentRunRow>[] {
  // FOUR COLUMNS: a run's start time belongs to the run, so it rides the job's own cell.
  return [
    { key: "job", header: "Job", cell: (row) => stacked(`${row.name} #${row.jobId}`, `started ${instant(row.startedAt)}`) },
    { key: "attempt", header: "Attempt", cell: (row) => mono(String(row.attempt)), numeric: true },
    { key: "status", header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
    {
      key: "error",
      header: "Error",
      cell: (row) =>
        row.error === null ? (
          <span className="text-text-muted">-</span>
        ) : (
          <span className="break-words text-text-muted">{`${row.errorKind === null ? "" : `[${row.errorKind}] `}${row.error}`}</span>
        ),
    },
  ];
}

/**
 * The job system's operator surface: dead letters first (a terminal failure must be impossible
 * to miss), then the code-defined schedules with their cursors and last fires, then recent runs.
 * Reads come from `@/jobs/admin-view`; the one action re-enqueues a fresh copy of a terminal job
 * through `POST /api/admin/jobs/rerun`. `withAdmin`'s Server Component overload gates it like
 * every page in this tree (`admin-routes.test.ts`).
 */
export default async function AdminJobsPage() {
  return withAdmin(async () => {
    const db = getDb();
    const [deadLetters, schedules, runs] = await Promise.all([deadLetterJobs(db), scheduleStatuses(db), recentRuns(db)]);

    return (
      <>
        <header className="flex flex-col gap-1">
          <PageTitle>Jobs</PageTitle>
          <p className="text-sm text-text-muted">
            The durable job queue behind the season cadence. Failures land at the top and stay until an operator acts.
          </p>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-primary">Needs attention</h2>
          <Table
            caption="Dead-lettered jobs, newest first"
            columns={deadLetterColumns()}
            rows={deadLetters}
            rowKey={(row) => String(row.jobId)}
            empty={<p className="text-sm text-text-muted">Nothing needs attention. No job has failed terminally.</p>}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-primary">Schedules</h2>
          <Table
            caption="Code-defined schedules and their most recent fires"
            columns={scheduleColumns()}
            rows={schedules}
            rowKey={(row) => row.name}
            empty={<p className="text-sm text-text-muted">No schedules are defined in code.</p>}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-primary">Recent runs</h2>
          <Table
            caption="Recent job runs, newest first"
            columns={runColumns()}
            rows={runs}
            rowKey={(row) => String(row.runId)}
            empty={<p className="text-sm text-text-muted">No runs yet. The runner has not worked any jobs.</p>}
          />
        </section>
      </>
    );
  });
}
