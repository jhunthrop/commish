import type { PlayerFactsSchedule } from "@/capsules/facts/types";
import { Table, type TableColumn } from "@/components/ui";
import { formatFixture } from "./format";
import { Section } from "./section";

interface ScheduleRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** The schedule as fixtures and counts, no strength judgment anywhere (the reader's own rule). Pure. */
export function scheduleRows(schedule: PlayerFactsSchedule, byeWeek: number | null, playoffWeeks: readonly number[]): readonly ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  if (schedule.weekOneOpponent !== null) rows.push({ key: "week-one", label: "Week 1", value: formatFixture(schedule.weekOneOpponent) });
  if (byeWeek !== null) rows.push({ key: "bye", label: "Bye", value: `Week ${byeWeek}` });
  if (schedule.playoffWeeks.length > 0) {
    const [first, last] = [playoffWeeks[0], playoffWeeks[playoffWeeks.length - 1]];
    rows.push({ key: "playoffs", label: `Weeks ${first} to ${last}`, value: schedule.playoffWeeks.map(formatFixture).join(" · ") });
  }
  rows.push({ key: "venues", label: "Home and road", value: `${schedule.homeGames} home · ${schedule.roadGames} road` });
  return rows;
}

const COLUMNS: readonly TableColumn<ScheduleRow>[] = [
  { key: "label", header: "When", cell: (row) => row.label },
  { key: "value", header: "Fixture", cell: (row) => row.value },
];

export function ScheduleSection({ schedule, byeWeek, season, playoffWeeks }: { readonly schedule: PlayerFactsSchedule | null; readonly byeWeek: number | null; readonly season: number; readonly playoffWeeks: readonly number[] }) {
  const rows = schedule === null ? [] : scheduleRows(schedule, byeWeek, playoffWeeks);
  return (
    <Section title="Schedule" basis={`${season} schedule as published`} held={schedule !== null}>
      <Table caption="Schedule" columns={COLUMNS} rows={rows} rowKey={(row) => row.key} density="dense" empty={null} />
    </Section>
  );
}
