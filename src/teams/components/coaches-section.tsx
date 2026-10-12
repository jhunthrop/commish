import type { PlayerFactsCoaching } from "@research/capsules/facts/types";
import { Table, type TableColumn } from "@/components/ui";
import { Section } from "./section";

interface CoachRow {
  readonly key: string;
  readonly role: string;
  readonly name: string;
  readonly note: string;
}

/** The two rows the curated table can state, each only when it names somebody. Pure. */
export function coachRows(coaching: PlayerFactsCoaching): readonly CoachRow[] {
  const rows: CoachRow[] = [];
  if (coaching.headCoach !== null) {
    rows.push({ key: "head", role: "Head coach", name: coaching.headCoach, note: coaching.headCoachIsNew === true ? "New this year" : "" });
  }
  if (coaching.playCaller !== null) {
    const role = coaching.playCallerRole === null ? "Play caller" : `Play caller, ${coaching.playCallerRole}`;
    rows.push({ key: "caller", role, name: coaching.playCaller, note: coaching.playCallerIsNew === true ? "New this year" : "" });
  }
  return rows;
}

const COLUMNS: readonly TableColumn<CoachRow>[] = [
  { key: "role", header: "Role", cell: (row) => row.role },
  { key: "name", header: "Name", cell: (row) => row.name },
  { key: "note", header: "Change", cell: (row) => row.note },
];

export function CoachesSection({ coaching, season }: { readonly coaching: PlayerFactsCoaching | null; readonly season: number }) {
  const rows = coaching === null ? [] : coachRows(coaching);
  return (
    <Section title="Coaches" basis={`Curated coaches file, ${season}`} held={rows.length > 0}>
      <Table caption="Coaches" columns={COLUMNS} rows={rows} rowKey={(row) => row.key} density="dense" empty={null} />
    </Section>
  );
}
