import type { Metadata } from "next";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PageTitle } from "@/components/ui";
import { AssistantDemo } from "@/draft-hq/assistant-demo/demo";
import { ASSISTANT_DEMO_FIXTURE } from "@/draft-hq/assistant-demo/fixture";
import { DraftSubnav } from "@/draft-hq/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Assistant");

/**
 * Phase 3 (spec §13 item 3): the Assistant's own guided demo — "a guided demo of it with a
 * replayed room" (spec §6's opening line). The real Assistant lives in a live or mock draft
 * room's right rail (`DrawerAssistantTab`); this page exists so a manager who has never seen it
 * can watch it work before their own draft, without a room of their own to watch it in.
 *
 * A SERVER-RENDERED PAGE around a CLIENT component: `ASSISTANT_DEMO_FIXTURE`
 * (`@/draft-hq/assistant-demo/fixture.ts`) is a plain, JSON-safe, already-computed object — built
 * once at module scope from a real headless replay, never per request and never from the
 * database — handed to `AssistantDemo` as an ordinary prop. The only client-side state is which
 * step of the replay is showing.
 */
export default function DraftAssistantPage() {
  return (
    <div className="flex flex-col gap-6">
      <DraftSubnav current="assistant" />
      <div className="flex flex-col gap-1">
        <PageTitle>Assistant</PageTitle>
        <p className="max-w-prose text-sm text-text-muted">
          The assistant argues for your seat, one pick at a time. It never drafts for you. Step through a replayed room below to see how it reads a run, a
          tier break and a bye collision, and how it grades your own pick the moment it lands.
        </p>
      </div>
      <AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />
    </div>
  );
}
