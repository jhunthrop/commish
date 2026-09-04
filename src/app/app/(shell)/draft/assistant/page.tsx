import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ArrivingSoonPage } from "@/draft-hq/arriving-soon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Assistant");

/** Phase 3 (spec §13 item 3): the live room's autopick brain, demoed here on a replayed room.
 *  Not built yet. */
export default function DraftAssistantPage() {
  return (
    <ArrivingSoonPage
      section="assistant"
      title="Assistant"
      sentence="The assistant demo is not built yet. The live version arrives with the room work; it lives in your draft room's right rail today only as autopick, arguing your side rather than acting for you."
    />
  );
}
