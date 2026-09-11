import Link from "next/link";
import { RAIL_LABEL } from "@/components/ui/config";

/**
 * DRAFT HQ'S SUB-NAV (spec §2): HQ · The Board · My Sheet · Simulator · Assistant · ADP ·
 * Playbook, rendered by every page under `/app/draft/*`. The spec's "Market" section is named
 * ADP here for what the screen shows (fantasy words, not trading words, founder 2026-09-07).
 *
 * A plain server component, not a client one: every page under this section already knows which
 * section it is (it is the route that rendered), so highlighting the "here" segment needs no
 * live `usePathname` read the way `RailNav` needs one for a nav that many different routes share.
 * Passing `current` explicitly keeps this component usable from a server page with zero client
 * JS cost.
 */
export type DraftSection = "hq" | "board" | "sheet" | "simulator" | "assistant" | "adp" | "playbook";

interface SectionLink {
  readonly value: DraftSection;
  readonly href: string;
  readonly label: string;
}

const SECTIONS: readonly SectionLink[] = [
  { value: "hq", href: "/app/draft", label: "HQ" },
  { value: "board", href: "/app/draft/board", label: "The Board" },
  { value: "sheet", href: "/app/draft/sheet", label: "My Sheet" },
  { value: "simulator", href: "/app/draft/simulator", label: "Simulator" },
  { value: "assistant", href: "/app/draft/assistant", label: "Assistant" },
  { value: "adp", href: "/app/draft/adp", label: "ADP" },
  { value: "playbook", href: "/app/draft/playbook", label: "Playbook" },
];

export function DraftSubnav({ current }: { readonly current: DraftSection }) {
  return (
    // ONE ROW THAT SCROLLS, NOT TWO THAT WRAP (Sideline research round, from a measured phone
    // walk). Seven sections wrapped to two rows at 360px, and on the board — the densest comparison
    // surface in the product, whose job (P10) is fitting at least eight objects on a phone screen —
    // every pixel of chrome above the first row is a player the reader cannot see. A nav that
    // scrolls sideways keeps its own row and gives that one back.
    <nav aria-label="Draft HQ" className={`flex items-center gap-5 overflow-x-auto border-b border-line pb-3 whitespace-nowrap ${RAIL_LABEL} text-text-muted`}>
      {SECTIONS.map((section) => {
        const active = section.value === current;
        return (
          <Link
            key={section.value}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 pb-0.5 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "text-text-primary shadow-[inset_0_-2px_0_0_var(--commish-color-accent)]" : ""
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
