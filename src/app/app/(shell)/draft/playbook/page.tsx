import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ArrivingSoonPage } from "@/draft-hq/arriving-soon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Playbook");

/** Phase 2 (spec §13 item 2): sim-backed strategy cards and the slot advisor. Not built yet. */
export default function DraftPlaybookPage() {
  return (
    <ArrivingSoonPage
      section="playbook"
      title="Playbook"
      sentence="The playbook is not built yet. It arrives once the simulator can back its strategy cards with real runs, rather than a claim nobody tested."
    />
  );
}
