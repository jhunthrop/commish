import Link from "next/link";
import { RAIL_LABEL } from "@/components/ui/config";

/**
 * DRAFT HQ'S SUB-NAV (spec §2): HQ · The Board · My Sheet · Simulator · Assistant · Market ·
 * Playbook, rendered by every page under `/app/draft/*`.
 *
 * A plain server component, not a client one: every page under this section already knows which
 * section it is (it is the route that rendered), so highlighting the "here" segment needs no
 * live `usePathname` read the way `RailNav` needs one for a nav that many different routes share.
 * Passing `current` explicitly keeps this component usable from a server page with zero client
 * JS cost.
 */
export type DraftSection = "hq" | "board" | "sheet" | "simulator" | "assistant" | "market" | "playbook";

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
  { value: "market", href: "/app/draft/market", label: "Market" },
  { value: "playbook", href: "/app/draft/playbook", label: "Playbook" },
];

export function DraftSubnav({ current }: { readonly current: DraftSection }) {
  return (
    <nav aria-label="Draft HQ" className={`flex flex-wrap items-center gap-5 border-b border-line pb-3 ${RAIL_LABEL} text-text-muted`}>
      {SECTIONS.map((section) => {
        const active = section.value === current;
        return (
          <Link
            key={section.value}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`pb-0.5 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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
