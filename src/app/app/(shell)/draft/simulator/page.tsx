import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ArrivingSoonPage } from "@/draft-hq/arriving-soon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Simulator");

/** Phase 2 (spec §13 item 2): headless Monte Carlo over the real draft engine. Not built yet. */
export default function DraftSimulatorPage() {
  return (
    <ArrivingSoonPage
      section="simulator"
      title="Simulator"
      sentence="The simulator is not built yet. It arrives in the next phase of Draft HQ, running the real draft engine thousands of times to show what wins from your slot."
    />
  );
}
