import { PageTitle } from "@/components/ui";
import { DraftSubnav, type DraftSection } from "./subnav";

/**
 * THE HONEST ARRIVING-SOON STATE (phase 1 boundary, spec §13 item 1). Simulator, Assistant,
 * Market and Playbook are phases 2-4 (spec §13 items 2-4); phase 1 links to them from the HQ
 * cards without building them. `docs/superpowers/specs/2026-09-04-draft-hq-design.md`'s honesty
 * constraints (§12) forbid a placeholder with invented numbers or a fake preview — this is the
 * one sentence a surface with nothing real to show is allowed to say instead, shared by all four
 * routes so the four pages can never drift into four different tones of "coming soon."
 */
export function ArrivingSoonPage({ section, title, sentence }: { readonly section: DraftSection; readonly title: string; readonly sentence: string }) {
  return (
    <div className="flex flex-col gap-6">
      <DraftSubnav current={section} />
      <PageTitle>{title}</PageTitle>
      <p className="max-w-prose text-base text-text-muted">{sentence}</p>
    </div>
  );
}
