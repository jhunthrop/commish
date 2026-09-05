import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ArrivingSoonPage } from "@/draft-hq/arriving-soon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Market");

/** Phase 4 (spec §13 item 4): ADP snapshots, edges, value windows, alerts, the weekly brief.
 *  Not built yet. */
export default function DraftMarketPage() {
  return (
    <ArrivingSoonPage
      section="market"
      title="Market"
      sentence="The market is not built yet. It arrives once we are snapshotting ADP over time; The Board already shows today's market edge on every ranked player."
    />
  );
}
