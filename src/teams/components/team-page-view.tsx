import { FANTASY_PLAYOFF_WEEKS } from "@/capsules/facts/schedule";
import type { TeamPageData } from "../contract";
import { CoachesSection } from "./coaches-section";
import { CompetitionSection } from "./competition-section";
import { DefenseSection } from "./defense-section";
import { DepthChartSection } from "./depth-chart-section";
import { OffenseSection } from "./offense-section";
import { RosterSection } from "./roster-section";
import { ScheduleSection } from "./schedule-section";
import { TeamHeader } from "./team-header";

/**
 * THE TEAM ANALYSIS PAGE, COMPOSED (coordinator's ruling, sections in order): header, coaches,
 * offense profile, the fantasy players, depth chart, target and touch competition, schedule,
 * defense. Paired sections sit side by side at `lg` and stack on a phone; every section renders
 * its heading, and its data only when the store holds it.
 */
export function TeamPageView({ data }: { readonly data: TeamPageData }) {
  return (
    <div className="flex flex-col gap-4">
      <TeamHeader data={data} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CoachesSection coaching={data.coaching} season={data.season} />
        <OffenseSection profile={data.offense} />
      </div>
      <RosterSection players={data.players} season={data.season} />
      <DepthChartSection charts={data.depthCharts} />
      <CompetitionSection competition={data.competition} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ScheduleSection schedule={data.schedule} byeWeek={data.byeWeek} season={data.season} playoffWeeks={FANTASY_PLAYOFF_WEEKS} />
        <DefenseSection defense={data.defense} />
      </div>
    </div>
  );
}
