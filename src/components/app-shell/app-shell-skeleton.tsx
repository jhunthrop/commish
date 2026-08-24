import type { CSSProperties, ReactElement } from "react";
import { UI_CONFIG } from "@/components/ui/config";

export type AppShellSkeletonShape = "content" | "public" | "room";

export interface AppShellSkeletonProps {
  /**
   * Which chrome this skeleton is standing in for — see the module docblock. Each shape holds a
   * different geometry, never a different amount of announced text: all three say exactly
   * "Loading" and nothing else.
   */
  readonly shape: AppShellSkeletonShape;
}

/** One placeholder rectangle. Always `aria-hidden`: the ONE thing this component announces is
 *  the single "Loading" text below, never one of these. */
function PulseBlock({ className }: { readonly className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm bg-line/40 ${className}`} />;
}

function ContentGeometry(): ReactElement {
  return (
    <div className="flex w-full flex-col gap-6">
      <PulseBlock className="h-7 w-48" />
      {Array.from({ length: UI_CONFIG.skeleton.contentBlockCount }, (_, index) => (
        <PulseBlock key={index} className="h-32 w-full" />
      ))}
    </div>
  );
}

function PublicGeometry(): ReactElement {
  const barStyle = { height: UI_CONFIG.skeleton.publicBarHeightPx } as CSSProperties;
  return (
    <div className="flex w-full flex-col">
      <div aria-hidden="true" className="border-b border-line bg-surface" style={barStyle} />
      <div className="flex w-full flex-col gap-6 p-4">
        <PulseBlock className="h-7 w-64" />
        <PulseBlock className="h-40 w-full" />
        <PulseBlock className="h-40 w-full" />
      </div>
    </div>
  );
}

function RoomGeometry(): ReactElement {
  const railStyle = { minHeight: UI_CONFIG.skeleton.roomRailHeightPx } as CSSProperties;
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <div aria-hidden="true" className="shrink-0 border-b border-line bg-line/20" style={railStyle} />
      <div className="flex min-h-[480px] flex-1 flex-col lg:flex-row">
        <PulseBlock className="min-h-[200px] w-full lg:w-88 lg:shrink-0 lg:border-r lg:border-line" />
        <PulseBlock className="min-h-[280px] w-full flex-1" />
      </div>
    </div>
  );
}

/**
 * THE loading skeleton for every chrome in the product (Phase 3.6 addendum, Task 21, F7/F8) — one
 * component, three geometries, never a per-page mock:
 *
 * - `"content"` — `src/app/app/(shell)/loading.tsx`. `(shell)/layout.tsx` (ruling 8, as amended)
 *   already rendered the real top bar and league rail before this ever mounts, so this holds
 *   ONLY the content column a page's own data fills in. A skeleton rail drawn under a real rail
 *   would be two rails for the length of the fetch.
 * - `"public"` — `src/app/loading.tsx` and `src/app/app/(public)/join/[code]/loading.tsx`. Holds
 *   `PublicBar`'s geometry, never `PublicBar` itself: a signed-out visitor's skeleton must not
 *   promise a session this component cannot know exists.
 * - `"room"` — `src/app/app/(room)/drafts/[draftId]/loading.tsx`. The draft room renders no
 *   shell at all, so this is the room's own top band plus its pool/stage split, not the signed-in
 *   shell's.
 *
 * Announces exactly one thing, in every shape: an `aria-live="polite"` region reading "Loading"
 * — nothing about which league, which draft, or how many cards are coming, because a skeleton
 * cannot honestly know any of that yet. Every visible rectangle is `aria-hidden`.
 */
export function AppShellSkeleton({ shape }: AppShellSkeletonProps): ReactElement {
  return (
    <div data-testid="shell-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {shape === "content" ? <ContentGeometry /> : shape === "public" ? <PublicGeometry /> : <RoomGeometry />}
    </div>
  );
}
