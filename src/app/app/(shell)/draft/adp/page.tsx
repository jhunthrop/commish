import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ArrivingSoonPage } from "@/draft-hq/arriving-soon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("ADP");

/** Phase 4 (spec §13 item 4): ADP snapshots, where our projection differs from ADP, value
 *  windows, alerts, the weekly brief. Not built yet. Named for what the screen will show (ADP over
 *  time), never "Market": fantasy words, not trading words (founder, 2026-09-07). */
export default function DraftAdpPage() {
  return (
    <ArrivingSoonPage
      section="adp"
      title="ADP"
      sentence="ADP over time is not built yet. It arrives once we are snapshotting ADP week to week. The Board already shows where our projection differs from ADP on every ranked player."
    />
  );
}
