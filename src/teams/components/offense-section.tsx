import { Table, type TableColumn } from "@/components/ui";
import type { RankedFigure, TeamOffenseProfile } from "../contract";
import { formatShare, formatSigned } from "./format";
import { Section } from "./section";

interface ProfileRow {
  readonly key: string;
  readonly measure: string;
  readonly value: string;
  readonly rank: string;
}

function rankText(figure: RankedFigure): string {
  return `${figure.rank} of ${figure.of}`;
}

/** The three fingerprint rows, each only when the store holds a reading. Pure. */
export function profileRows(profile: TeamOffenseProfile): readonly ProfileRow[] {
  const rows: ProfileRow[] = [];
  if (profile.pace !== null) rows.push({ key: "pace", measure: "Seconds a play, rank 1 fastest", value: profile.pace.value.toFixed(1), rank: rankText(profile.pace) });
  if (profile.passRate !== null) rows.push({ key: "pass", measure: "Pass rate, rank 1 most", value: formatShare(profile.passRate.value), rank: rankText(profile.passRate) });
  if (profile.passRateOverExpected !== null) {
    rows.push({ key: "proe", measure: "Pass rate over expected, rank 1 most", value: formatSigned(profile.passRateOverExpected.value), rank: rankText(profile.passRateOverExpected) });
  }
  return rows;
}

const COLUMNS: readonly TableColumn<ProfileRow>[] = [
  { key: "measure", header: "Measure", cell: (row) => row.measure },
  { key: "value", header: "Value", cell: (row) => row.value, numeric: true },
  { key: "rank", header: "Rank", cell: (row) => row.rank, numeric: true },
];

export function OffenseSection({ profile }: { readonly profile: TeamOffenseProfile | null }) {
  const rows = profile === null ? [] : profileRows(profile);
  const basis = profile === null ? "" : `${profile.season} season, nflverse play-by-play, situation-neutral means${profile.neutralPlays === null ? "" : ` over ${profile.neutralPlays} plays`}`;
  return (
    <Section title="Offense profile" basis={basis} held={rows.length > 0}>
      <Table caption="Offense profile" columns={COLUMNS} rows={rows} rowKey={(row) => row.key} density="dense" empty={null} />
    </Section>
  );
}
