import { Table, type TableColumn } from "@/components/ui";
import type { TeamCompetition, UsageCount, UsageShare } from "../contract";
import { formatShare } from "./format";
import { Section } from "./section";

const SHARE_COLUMNS: readonly TableColumn<UsageShare>[] = [
  { key: "name", header: "Player", cell: (row) => row.name },
  { key: "count", header: "Count", cell: (row) => String(row.count), numeric: true },
  { key: "share", header: "Share", cell: (row) => formatShare(row.share), numeric: true },
];

const COUNT_COLUMNS: readonly TableColumn<UsageCount>[] = [
  { key: "name", header: "Player", cell: (row) => row.name },
  { key: "count", header: "Touches", cell: (row) => String(row.count), numeric: true },
];

function Leaders<T extends UsageCount>({ caption, columns, rows }: { readonly caption: string; readonly columns: readonly TableColumn<T>[]; readonly rows: readonly T[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-xs text-text-muted">{caption}</span>
      <Table caption={caption} columns={columns} rows={rows} rowKey={(row) => row.playerId} density="dense" empty={null} />
    </div>
  );
}

/**
 * WHO EATS (coordinator's section 6): three leader tables, each rendered only when the season's
 * attribution holds a leader for it. The share is stated against the club's own attributed total,
 * and the basis line says so.
 */
export function CompetitionSection({ competition }: { readonly competition: TeamCompetition | null }) {
  const basis = competition === null ? "" : `${competition.season} season, nflverse play-by-play attribution, shares of the club's attributed total`;
  return (
    <Section title="Target and touch competition" basis={basis} held={competition !== null}>
      {competition === null ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Leaders caption="Targets" columns={SHARE_COLUMNS} rows={competition.targets} />
          <Leaders caption="Carries" columns={SHARE_COLUMNS} rows={competition.carries} />
          <Leaders caption="Red-zone touches" columns={COUNT_COLUMNS} rows={competition.redZoneTouches} />
        </div>
      )}
    </Section>
  );
}
