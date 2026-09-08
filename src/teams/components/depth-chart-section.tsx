import { Table, type TableColumn } from "@/components/ui";
import { TEAM_PAGE_CONFIG } from "../config";
import type { DatedDepthChart, DepthChartGroup, TeamDepthCharts } from "../contract";
import { formatStampedDate } from "./format";
import { Section } from "./section";

const SLOT_KEYS = Array.from({ length: TEAM_PAGE_CONFIG.depthChartSlots }, (_, index) => index + 1);

function nameAt(group: DepthChartGroup, slot: number): string {
  return group.slots.find((listed) => listed.slot === slot)?.name ?? "";
}

const COLUMNS: readonly TableColumn<DepthChartGroup>[] = [
  { key: "position", header: "Pos", cell: (group) => group.position },
  ...SLOT_KEYS.map((slot): TableColumn<DepthChartGroup> => ({ key: `slot-${slot}`, header: String(slot), cell: (group) => nameAt(group, slot), hideOnNarrow: slot > 2 })),
];

function ChartTable({ caption, chart }: { readonly caption: string; readonly chart: DatedDepthChart }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs text-text-muted">{`${caption}, ${formatStampedDate(chart.asOf)}`}</span>
      <Table caption={caption} columns={COLUMNS} rows={chart.groups} rowKey={(group) => group.position} density="dense" empty={null} />
    </div>
  );
}

/**
 * TWO DATED CHARTS SIDE BY SIDE (coordinator's section 5): the release's week-one chart and the
 * harvest's current one, each stamped, because a depth chart is a claim about a moment. Below `sm`
 * the third and fourth slots drop rather than the names shrinking (law 3).
 */
export function DepthChartSection({ charts }: { readonly charts: TeamDepthCharts | null }) {
  const basis = charts === null ? "" : `${charts.season} season, nflverse depth charts and the harvest's current chart`;
  return (
    <Section title="Depth chart" basis={basis} held={charts !== null}>
      <div className="flex flex-col gap-4">
        {charts?.release === null || charts === null ? null : <ChartTable caption="Week one chart" chart={charts.release} />}
        {charts?.harvest === null || charts === null ? null : <ChartTable caption="Current chart" chart={charts.harvest} />}
      </div>
    </Section>
  );
}
