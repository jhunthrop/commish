# Phase 1 Plan C — Live Draft Room (snake + auction) & TV Board

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the React half of the draft product — the five missing UI primitives, one client data layer that keeps a draft view in sync over SSE, the live snake room, the live auction room, the pick-landing celebration, and the read-only TV draftboard — so a 12-person snake or auction draft can actually be run in a browser on top of Plan B's engine, service, API and events.

**Architecture:** Three layers, strictly separated. (1) `src/components/ui/**` gains `Select`, `Modal`, `Toast`, `Table`, `Avatar` — generic, token-only, both-themes, axe-clean. (2) `src/draft-room/state/**` is **pure and 100%-covered**: `applyDraftEvent(view, data)` folds a `draft.*` SSE frame into a `DraftStateView`, and `optimisticView(view, action, myTeamId)` produces the acting client's instant, display-only patch. (3) `src/draft-room/hooks/**` + `src/draft-room/components/**` are React: one `useDraftRoom(draftId)` hook fetches the view, opens a native `EventSource` (whose own reconnect + `Last-Event-ID` is the only reconnect mechanism), applies events in `sequence` order, **refetches the full view on any sequence gap or reconnect**, and submits actions optimistically with rollback on 409. **No draft rule is ever re-implemented in React** — every value the UI shows (whose turn, deadline, tier, min bid, max bid, budgets, slot index) is computed by the engine and carried in the view or the event payload; Task 4 adds the few that were missing.

**Tech Stack:** Next.js 15 App Router (server components for auth + shell, `"use client"` for the room), React 19, TypeScript strict, Tailwind v4 CSS-first `@theme` aliases over `--commish-*` tokens, Zod v4 at the SSE boundary, native `EventSource`, Vitest + happy-dom + @testing-library/react + vitest-axe.

**Spec:** `plans/fantasy-mvp-prototype.md` — **Step 4** (every UI bullet: snake board with searchable/filterable pool, live rosters, pick clock, visible tightening tier and "shortens in…", pick-landing celebration with a distinct own-pick treatment respecting reduced motion, read-only large-format TV draftboard at `/draft/<id>/board`, optimistic acting client, disconnect/reconnect via native `EventSource` + `Last-Event-ID` with full-state refetch fallback), **Step 5** (auction UI: current nomination, live bid + bidder, bid time remaining, remaining budget per team; reconnect/resync hardening for a missed bid war and budget desync), and **Step 1**'s design-system bullet for the five primitives Plan A did not build (`Select`, `Modal`, `Toast`, `Table`, `Avatar` — verified absent from `src/components/ui/index.ts`). Product intent: `docs/research/2026-08-16-beating-apex-strategy.md` §4 (this category is emotionally flat; the draft is the wow moment) and `docs/research/2026-08-16-ux-review.md` (C1–C4, I1, I3, I4, I8, I10).

**Depends on:** Plan B (`docs/superpowers/plans/2026-08-17-phase1-plan-b-draft-engine.md`), complete on branch `worktree-phase1-plan-b-draft-engine`. Plan C consumes its engine, selectors, API routes and events, and changes them only where Task 4 says so.

## Global Constraints

Copied from `docs/conventions.md`, `docs/design-system.md` and Plan B — every task's requirements implicitly include these:

- **No MVP.** Nothing built in a form a later phase plans to throw away.
- **Immutability:** every domain, engine and view type is `readonly`; arrays are `readonly T[]`; never mutate an input — return new objects. React state is replaced, never mutated in place.
- **No ambient clock** in `src/domain/**`, `src/draft-engine/**`, or `src/draft-room/state/**`: no `Date.now()`, no `new Date()` for "now". Client components may read the wall clock **for countdown display only**, and only through the single `useNow(intervalMs)` hook in `src/draft-room/hooks/use-now.ts`. Nothing else in the browser calls `Date.now()`.
- **Config over magic numbers:** tunables live in a `config.ts` next to the module. `DRAFT_ROOM_CONFIG` (`src/draft-room/state/config.ts`) owns every duration, interval and page size in the room; `TOKENS.motion` owns every animation duration. No inline literals.
- **Test-first.** Tests live beside code as `src/<feature>/**/*.test.ts(x)`; run with `npm test -- src/<dir>`, never by guessed filename. Test files run serially (`fileParallelism: false`, already configured).
- **Coverage:** `src/scoring/**`, `src/draft-engine/**` and (added by Task 5) `src/draft-room/state/**` must be 100% branches/functions/lines/statements. If a branch is uncovered, add a test — never lower the threshold. Verify **UNFILTERED** with `npm run test:coverage` (a path-filtered coverage run reports the other gated directories at 0%).
- **Real-time — one mechanism.** Redis Streams → SSE on `league:<id>:events`, consumed by the browser's **native `EventSource`**. The browser's own reconnect and its automatic `Last-Event-ID` header are the entire reconnect mechanism: **no custom reconnect loop, no backoff timer, no polling, no second transport.** A **full-state refetch of `GET /api/drafts/[draftId]` is the documented fallback**, triggered on exactly two conditions — an event whose `clock.sequence` is more than one past ours (a gap), and an `EventSource` `open` that follows an `error` (a reconnect).
- **Event types** are enumerated once in `src/lib/realtime/events.ts`. Add nothing there.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error }` via `src/lib/api/respond.ts`; bodies parsed with `parseJson(request, ZodSchema)`. Error strings are user-facing plain language — never raw DB/exception text. The client validates every SSE payload with Zod before trusting it.
- **Identity:** server code reads "who is this" only via `getCurrentUser()` / `requireCurrentUser()`. **API routes return a JSON 401, never a redirect.** Pages under `/app` redirect via `src/middleware.ts`.
- **Client-supplied `teamId` is never sent.** The POST body schema (`clientDraftActionSchema`) has no `teamId` and no `timestamp`. **`TIMER_EXPIRE` is never sent by a client** — the server ticker is its only producer.
- **No draft-rule logic in React.** Turn order, eligibility, slot assignment, budget/reserve math, clock tiers and deadlines are the engine's. If the UI needs a value it does not have, that is an engine/API gap to close server-side (Task 4), not something to compute in a component. Enforced structurally: **everything under `src/draft-room/**` and `src/app/app/drafts/**` imports from `@/draft-engine` with `import type` only.**
- **Every user-visible surface:** designed and tested in **light + dark**, `axe`-clean, keyboard-operable, with **loading / empty / error / success** states that always offer a next action, rendering at **360px**, in plain-language copy. Motion respects `prefers-reduced-motion`.
- **Verification for every task:** `npm run typecheck && npm run lint && npm test -- <dir>`; the final task also `npm run test:coverage` (unfiltered) and `npm run build`.
- **Commits:** conventional commits; the body says *why* and records any deviation from the plan.
- **`docs/conventions.md` and `docs/design-system.md` outrank this plan's inline reference code.** If reference code in a task contradicts them, follow the conventions and note it in the task report.
- **Reference code in tasks is authoritative for interfaces, names, and test cases.** Implementers may restructure bodies for DRY without changing behavior.
- **Disputed type/compile claims are settled with `tsc`, not argument.** Run `npm run typecheck`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/components/ui/select.tsx` | `Select` — labelled native `<select>`, same label/error/hint contract as `Input`. |
| `src/components/ui/avatar.tsx` | `Avatar` — image with deterministic initials fallback; decorative or labelled. |
| `src/components/ui/modal.tsx` | `Modal` — `role="dialog"` + `aria-modal`, focus trap, Esc closes, focus returned to the opener. |
| `src/components/ui/toast.tsx` | `ToastProvider` + `useToast()` — one live region, auto-dismiss (reduced-motion-aware), optional action. |
| `src/components/ui/table.tsx` | `Table` — semantic `<table>` with caption + scoped headers, horizontally scrollable at 360px. |
| `src/components/ui/config.ts` | `UI_CONFIG` — tunables shared by the primitives (toast timings). |
| `src/components/ui/index.ts` (modify) | Barrel: the five new primitives + `UI_CONFIG`. |
| `src/design/use-reduced-motion.ts` | `usePrefersReducedMotion()` + `REDUCED_MOTION_QUERY` — shared by `Toast` and the celebration. |
| `src/draft-engine/state.ts` (modify) | `CompletedPick` gains `slotIndex` — the client must never re-derive a roster slot ordinal. |
| `src/draft-engine/apply-pick.ts` (modify) | Records `slotIndex` on the pick. |
| `src/draft-engine/selectors.ts` (modify) | `DraftClockView` + `draftClockView(state)`; `maxBidsFor(state)`; `DraftStateView` extends the clock view and gains `minBid` / `maxBids`. |
| `src/draft-engine/events.ts` (modify) | Every `draft.*` payload carries `{ draftId, clock: DraftClockView }`; `draft.pick` additionally carries `budgets` + `maxBids` for auctions. |
| `src/draft-service/pool.ts` (modify) | `rankedPlayers(db, leagueId)` — the ranked player rows; `buildDraftPool` becomes a projection of it. |
| `src/draft-service/teams.ts` | `listTeamCards(db, leagueId)` — team + owner display name/avatar for the room. |
| `src/domain/league.ts` (modify) | `TeamCard` — the pure DTO the room renders. |
| `src/lib/api/respond.ts` (modify) | `ApiEnvelope<T>` — the response type the browser parses. |
| `src/app/api/drafts/[draftId]/players/route.ts` | `GET` — ranked player metadata (id/name/position/nflTeam) for the pool, behind the same actor check. |
| `src/app/api/drafts/[draftId]/route.ts` (modify) | Adds `teams: readonly TeamCard[]` to the success envelope. |
| `src/draft-room/state/config.ts` | `DRAFT_ROOM_CONFIG` — every tunable in the room. |
| `src/draft-room/state/payloads.ts` | Zod schemas for the five `draft.*` payloads + the SSE envelope. The client's boundary validation. |
| `src/draft-room/state/apply-event.ts` | `applyDraftEvent(view, data)` — pure fold of one SSE frame into a `DraftStateView`; reports `resync` on a gap. |
| `src/draft-room/state/optimistic.ts` | `optimisticView(view, action, myTeamId)` — the acting client's instant, display-only patch. |
| `src/draft-room/state/format.ts` | `formatCountdown`, `formatClockLength`, `formatGap`, `formatTightening`, `rosterSpots` — pure display formatting. |
| `src/draft-room/hooks/deps.tsx` | `DraftRoomDepsProvider` / `useDraftRoomDeps()` — injectable `fetch` + `EventSource` factory. |
| `src/draft-room/hooks/use-now.ts` | `useNow(intervalMs)` — the ONE wall-clock read in the browser. |
| `src/draft-room/hooks/use-draft-room.ts` | `useDraftRoom(draftId)` — fetch → subscribe → apply → gap/reconnect refetch → optimistic submit. |
| `src/draft-room/test-fixtures.tsx` | Shared view/player/team fixtures, `FakeEventSource`, `fixtureDeps()`, `renderInRoom()`. Not a `.test.` file, so vitest does not collect it. |
| `src/draft-room/components/clock-banner.tsx` | On-the-clock banner, countdown, current tier, "picks shorten to N in H:MM". |
| `src/draft-room/components/player-pool.tsx` | Searchable / position-filterable ranked pool with drafted state and the act affordance. |
| `src/draft-room/components/roster-board.tsx` | Per-team slot grid, own team emphasized. |
| `src/draft-room/components/pick-history.tsx` | The pick log. |
| `src/draft-room/components/connection-banner.tsx` | Reconnecting / offline status. |
| `src/draft-room/components/pick-celebration.tsx` | The pick-landing moment; distinct own-pick treatment; reduced-motion aware. |
| `src/draft-room/components/auction-lot.tsx` | Current nomination, high bid + bidder, bid-window countdown. |
| `src/draft-room/components/bid-controls.tsx` | Bid control driven by `minBid` and `maxBids` from the view. |
| `src/draft-room/components/nominate-modal.tsx` | Confirms a nomination and its opening bid. |
| `src/draft-room/components/budget-table.tsx` | Remaining budget, max bid and open slots per team. |
| `src/draft-room/components/snake-room.tsx` | The snake layout. |
| `src/draft-room/components/auction-room.tsx` | The auction layout. |
| `src/draft-room/components/draft-room.tsx` | The client entry point: loading/error states, the toast seam, and the format switch. |
| `src/draft-room/components/tv-board.tsx` | Read-only large-format board. |
| `src/app/app/drafts/[draftId]/page.tsx` | Authed server page → `<DraftRoom draftId>`. |
| `src/app/draft/[draftId]/board/page.tsx` | Authed server page → `<TvBoard draftId>`. |
| `src/app/globals.css` (modify) | Two keyframes for the pick-landing moment, driven by token durations. |
| `vitest.config.mts` (modify) | `src/draft-room/state` added to the 100% coverage gate. |
| `docs/design-system.md` (modify) | The five new primitives + motion guidance. |
| `docs/draft-room.md` | The client data flow: fetch → SSE → apply → gap → refetch; optimistic submit; reconnect. |
| `docs/conventions.md` (modify) | Directory-map entries for `src/draft-room/` and the new pages. |
| `docs/draft-engine.md` (modify) | The revised event payload table (Task 4). |

No new npm dependencies are installed by this plan.

---

### Task 1: `Select` and `Avatar` primitives

**Model tier:** cheap/standard (transcription of specified components).

**Files:**
- Create: `src/components/ui/select.tsx`, `src/components/ui/avatar.tsx`
- Modify: `src/components/ui/index.ts`
- Test: `src/components/ui/select.test.tsx`, `src/components/ui/avatar.test.tsx`

**Interfaces:**
- Consumes: `inBothThemes` (`src/components/ui/test-utils.tsx`), the Tailwind token aliases documented in `docs/design-system.md`.
- Produces:
  - `SelectOption = { readonly value: string; readonly label: string }`
  - `SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children">` with `label: string` (required, visible), `options: readonly SelectOption[]`, `error?: string`, `hint?: string`, `id?: string`.
  - `Select` — a `forwardRef` component over `HTMLSelectElement`.
  - `AvatarProps = { readonly name: string; readonly src?: string | null; readonly size?: "sm" | "md" | "lg"; readonly label?: string; readonly className?: string }`
  - `Avatar(props: AvatarProps)` and `initialsFor(name: string): string`.

**Design notes the implementer must preserve:**
- `Select` mirrors `Input`'s accessibility contract exactly (visible `<label htmlFor>`, `useId` fallback, `aria-invalid` + `aria-describedby` on error) so the two are learnable as one pattern. It renders a **native `<select>`** — a custom listbox would be a new keyboard/screen-reader surface to own for no gain here.
- `Avatar` is decorative by default (`aria-hidden`), because it is nearly always rendered next to the same person's name; passing `label` opts into `role="img"` with that accessible name. Initials come from `name` — never from an id — so they are stable and meaningful.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ui/select.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Select } from "./select";
import { inBothThemes } from "./test-utils";

const POSITIONS = [
  { value: "ALL", label: "All positions" },
  { value: "QB", label: "Quarterback" },
  { value: "RB", label: "Running back" },
];

describe("Select", () => {
  it("has a visible label, renders its options, and is axe-clean in both themes", async () => {
    await inBothThemes(<Select label="Position" options={POSITIONS} defaultValue="ALL" />, async ({ container }) => {
      const select = screen.getByLabelText("Position");
      expect(select.tagName).toBe("SELECT");
      expect(screen.getByRole("option", { name: "Running back" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("reports the chosen value to onChange", () => {
    const onChange = vi.fn();
    render(<Select label="Position" options={POSITIONS} defaultValue="ALL" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "QB" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Position") as HTMLSelectElement).value).toBe("QB");
  });

  it("links its hint and error text and marks itself invalid", () => {
    render(<Select label="Position" options={POSITIONS} hint="Filter the pool." error="Pick a position." />);
    const select = screen.getByLabelText("Position");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect((select.getAttribute("aria-describedby") ?? "").split(" ")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a position.");
    expect(screen.getByText("Filter the pool.")).toBeInTheDocument();
  });

  it("is disabled when asked", () => {
    render(<Select label="Position" options={POSITIONS} disabled />);
    expect(screen.getByLabelText("Position")).toBeDisabled();
  });
});
```

```tsx
// src/components/ui/avatar.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Avatar } from "./avatar";
import { inBothThemes } from "./test-utils";

describe("Avatar", () => {
  it("falls back to initials and stays decorative by default, in both themes", async () => {
    await inBothThemes(<Avatar name="Dana Whitfield" />, async ({ container }) => {
      expect(screen.getByText("DW")).toBeInTheDocument();
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("uses a single initial for a one-word name and ignores middle words", () => {
    const { rerender } = render(<Avatar name="Prince" />);
    expect(screen.getByText("P")).toBeInTheDocument();
    rerender(<Avatar name="  ada  byron   lovelace " />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("shows a question mark rather than nothing for a blank name", () => {
    render(<Avatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders the image when a src is given, with an empty alt while decorative", () => {
    const { container } = render(<Avatar name="Dana Whitfield" src="/a.png" />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/a.png");
    expect(img).toHaveAttribute("alt", "");
  });

  it("becomes an accessible image when labelled", async () => {
    const { container } = render(<Avatar name="Dana Whitfield" label="Dana Whitfield" src="/a.png" />);
    expect(screen.getByRole("img", { name: "Dana Whitfield" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/ui/select src/components/ui/avatar`
Expected: FAIL — cannot find module `./select` / `./avatar`.

- [ ] **Step 3: Implement `Select`**

```tsx
// src/components/ui/select.tsx
import { forwardRef, useId, type SelectHTMLAttributes } from "react";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children"> {
  /** Required: every control in this product has a visible label. */
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly error?: string;
  readonly hint?: string;
  readonly id?: string;
}

/**
 * A native `<select>` with `Input`'s exact label/hint/error contract. Deliberately not a
 * custom listbox: the platform control is already keyboard- and screen-reader-complete on
 * every device we support, including the 360px phone baseline.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, hint, id: givenId, className = "", ...rest },
  ref,
) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={
          "h-10 rounded-md border bg-surface-elevated px-3 text-md text-text-primary " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          "disabled:opacity-60 disabled:cursor-not-allowed " +
          (error ? "border-negative " : "border-border ") +
          className
        }
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
});
```

- [ ] **Step 4: Implement `Avatar`**

```tsx
// src/components/ui/avatar.tsx
export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** The person's display name — the source of the initials fallback. */
  readonly name: string;
  readonly src?: string | null;
  readonly size?: AvatarSize;
  /** Provide to make the avatar an accessible image; omit to leave it decorative. */
  readonly label?: string;
  readonly className?: string;
}

const SIZE: Readonly<Record<AvatarSize, string>> = {
  sm: "size-6 text-xs",
  md: "size-8 text-sm",
  lg: "size-12 text-lg",
};

/** First letter of the first and last words, upper-cased. "Ada Byron Lovelace" → "AL". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Decorative by default — an avatar almost always sits beside the same person's name, and
 * announcing it twice is noise. Pass `label` when the avatar stands alone.
 */
export function Avatar({ name, src, size = "md", label, className = "" }: AvatarProps) {
  const a11y = label === undefined ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return (
    <span
      {...a11y}
      className={
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill " +
        `border border-border bg-surface-elevated font-semibold text-text-primary ${SIZE[size]} ${className}`
      }
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar URLs are arbitrary remote hosts; next/image would need a per-host allowlist we do not have in Phase 1
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span>{initialsFor(name)}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 5: Export from the barrel**

```ts
// src/components/ui/index.ts — append these two lines
export { Select, type SelectProps, type SelectOption } from "./select";
export { Avatar, initialsFor, type AvatarProps, type AvatarSize } from "./avatar";
```

- [ ] **Step 6: Run the tests and the checks**

Run: `npm test -- src/components/ui`
Expected: PASS — every existing primitive suite plus the new `Select` and `Avatar` suites.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/select.tsx src/components/ui/avatar.tsx src/components/ui/select.test.tsx src/components/ui/avatar.test.tsx src/components/ui/index.ts
git commit -m "feat(ui): Select and Avatar primitives with both-theme + axe tests"
```

---
### Task 2: `Modal`, `ToastProvider`/`useToast`, and the shared reduced-motion hook

**Model tier:** standard (focus management and live regions are easy to get subtly wrong).

**Files:**
- Create: `src/design/use-reduced-motion.ts`, `src/components/ui/config.ts`, `src/components/ui/modal.tsx`, `src/components/ui/toast.tsx`
- Modify: `src/components/ui/index.ts`
- Test: `src/design/use-reduced-motion.test.tsx`, `src/components/ui/modal.test.tsx`, `src/components/ui/toast.test.tsx`

**Interfaces:**
- Consumes: `Button` (`./button`), `Icon` (`./icon`), `inBothThemes`.
- Produces:
  - `REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"`, `usePrefersReducedMotion(): boolean` (`@/design/use-reduced-motion`).
  - `UI_CONFIG` (`./config`) — `{ toast: { dismissMs, reducedMotionDismissMs, maxVisible } }`.
  - `ModalProps = { readonly open: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly footer?: ReactNode }`; `Modal(props): JSX.Element | null`.
  - `ToastTone = "info" | "success" | "error"`; `ToastInput = { readonly message: string; readonly tone?: ToastTone; readonly action?: { readonly label: string; readonly onClick: () => void } }`; `ToastProvider({ children })`; `useToast(): { readonly show: (input: ToastInput) => void }`.

**Design notes the implementer must preserve:**
- The modal renders **nothing** when closed (no hidden DOM to trap focus in), is `role="dialog"` + `aria-modal="true"` + `aria-labelledby` its own title, moves focus to the first focusable element inside on open, cycles Tab/Shift+Tab inside the panel, closes on `Escape`, and **returns focus to the element that had it before it opened**.
- Toasts are the product's failure channel: a rejected draft action shows the reducer's plain-language reason here. Error toasts are `role="alert"` (assertive); everything else rides the container's `aria-live="polite"`. Auto-dismiss is **longer under `prefers-reduced-motion`**, because a user who has asked for less motion is also the user most likely to need more reading time — the value is `UI_CONFIG`'s, never a literal.
- `usePrefersReducedMotion` starts `false` and reads `matchMedia` in an effect. Initialising from `matchMedia` during render would differ between the server render and hydration — the same hydration trap `ThemeProvider` already documents.

- [ ] **Step 1: Write the failing reduced-motion hook test**

```tsx
// src/design/use-reduced-motion.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { REDUCED_MOTION_QUERY, usePrefersReducedMotion } from "./use-reduced-motion";

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(matches: boolean) {
  const listeners: Listener[] = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? matches : false,
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_type: string, listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  }));
  return { emit: (next: boolean) => listeners.forEach((l) => l({ matches: next })) };
}

function Probe() {
  return <p>{usePrefersReducedMotion() ? "reduced" : "full"}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("reports full motion when the query does not match", () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("reports reduced motion when the query matches", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("follows the preference changing while mounted", () => {
    const media = stubMatchMedia(false);
    render(<Probe />);
    act(() => media.emit(true));
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement the hook and the UI config**

Run: `npm test -- src/design/use-reduced-motion`
Expected: FAIL — cannot find module `./use-reduced-motion`.

```ts
// src/design/use-reduced-motion.ts
"use client";

import { useEffect, useState } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The one place the app asks whether the user wants less motion. Starts `false` and reads
 * `matchMedia` after mount: reading it during render would make the server-rendered markup
 * and the hydrating client's first render disagree (the same trap `ThemeProvider` documents).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
```

```ts
// src/components/ui/config.ts
/** Tunables shared by the UI primitives. No component may inline one of these values. */
export const UI_CONFIG = {
  toast: {
    /** How long a toast stays up, in ms. */
    dismissMs: 5_000,
    /** Longer dwell for users who asked for reduced motion — they also want more reading time. */
    reducedMotionDismissMs: 10_000,
    /** Oldest toasts beyond this are dropped so the stack can never cover the page. */
    maxVisible: 3,
  },
} as const;
```

- [ ] **Step 3: Write the failing `Modal` test**

```tsx
// src/components/ui/modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Nominate a player</Button>
      <Modal open={open} title="Nominate a player" onClose={() => setOpen(false)}>
        <Button>Confirm</Button>
      </Modal>
    </div>
  );
}

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(<Modal open={false} title="Nominate a player" onClose={() => {}}>body</Modal>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled aria-modal dialog, axe-clean in both themes", async () => {
    await inBothThemes(
      <Modal open title="Nominate a player" onClose={() => {}}>
        <p>Choose an opening bid.</p>
      </Modal>,
      async ({ container }) => {
        const dialog = screen.getByRole("dialog", { name: "Nominate a player" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Modal open title="Nominate a player" onClose={onClose}>body</Modal>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open and back to the opener on close", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Nominate a player" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(opener).toHaveFocus();
  });

  it("cycles Tab inside the dialog instead of escaping to the page", () => {
    render(
      <Modal open title="Nominate a player" onClose={() => {}} footer={<Button>Confirm</Button>}>
        <Button>Cancel</Button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("ignores keys that are neither Escape nor Tab", () => {
    const onClose = vi.fn();
    render(<Modal open title="Nominate a player" onClose={onClose}><Button>Cancel</Button></Modal>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `Modal`**

Run: `npm test -- src/components/ui/modal`
Expected: FAIL — cannot find module `./modal`.

```tsx
// src/components/ui/modal.tsx
"use client";

import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  readonly open: boolean;
  /** Also the dialog's accessible name. */
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Replaces the default "Close" button row. */
  readonly footer?: ReactNode;
}

/**
 * A focus-trapped dialog. Renders nothing when closed — there is no hidden copy of the panel
 * to tab into. On open it takes focus; on close it hands focus back to whatever had it, so a
 * keyboard user never loses their place.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    first?.focus();
    return () => {
      openerRef.current?.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel === null) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border border-border bg-surface-elevated p-4 focus-visible:outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold text-text-primary">
          {title}
        </h2>
        <div className="mt-3 text-md text-text-primary">{children}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {footer ?? (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the failing `Toast` test**

```tsx
// src/components/ui/toast.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { UI_CONFIG } from "./config";
import { ToastProvider, useToast } from "./toast";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Publisher() {
  const { show } = useToast();
  return (
    <div>
      <Button onClick={() => show({ message: "Someone else picked first. Try again.", tone: "error" })}>Fail</Button>
      <Button onClick={() => show({ message: "Pick submitted.", tone: "success" })}>Succeed</Button>
      <Button onClick={() => show({ message: "Draft paused.", action: { label: "Resume", onClick: () => show({ message: "Resumed." }) } })}>
        Actionable
      </Button>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ToastProvider", () => {
  it("announces an error toast as an alert and is axe-clean in both themes", async () => {
    stubMatchMedia(false);
    await inBothThemes(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
      async ({ container }) => {
        fireEvent.click(screen.getByRole("button", { name: "Fail" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Someone else picked first. Try again.");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("puts non-error toasts in the polite live region rather than an alert", () => {
    stubMatchMedia(false);
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Pick submitted.")).toBeInTheDocument();
    expect(screen.getByTestId("toast-region")).toHaveAttribute("aria-live", "polite");
  });

  it("auto-dismisses after the configured delay", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    act(() => void vi.advanceTimersByTime(UI_CONFIG.toast.dismissMs - 1));
    expect(screen.getByText("Pick submitted.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText("Pick submitted.")).toBeNull();
  });

  it("gives reduced-motion users the longer dwell time", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    act(() => void vi.advanceTimersByTime(UI_CONFIG.toast.dismissMs));
    expect(screen.getByText("Pick submitted.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(UI_CONFIG.toast.reducedMotionDismissMs - UI_CONFIG.toast.dismissMs));
    expect(screen.queryByText("Pick submitted.")).toBeNull();
  });

  it("runs a toast action and lets the toast be dismissed by hand", () => {
    stubMatchMedia(false);
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actionable" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("Resumed.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("Draft paused.")).toBeNull();
  });

  it("keeps at most the configured number of toasts on screen", () => {
    stubMatchMedia(false);
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    for (let i = 0; i < UI_CONFIG.toast.maxVisible + 2; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    }
    expect(screen.getAllByText("Pick submitted.")).toHaveLength(UI_CONFIG.toast.maxVisible);
  });

  it("throws a clear error when useToast is called outside the provider", () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow("useToast must be used inside <ToastProvider>.");
  });
});
```

- [ ] **Step 6: Run to verify failure, then implement `Toast`**

Run: `npm test -- src/components/ui/toast`
Expected: FAIL — cannot find module `./toast`.

```tsx
// src/components/ui/toast.tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { UI_CONFIG } from "./config";
import { Button } from "./button";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastInput {
  /** Plain language: what happened, and what to do next. Never raw exception text. */
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
}

interface ToastEntry extends ToastInput {
  readonly id: number;
}

export interface ToastApi {
  readonly show: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Readonly<Record<ToastTone, string>> = {
  info: "border-border",
  success: "border-positive",
  error: "border-negative",
};

function ToastItem({ toast, dismissMs, onDismiss }: { readonly toast: ToastEntry; readonly dismissMs: number; readonly onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), dismissMs);
    return () => clearTimeout(timer);
  }, [toast.id, dismissMs, onDismiss]);

  const tone = toast.tone ?? "info";
  return (
    <li
      role={tone === "error" ? "alert" : undefined}
      className={`pointer-events-auto flex items-start gap-3 rounded-md border bg-surface-elevated p-3 text-sm text-text-primary ${TONE[tone]}`}
    >
      <span className="grow">{toast.message}</span>
      {toast.action ? (
        <Button size="sm" variant="secondary" onClick={toast.action.onClick}>
          {toast.action.label}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => onDismiss(toast.id)}>
        Dismiss
      </Button>
    </li>
  );
}

/**
 * One polite live region for the whole app. Error toasts additionally carry `role="alert"`
 * so a failed draft action interrupts — the user is on a clock and cannot wait for a polite
 * announcement queue.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const nextId = useRef(0);
  const reduced = usePrefersReducedMotion();
  const dismissMs = reduced ? UI_CONFIG.toast.reducedMotionDismissMs : UI_CONFIG.toast.dismissMs;

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    // The id is minted OUTSIDE the updater: a state updater must stay pure, and React may
    // invoke it twice in development StrictMode.
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list, { ...input, id }].slice(-UI_CONFIG.toast.maxVisible));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ul
        data-testid="toast-region"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-md flex-col gap-2 p-4"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} dismissMs={dismissMs} onDismiss={dismiss} />
        ))}
      </ul>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}
```

- [ ] **Step 7: Export from the barrel and run everything**

```ts
// src/components/ui/index.ts — append
export { Modal, type ModalProps } from "./modal";
export { ToastProvider, useToast, type ToastInput, type ToastTone, type ToastAction, type ToastApi } from "./toast";
export { UI_CONFIG } from "./config";
```

Run: `npm test -- src/components/ui src/design`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/design/use-reduced-motion.ts src/design/use-reduced-motion.test.tsx src/components/ui/config.ts src/components/ui/modal.tsx src/components/ui/modal.test.tsx src/components/ui/toast.tsx src/components/ui/toast.test.tsx src/components/ui/index.ts
git commit -m "feat(ui): focus-trapped Modal, live-region ToastProvider, shared reduced-motion hook"
```

---
### Task 3: `Table` primitive and the design-system documentation

**Model tier:** cheap/standard.

**Files:**
- Create: `src/components/ui/table.tsx`
- Modify: `src/components/ui/index.ts`, `docs/design-system.md`
- Test: `src/components/ui/table.test.tsx`

**Interfaces:**
- Consumes: `inBothThemes`, `TOKENS.minViewport` (`@/design/tokens`) for the documented 360px baseline.
- Produces:
  - `TableColumn<T> = { readonly key: string; readonly header: string; readonly cell: (row: T) => ReactNode; readonly numeric?: boolean; readonly hideOnNarrow?: boolean }`
  - `TableProps<T> = { readonly caption: string; readonly captionVisible?: boolean; readonly columns: readonly TableColumn<T>[]; readonly rows: readonly T[]; readonly rowKey: (row: T) => string; readonly rowClassName?: (row: T) => string; readonly empty: ReactNode }`
  - `Table<T>(props: TableProps<T>): JSX.Element`

**Design notes the implementer must preserve:**
- A real `<table>` with a `<caption>` and `<th scope="col">` headers. Screen-reader table navigation is the entire reason to use a table for a draft board instead of a grid of divs.
- `caption` is **required**; `captionVisible` only controls whether it is visually shown (`sr-only` otherwise). A table without an accessible name is an unnamed region in a page full of tables.
- `empty` is **required** — the design system's "never a dead end" rule, enforced by the type rather than by review. With no rows, the table header is not rendered at all; the empty node stands alone.
- 360px: the table scrolls horizontally inside its own `overflow-x-auto` wrapper, so the page body never scrolls sideways. `hideOnNarrow` drops non-essential columns below `sm`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/table.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Table, type TableColumn } from "./table";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { inBothThemes } from "./test-utils";

interface Pick {
  readonly id: string;
  readonly player: string;
  readonly team: string;
  readonly price: number;
}

const rows: readonly Pick[] = [
  { id: "1", player: "Jalen Croft", team: "Bay Bandits", price: 42 },
  { id: "2", player: "Marcus Reed", team: "Iron Owls", price: 17 },
];

const columns: readonly TableColumn<Pick>[] = [
  { key: "player", header: "Player", cell: (r) => r.player },
  { key: "team", header: "Team", cell: (r) => r.team, hideOnNarrow: true },
  { key: "price", header: "Price", cell: (r) => `$${r.price}`, numeric: true },
];

describe("Table", () => {
  it("is a captioned, header-scoped table in both themes with no axe violations", async () => {
    await inBothThemes(
      <Table caption="Auction results" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>No picks yet.</p>} />,
      async ({ container }) => {
        const table = screen.getByRole("table", { name: "Auction results" });
        expect(within(table).getByRole("columnheader", { name: "Player" })).toHaveAttribute("scope", "col");
        expect(within(table).getAllByRole("row")).toHaveLength(rows.length + 1);
        expect(within(table).getByText("$42")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("hides the caption visually but keeps it as the accessible name by default", () => {
    render(<Table caption="Auction results" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(screen.getByText("Auction results")).toHaveClass("sr-only");
  });

  it("shows the caption when asked", () => {
    render(<Table caption="Auction results" captionVisible columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(screen.getByText("Auction results")).not.toHaveClass("sr-only");
  });

  it("renders only the empty node — no header row — when there are no rows", () => {
    render(
      <Table
        caption="Auction results"
        columns={columns}
        rows={[]}
        rowKey={(r: Pick) => r.id}
        empty={<EmptyState title="No picks yet" description="Picks land here as they happen." action={<Button>Refresh</Button>} />}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "No picks yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("applies per-row styling and marks numeric and narrow-hidden columns", () => {
    render(
      <Table
        caption="Auction results"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowClassName={(r) => (r.id === "1" ? "is-mine" : "")}
        empty={<p>None.</p>}
      />,
    );
    expect(screen.getByText("Jalen Croft").closest("tr")).toHaveClass("is-mine");
    expect(screen.getByText("$42")).toHaveClass("text-right");
    expect(screen.getByRole("columnheader", { name: "Team" }).className).toMatch(/hidden/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/ui/table`
Expected: FAIL — cannot find module `./table`.

- [ ] **Step 3: Implement `Table`**

```tsx
// src/components/ui/table.tsx
import type { ReactNode } from "react";

export interface TableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** Right-aligns and tabular-numbers the column. */
  readonly numeric?: boolean;
  /** Dropped below the `sm` breakpoint so the 360px layout stays readable. */
  readonly hideOnNarrow?: boolean;
}

export interface TableProps<T> {
  /** Required: the table's accessible name. */
  readonly caption: string;
  /** Show the caption above the table instead of only exposing it to assistive tech. */
  readonly captionVisible?: boolean;
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly rowClassName?: (row: T) => string;
  /** Required: a table with no rows must still offer the reader a next step. */
  readonly empty: ReactNode;
}

function columnClass<T>(column: TableColumn<T>): string {
  return `${column.numeric ? "text-right tabular-nums " : "text-left "}${column.hideOnNarrow ? "hidden sm:table-cell " : ""}`;
}

/**
 * A semantic table. Real `<table>` markup (caption + scoped column headers) is what lets a
 * screen-reader user navigate a draft board cell by cell; a grid of divs does not.
 */
export function Table<T>({ caption, captionVisible = false, columns, rows, rowKey, rowClassName, empty }: TableProps<T>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm text-text-primary">
        <caption className={captionVisible ? "mb-2 text-left text-sm font-medium text-text-muted" : "sr-only"}>{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`${columnClass(column)}px-3 py-2 font-medium text-text-muted`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={`border-b border-border/50 ${rowClassName?.(row) ?? ""}`}>
              {columns.map((column) => (
                <td key={column.key} className={`${columnClass(column)}px-3 py-2`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Export from the barrel**

```ts
// src/components/ui/index.ts — append
export { Table, type TableProps, type TableColumn } from "./table";
```

- [ ] **Step 5: Document the five new primitives**

Replace the **Primitives** section of `docs/design-system.md` with this, and add the **Motion** paragraph shown below it:

```markdown
## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Select` (label required; native `<select>`; same error/hint contract as `Input`), `Card`, `Badge`, `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; scrolls horizontally inside its own wrapper at 360px), `Avatar` (deterministic initials fallback from the display name; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly).

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`) — never inline in a component.
```

```markdown
## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms, easings `standard` and `emphasized`. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops.

Reduced motion is honored twice over:
1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every animation and transition to 0.01ms. This is the safety net — it applies to code that has never heard of the preference.
2. **Deliberately**, via `usePrefersReducedMotion()` (`src/design/use-reduced-motion.ts`) whenever "less motion" should mean *different behavior*, not merely a faster animation: the pick-landing celebration renders a static highlight instead of an animated one, and toasts dwell twice as long. Any component whose reduced-motion behavior is a real branch must have a test that asserts both branches.
```

- [ ] **Step 6: Run the tests and the checks**

Run: `npm test -- src/components/ui`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/table.tsx src/components/ui/table.test.tsx src/components/ui/index.ts docs/design-system.md
git commit -m "feat(ui): semantic Table primitive; document the five new primitives and motion rules"
```

---
### Task 4: The server-side values the room needs — clock view, slot index, per-team max bid, player metadata, team cards

**Model tier:** standard/capable (touches the 100%-covered engine and the wire contract).

**Why this task exists:** every value in the sections below is a **draft rule**. If the browser computed any of them, Plan C would be re-implementing the engine in React — the one thing the Global Constraints forbid. Each is therefore computed once, server-side, by the engine that already owns the rule, and carried to the client in the view or the event payload.

| The UI needs | It is a rule because | Where it now comes from |
|---|---|---|
| Which roster slot a pick filled, and which copy of it | Slot assignment delegates to `validateRosterAdd` | `CompletedPick.slotIndex` (new) |
| Whose turn it is / deadline / tier / when it tightens, **after each event** | Turn order and the tightening schedule are engine logic | `payload.clock` on every `draft.*` event (new) |
| The most this team may bid | The $1-per-open-slot reserve formula | `DraftStateView.maxBids` + `draft.pick`'s `maxBids` (new) |
| The least a bid may be | `highBid + bidIncrement`, config-driven | `DraftStateView.minBid` (new) |
| Remaining budgets after a lot is awarded | Budget arithmetic | `draft.pick`'s `budgets` (new) |
| The league's roster shape, to draw empty slots | League config | `DraftStateView.slotConfig` (new) |
| Player names / positions / NFL teams | Not a rule — plain metadata | `GET /api/drafts/[draftId]/players` (new route) |
| Team names and owner identity | Not a rule — plain metadata | `teams` on `GET /api/drafts/[draftId]` (new field) |

**Player-metadata decision (and its justification):** player names live behind a **separate `GET /api/drafts/[draftId]/players`**, not inside `draftStateView`.
- The draft view is refetched on **every** sequence gap and **every** reconnect. Player metadata is a few hundred rows × four fields and **never changes during a draft**, so folding it into the view would re-download a static dictionary on every resync and delay the first paint of the state that actually moves.
- Keeping ids-only in the view also keeps the SSE payloads small: `draft.pick` carries a `playerId`, and the client already holds the dictionary.
- It is scoped to the **draft**, not the league (`/api/leagues/[leagueId]/players`), because league-membership authorization for `/api/leagues/**` does not exist yet — `src/app/api/leagues/[leagueId]/events/route.ts` says in a comment that it "lands with the league service in Step 7". Reusing `withDraftActor` means this route's authorization cannot drift from the state route's, and no second authz seam is invented that Step 7 would then own twice.
- The route reuses `buildDraftPool`'s ranking (extracted as `rankedPlayers`) so the pool the UI lists is ordered exactly like the pool `START_DRAFT` snapshots — one ranking, not two.

**Files:**
- Modify: `src/draft-engine/state.ts`, `src/draft-engine/apply-pick.ts`, `src/draft-engine/selectors.ts`, `src/draft-engine/events.ts`, `src/draft-engine/index.ts`
- Modify: `src/domain/league.ts`, `src/lib/api/respond.ts`, `src/draft-service/pool.ts`, `src/app/api/drafts/[draftId]/route.ts`, `docs/draft-engine.md`
- Create: `src/draft-service/teams.ts`, `src/draft-room/contract.ts`, `src/app/api/drafts/[draftId]/players/route.ts`
- Test: `src/draft-engine/selectors-view.test.ts` (new); modify `src/draft-engine/events.test.ts`, `src/draft-engine/apply-pick.test.ts`, `src/draft-service/pool.test.ts`, `src/draft-service/api-routes.test.ts`

**Interfaces:**
- Consumes: `initialDraftState`, `reduceDraft`, `auctionOf`, `maxBidFor`, `minBidFor`, `teamOnClock`, `currentDeadline`, `currentClockSeconds`, `nextTightening`, `availablePool`, `withDraftActor`, `resolveDraftActor`, `ok`/`fail`, `getDb`, `expireAt`.
- Produces:
  - `CompletedPick` gains `readonly slotIndex: number`.
  - `DraftClockView` (see code) and `draftClockView(state: DraftState): DraftClockView`.
  - `maxBidsFor(state: DraftState): Readonly<Record<string, number>>`.
  - `DraftStateView extends DraftClockView` and additionally carries `slotConfig`, `minBid: number | null`, `maxBids`.
  - Every `draft.*` payload: `{ draftId: string; clock: DraftClockView; … }`. `draft.pick` also carries `budgets` and `maxBids` for auction drafts only.
  - `TeamCard` (`@/domain/league`), `listTeamCards(db, leagueId): Promise<readonly TeamCard[]>` (`@/draft-service/teams`).
  - `rankedPlayers(db, leagueId): Promise<readonly Player[]>` (`@/draft-service/pool`).
  - `ApiEnvelope<T>` (`@/lib/api/respond`).
  - `DraftSnapshotBody`, `DraftPlayersBody` (`@/draft-room/contract`).
  - Route: `GET /api/drafts/[draftId]/players`.

- [ ] **Step 1: Write the failing view/clock selector test**

```ts
// src/draft-engine/selectors-view.test.ts
import { describe, it, expect } from "vitest";
import type { DraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { DRAFT_CLOCK_SCHEDULE, AUCTION_CONFIG } from "./config";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { reduceDraft } from "./reduce";
import { draftClockView, draftStateView, maxBidsFor } from "./selectors";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const POOL = [
  { playerId: "qb1", position: "QB" as const },
  { playerId: "rb1", position: "RB" as const },
  { playerId: "qb2", position: "QB" as const },
  { playerId: "rb2", position: "RB" as const },
];

function configFor(format: "snake" | "auction"): DraftConfig {
  return {
    draftId: "d1",
    leagueId: "l1",
    format,
    kickoffAt: "2026-09-30T17:00:00.000Z",
    auctionBudget: format === "auction" ? 100 : null,
    slotConfig: SLOTS,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
}

function apply(state: DraftState, action: DraftAction): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.state;
}

function started(format: "snake" | "auction"): DraftState {
  return apply(initialDraftState(configFor(format)), {
    v: 1,
    type: "START_DRAFT",
    timestamp: "2026-09-01T00:00:00.000Z",
    draftOrder: ["t1", "t2"],
    pool: POOL,
  });
}

describe("draftClockView", () => {
  it("is quiet before the draft starts", () => {
    expect(draftClockView(initialDraftState(configFor("snake")))).toEqual({
      phase: "scheduled",
      sequence: 0,
      pickNumber: 0,
      onClockTeamId: null,
      deadlineAt: null,
      clockSeconds: null,
      nextTightening: null,
    });
  });

  it("reports the running turn once the draft is live", () => {
    const clock = draftClockView(started("snake"));
    expect(clock.phase).toBe("in_progress");
    expect(clock.sequence).toBe(1);
    expect(clock.pickNumber).toBe(1);
    expect(clock.onClockTeamId).toBe("t1");
    // 29 days from kickoff → the 8-hour tier.
    expect(clock.clockSeconds).toBe(8 * 60 * 60);
    expect(clock.deadlineAt).toBe("2026-09-01T08:00:00.000Z");
    expect(clock.nextTightening).toEqual({ at: "2026-09-23T17:00:00.000Z", pickSeconds: 4 * 60 * 60 });
  });
});

describe("maxBidsFor", () => {
  it("is empty for a snake draft — there is no budget to reserve against", () => {
    expect(maxBidsFor(started("snake"))).toEqual({});
  });

  it("holds back the reserve for every other open slot, for every team", () => {
    const state = started("auction");
    const reserve = AUCTION_CONFIG.reservePerOpenSlot;
    expect(maxBidsFor(state)).toEqual({ t1: 100 - reserve, t2: 100 - reserve });
  });
});

describe("draftStateView", () => {
  it("carries the league's roster shape, the pool ids, and no auction numbers for a snake draft", () => {
    const view = draftStateView(started("snake"));
    expect(view.slotConfig).toBe(SLOTS);
    expect(view.availablePlayerIds).toEqual(["qb1", "rb1", "qb2", "rb2"]);
    expect(view.minBid).toBeNull();
    expect(view.maxBids).toEqual({});
    expect(view.format).toBe("snake");
    expect(view.onClockTeamId).toBe("t1");
  });

  it("exposes the current minimum bid and every team's maximum for an auction", () => {
    const state = started("auction");
    expect(draftStateView(state).minBid).toBe(AUCTION_CONFIG.minBid);

    const nominated = apply(state, { v: 1, type: "NOMINATE", timestamp: "2026-09-01T00:01:00.000Z", teamId: "t1", playerId: "qb1", openingBid: 5 });
    const view = draftStateView(nominated);
    expect(view.minBid).toBe(5 + AUCTION_CONFIG.bidIncrement);
    expect(view.maxBids.t2).toBe(100 - AUCTION_CONFIG.reservePerOpenSlot);
    expect(view.auction?.lot?.highBidTeamId).toBe("t1");
  });

  it("records the slot index a pick landed in so no client has to derive it", () => {
    const picked = apply(started("snake"), { v: 1, type: "MAKE_PICK", timestamp: "2026-09-01T00:05:00.000Z", teamId: "t1", playerId: "qb1" });
    expect(draftStateView(picked).picks[0]).toMatchObject({ playerId: "qb1", slot: "QB", slotIndex: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure, then extend the engine**

Run: `npm test -- src/draft-engine/selectors-view`
Expected: FAIL — `draftClockView` / `maxBidsFor` are not exported.

```ts
// src/draft-engine/state.ts — inside `CompletedPick`, directly after `slot`
  /**
   * Which copy of that slot (RB0, RB1, …). Recorded rather than derived so a client folding
   * a `draft.pick` event into its view never has to re-run slot-assignment rules.
   */
  readonly slotIndex: number;
```

```ts
// src/draft-engine/apply-pick.ts — inside the `pick` literal, after `slot: assignment.slot,`
    slotIndex: assignment.slotIndex,
```

```ts
// src/draft-engine/selectors.ts — replace the DraftStateView block with this
/** The clock-and-turn slice every draft event and the full view both carry. */
export interface DraftClockView {
  readonly phase: DraftStatus;
  readonly sequence: number;
  readonly pickNumber: number;
  readonly onClockTeamId: string | null;
  readonly deadlineAt: string | null;
  readonly clockSeconds: number | null;
  readonly nextTightening: Tightening | null;
}

/**
 * Everything about "whose turn, until when, and what changes next", in one object. Both
 * `draftStateView` and every `draft.*` event payload embed exactly this, so a client that has
 * applied an event knows the new deadline and tier without re-deriving either.
 */
export function draftClockView(state: DraftState): DraftClockView {
  return {
    phase: state.phase,
    sequence: state.sequence,
    pickNumber: state.pickNumber,
    onClockTeamId: teamOnClock(state),
    deadlineAt: currentDeadline(state),
    clockSeconds: currentClockSeconds(state),
    nextTightening: nextTightening(state),
  };
}

/**
 * Every team's current ceiling. Computed here, once, because the budget-reserve rule
 * (invariant 4 in `docs/draft-engine.md`) must exist in exactly one place — a client that
 * re-derived it would drift the moment the config changed.
 */
export function maxBidsFor(state: DraftState): Readonly<Record<string, number>> {
  if (auctionOf(state) === null) return {};
  return Object.fromEntries(state.draftOrder.map((teamId) => [teamId, maxBidFor(state, teamId)]));
}

/** The one serialization of a draft: what `GET /api/drafts/:id` returns and Plan C renders. */
export interface DraftStateView extends DraftClockView {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  /** The league's roster shape — what lets the UI draw the empty slots, not just the filled ones. */
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly draftOrder: readonly string[];
  readonly picks: readonly CompletedPick[];
  readonly rosters: Readonly<Record<string, readonly RosterSlot[]>>;
  readonly budgets: Readonly<Record<string, number>>;
  readonly auction: AuctionState | null;
  readonly availablePlayerIds: readonly string[];
  /** Lowest legal next bid; null for a snake draft. */
  readonly minBid: number | null;
  /** teamId → highest legal bid right now. Empty for a snake draft. */
  readonly maxBids: Readonly<Record<string, number>>;
}

export function draftStateView(state: DraftState): DraftStateView {
  return {
    ...draftClockView(state),
    draftId: state.config.draftId,
    leagueId: state.config.leagueId,
    format: state.config.format,
    slotConfig: state.config.slotConfig,
    draftOrder: state.draftOrder,
    picks: state.picks,
    rosters: state.rosters,
    budgets: state.budgets,
    auction: state.auction,
    availablePlayerIds: availablePool(state).map((p) => p.playerId),
    minBid: auctionOf(state) === null ? null : minBidFor(state),
    maxBids: maxBidsFor(state),
  };
}
```

`selectors.ts`'s import block additionally needs `RosterSlotConfig`:

```ts
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
```

- [ ] **Step 3: Update the event payloads and their test**

```ts
// src/draft-engine/events.ts — replace the body of draftEventsFor
import { draftClockView, maxBidsFor } from "./selectors";

export function draftEventsFor(prev: DraftState, next: DraftState, action: DraftAction): readonly DraftEventEnvelope[] {
  // Every payload embeds the post-transition clock view, so a client that applies an event
  // learns the new deadline, tier and turn without re-deriving any of them.
  const base = { draftId: next.config.draftId, clock: draftClockView(next) };
  const events: DraftEventEnvelope[] = [];

  if (action.type === "TIMER_EXPIRE") {
    events.push({ type: "draft.timer_expire", payload: { ...base, pickNumber: prev.pickNumber } });
  }

  const afterAuction = auctionOf(next);
  // A lot being awarded is the only thing that moves money, so budgets and ceilings ride the
  // pick event — the client assigns them rather than doing budget arithmetic of its own.
  const money = afterAuction === null ? {} : { budgets: next.budgets, maxBids: maxBidsFor(next) };

  for (const pick of next.picks.slice(prev.picks.length)) {
    events.push({ type: "draft.pick", payload: { ...base, ...pick, ...money } });
  }

  const beforeAuction = auctionOf(prev);
  const before = beforeAuction === null ? null : beforeAuction.lot;
  const after = afterAuction === null ? null : afterAuction.lot;
  if (after !== null) {
    events.push(
      before === null || before.playerId !== after.playerId
        ? {
            type: "draft.nominate",
            payload: { ...base, teamId: after.nominatedByTeamId, playerId: after.playerId, openingBid: after.highBid, auto: after.autoNominated },
          }
        : {
            type: "draft.bid",
            payload: { ...base, teamId: after.highBidTeamId, playerId: after.playerId, amount: after.highBid },
          },
    );
  }

  if (next.phase !== prev.phase) {
    events.push({ type: "draft.status", payload: { ...base, phase: next.phase } });
  }

  return events;
}
```

`src/draft-engine/events.test.ts` currently asserts flat payloads with a top-level `sequence`. Update its three expectations to the new shape — for example the `START_DRAFT` case becomes:

```ts
expect(events).toEqual([
  {
    type: "draft.status",
    payload: {
      draftId: "d1",
      phase: "in_progress",
      clock: {
        phase: "in_progress",
        sequence: 1,
        pickNumber: 1,
        onClockTeamId: "t1",
        deadlineAt: expect.any(String),
        clockSeconds: expect.any(Number),
        nextTightening: expect.anything(),
      },
    },
  },
]);
```

…and append these two self-contained cases (merge their imports into the file's existing import block):

```ts
// src/draft-engine/events.test.ts — append
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { reduceDraft } from "./reduce";
import { expireAt } from "./test-support";

const ONE_QB: readonly RosterSlotConfig[] = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }];
const POOL = [
  { playerId: "qb1", position: "QB" as const },
  { playerId: "qb2", position: "QB" as const },
];

function step(state: DraftState, action: DraftAction): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.state;
}

function configFor(format: "snake" | "auction"): DraftConfig {
  return {
    draftId: "d1",
    leagueId: "l1",
    format,
    kickoffAt: "2026-09-30T17:00:00.000Z",
    auctionBudget: format === "auction" ? 50 : null,
    slotConfig: ONE_QB,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
}

function startedDraft(format: "snake" | "auction"): DraftState {
  return step(initialDraftState(configFor(format)), {
    v: DRAFT_ACTION_VERSION,
    type: "START_DRAFT",
    timestamp: "2026-09-01T00:00:00.000Z",
    draftOrder: ["t1", "t2"],
    pool: POOL,
  });
}

describe("draftEventsFor — auction money on the pick event", () => {
  it("carries the post-award budgets and every team's reserve-adjusted ceiling", () => {
    const nominated = step(startedDraft("auction"), {
      v: DRAFT_ACTION_VERSION,
      type: "NOMINATE",
      timestamp: "2026-09-01T00:00:10.000Z",
      teamId: "t1",
      playerId: "qb1",
      openingBid: 12,
    });
    const expiry = expireAt(nominated);
    const awarded = step(nominated, expiry);

    const pickEvent = draftEventsFor(nominated, awarded, expiry).find((event) => event.type === "draft.pick")!;
    expect(pickEvent.payload).toMatchObject({
      draftId: "d1",
      teamId: "t1",
      playerId: "qb1",
      slot: "QB",
      slotIndex: 0,
      price: 12,
      // t1 spent $12 of $50; its only roster spot is now full, so its ceiling is $0.
      budgets: { t1: 38, t2: 50 },
      maxBids: { t1: 0, t2: 50 },
    });
    expect((pickEvent.payload as { readonly clock: { readonly sequence: number } }).clock.sequence).toBe(awarded.sequence);
  });

  it("omits budgets and ceilings entirely for a snake pick", () => {
    const started = startedDraft("snake");
    const pick: DraftAction = { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: "2026-09-01T00:05:00.000Z", teamId: "t1", playerId: "qb1" };
    const after = step(started, pick);

    const pickEvent = draftEventsFor(started, after, pick).find((event) => event.type === "draft.pick")!;
    expect(pickEvent.payload).toMatchObject({ slot: "QB", slotIndex: 0, price: null });
    expect(pickEvent.payload).not.toHaveProperty("budgets");
    expect(pickEvent.payload).not.toHaveProperty("maxBids");
  });
});
```

Also update `src/draft-engine/apply-pick.test.ts` so at least one assertion pins `slotIndex` (e.g. the second RB of a two-RB roster asserts `{ slot: "RB", slotIndex: 1 }`).

- [ ] **Step 4: Extend the engine barrel**

```ts
// src/draft-engine/index.ts — extend the selectors export line
export {
  draftedPlayerIds, availablePool, openSlotCount, isComplete, teamOnClock, bestAvailableFor,
  remainingBudget, minBidFor, maxBidFor, maxBidsFor, currentTier, currentClockSeconds, currentDeadline, nextTightening,
  draftClockView, draftStateView, type DraftClockView, type DraftStateView,
} from "./selectors";
```

- [ ] **Step 5: Run the engine tests and its coverage gate**

Run: `npm test -- src/draft-engine`
Expected: PASS.

Run: `npm run test:coverage`
Expected: PASS with `src/draft-engine/**` at 100% branches/functions/lines/statements. If `maxBidsFor`'s non-auction branch or `draftStateView`'s `minBid` null branch is uncovered, the `started("snake")` cases above cover them — check the test ran, do not lower the gate.

- [ ] **Step 6: Commit the engine half**

```bash
git add src/draft-engine
git commit -m "feat(draft-engine): clock view on every event payload, slotIndex on picks, per-team maxBids in the view

The draft room must never restate a draft rule. Turn/deadline/tier, the slot a pick
filled, the bid floor and each team's reserve-adjusted ceiling are all computed here and
carried to the client, so no React component re-derives them."
```

- [ ] **Step 7: Write the failing service + route tests**

```ts
// src/draft-service/pool.test.ts — add (self-contained: no league row is needed, because a
// league with no scoringSettings row falls back to PPR_SCORING, which this suite already relies on)
it("ranks whole player rows, best first, and buildDraftPool is exactly its projection", async () => {
  await db.insert(players).values([
    { id: "p_low", name: "Low Output", position: "RB", nflTeam: "SF" },
    { id: "p_high", name: "High Output", position: "RB", nflTeam: "KC" },
  ]);
  await db.insert(playerStatLines).values([
    { playerId: "p_low", week: 1, rushingYards: 10 },
    { playerId: "p_high", week: 1, rushingYards: 200, rushingTouchdowns: 2 },
  ]);

  const ranked = await rankedPlayers(db, "league_without_settings");
  expect(ranked.map((player) => player.id)).toEqual(["p_high", "p_low"]);
  expect(ranked[0]).toMatchObject({ name: "High Output", position: "RB", nflTeam: "KC" });

  const pool = await buildDraftPool(db, "league_without_settings");
  expect(pool.map((entry) => entry.playerId)).toEqual(ranked.map((player) => player.id));
});
```

```ts
// src/draft-service/api-routes.test.ts — add these imports and cases
import { GET as getPlayers } from "@/app/api/drafts/[draftId]/players/route";

describe("GET /api/drafts/[draftId]/players", () => {
  it("returns ranked player metadata to a league member", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const response = await getPlayers(new Request(`http://test/api/drafts/${DRAFT_ID}/players`), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.players).toHaveLength(6);
    expect(body.data.players[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), position: expect.any(String), nflTeam: expect.any(String) });
  });

  it("refuses a signed-in stranger with no team in this league", async () => {
    await fixture();
    await db.insert(users).values({ id: "stranger", email: "stranger@test.local", displayName: "Stranger" });
    signedInAs("stranger");
    const response = await getPlayers(new Request(`http://test/api/drafts/${DRAFT_ID}/players`), { params });
    expect(response.status).toBe(403);
  });

  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    await fixture();
    signedInAs(null);
    const response = await getPlayers(new Request(`http://test/api/drafts/${DRAFT_ID}/players`), { params });
    expect(response.status).toBe(401);
    expect((await response.json()).ok).toBe(false);
  });
});

it("includes every team card in the draft state body", async () => {
  const f = await fixture();
  signedInAs(f.userIds[0]!);
  const body = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
  expect(body.data.teams).toHaveLength(f.teamIds.length);
  expect(body.data.teams[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), ownerDisplayName: expect.any(String) });
  expect(body.data.draft.slotConfig).toEqual(SPRINT_ROSTER_SLOTS);
});
```

Run: `npm test -- src/draft-service`
Expected: FAIL — `rankedPlayers` and the players route do not exist; `teams` is missing from the state body.

- [ ] **Step 8: Implement the service and route additions**

```ts
// src/domain/league.ts — append
/**
 * A team as a room renders it: the team plus its owner's public profile. Pure DTO — no
 * secrets, no email, nothing a leaguemate should not see.
 */
export interface TeamCard {
  readonly id: string;
  readonly name: string;
  readonly ownerDisplayName: string;
  readonly ownerAvatarUrl: string | null;
}
```

```ts
// src/draft-service/teams.ts
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { TeamCard } from "@/domain/league";
import { teams, users } from "@/db/schema";

/**
 * Every team in a league, with the owner's public profile, ordered by id so two clients
 * always render the same list in the same order. Display order in the room comes from
 * `draftStateView.draftOrder`, not from this.
 */
export async function listTeamCards(db: Db, leagueId: string): Promise<readonly TeamCard[]> {
  return db
    .select({ id: teams.id, name: teams.name, ownerDisplayName: users.displayName, ownerAvatarUrl: users.avatarUrl })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(eq(teams.leagueId, leagueId))
    .orderBy(asc(teams.id));
}
```

```ts
// src/draft-service/pool.ts — replace the whole file body below the imports.
// The ranking logic is byte-for-byte the existing `buildDraftPool` body; it simply now stops
// one step earlier, at whole player rows, and `buildDraftPool` projects them.
import type { Player } from "@/domain/player";

/**
 * The league's players, best projected season first, ties broken by player id so the order is
 * total. Projection uses the league's own scoring settings via the same scoring engine that
 * scores real weeks, so a PPR league's board looks like a PPR board.
 */
export async function rankedPlayers(db: Db, leagueId: string): Promise<readonly Player[]> {
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules = settings === undefined ? PPR_SCORING : settings;

  const roster = await db.select().from(players);
  const lines = await db.select().from(playerStatLines);
  const positionById = new Map(roster.map((player) => [player.id, player.position]));

  const projected = new Map<string, number>();
  for (const line of lines) {
    const position = positionById.get(line.playerId);
    if (position === undefined) continue;
    projected.set(line.playerId, (projected.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, rules));
  }

  return [...roster].sort((a, b) => {
    const diff = (projected.get(b.id) ?? 0) - (projected.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/**
 * The draftable pool as the engine wants it: id + position, in `rankedPlayers` order. This is
 * the ranking snapshotted into the START_DRAFT action; nothing re-ranks mid-draft.
 */
export async function buildDraftPool(db: Db, leagueId: string): Promise<readonly DraftPoolEntry[]> {
  return (await rankedPlayers(db, leagueId)).map((player) => ({ playerId: player.id, position: player.position }));
}
```

```ts
// src/lib/api/respond.ts — append
/** The shape a browser parses back out of `ok()` / `fail()`. One envelope, both directions. */
export type ApiEnvelope<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };
```

```ts
// src/draft-room/contract.ts
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";

/**
 * The two response bodies the draft room reads. Declared once, imported by the route
 * handlers as their return shape and by the client hook as its parse target, so the two
 * sides of the wire cannot drift. Types only — this module emits no runtime code.
 */
export interface DraftSnapshotBody {
  readonly draft: DraftStateView;
  /** The caller's own team, or null for a commissioner without one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
  readonly teams: readonly TeamCard[];
}

export interface DraftPlayersBody {
  readonly players: readonly Player[];
}
```

```ts
// src/app/api/drafts/[draftId]/players/route.ts
import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { rankedPlayers } from "@/draft-service/pool";
import type { DraftPlayersBody } from "@/draft-room/contract";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Player metadata for the room's pool, in the same ranked order `START_DRAFT` snapshots.
 * Deliberately a second request instead of a field on `GET /api/drafts/[draftId]`: the draft
 * view is refetched on every gap and every reconnect, while this dictionary never changes
 * during a draft. It rides the same `withDraftActor` seam, so its authorization can never
 * drift from the state route's.
 */
export async function GET(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor) => {
    if (actor.teamId === null && !actor.isCommissioner) {
      return fail("You don't have a team in this league.", 403);
    }
    const body: DraftPlayersBody = { players: await rankedPlayers(getDb(), actor.leagueId) };
    return ok(body);
  });
}
```

```ts
// src/app/api/drafts/[draftId]/route.ts — replace the success return
    const body: DraftSnapshotBody = {
      draft: draftStateView(state),
      teamId: actor.teamId,
      isCommissioner: actor.isCommissioner,
      teams: await listTeamCards(getDb(), actor.leagueId),
    };
    return ok(body);
```

(with `import { getDb } from "@/db/client";`, `import { listTeamCards } from "@/draft-service/teams";` and `import type { DraftSnapshotBody } from "@/draft-room/contract";` added at the top.)

- [ ] **Step 9: Update `docs/draft-engine.md`**

Replace the "Event payloads" table's preamble and rows so they describe the new shape:

```markdown
`draftEventsFor(prev, next, action)` derives events from the **state diff**, not the action
alone. Every payload carries `draftId` and a `clock` block — exactly the `DraftClockView`
(`phase`, `sequence`, `pickNumber`, `onClockTeamId`, `deadlineAt`, `clockSeconds`,
`nextTightening`) that `draftStateView` also embeds. That is what lets a browser fold an
event into its view and know the new deadline and tier without re-deriving either; the
sequence number a client uses for gap detection is `payload.clock.sequence`.

| Event | Extra payload | Emitted when |
|---|---|---|
| `draft.status` | `phase` | `next.phase !== prev.phase`. |
| `draft.pick` | every `CompletedPick` field (`pickNumber`, `round`, `teamId`, `playerId`, `slot`, `slotIndex`, `price`, `timestamp`, `auto`); **auction only:** `budgets` and `maxBids` after the award | Once per new entry in `next.picks`. |
| `draft.nominate` | `teamId`, `playerId`, `openingBid`, `auto` | A new lot opens. |
| `draft.bid` | `teamId`, `playerId`, `amount` | The open lot's high bid changes without a new player. |
| `draft.timer_expire` | `pickNumber` (the pick the clock ran out on) | Every accepted `TIMER_EXPIRE`, always pushed first. |
```

Add one line to the API table:

```markdown
| `GET /api/drafts/[draftId]/players` | a league member | Ranked player metadata (id/name/position/nflTeam) for the pool. Separate from the state route because it never changes mid-draft and the state route is refetched on every resync. |
```

- [ ] **Step 10: Run everything and commit**

Run: `npm test -- src/draft-service && npm run typecheck && npm run lint`
Expected: PASS, no errors.

```bash
git add src/domain/league.ts src/lib/api/respond.ts src/draft-service src/draft-room/contract.ts "src/app/api/drafts/[draftId]" docs/draft-engine.md
git commit -m "feat(api): ranked player metadata route, team cards on the draft state body

Player metadata is a separate request because the draft state is refetched on every SSE
gap and reconnect, and the player dictionary never changes during a draft."
```

---
### Task 5: The pure client state layer (100% gated) and the `useDraftRoom` hook

**Model tier:** standard/capable.

**Files:**
- Create: `src/draft-room/state/config.ts`, `src/draft-room/state/format.ts`, `src/draft-room/state/payloads.ts`, `src/draft-room/state/apply-event.ts`, `src/draft-room/state/optimistic.ts`, `src/draft-room/hooks/deps.tsx`, `src/draft-room/hooks/use-now.ts`, `src/draft-room/hooks/use-draft-room.ts`
- Modify: `vitest.config.mts`
- Test: `src/draft-room/state/format.test.ts`, `src/draft-room/state/apply-event.test.ts`, `src/draft-room/state/optimistic.test.ts`, `src/draft-room/hooks/use-now.test.tsx`, `src/draft-room/hooks/use-draft-room.test.tsx`

**Interfaces:**
- Consumes: `DraftStateView`, `DraftClockView`, `AuctionState`, `CompletedPick`, `ClientDraftAction`, `Tightening` (all `import type` from `@/draft-engine`), `ApiEnvelope`, `DraftSnapshotBody`, `DraftPlayersBody`, `Player`, `TeamCard`.
- Produces:
  - `DRAFT_ROOM_CONFIG = { countdownTickMs, poolPageSize, celebrationMs }`.
  - `formatCountdown(msRemaining: number): string`, `formatClockLength(seconds: number): string`, `formatGap(ms: number): string`, `formatTightening(next: Tightening | null, nowMs: number): string | null`.
  - `draftEventSchema`, `type DraftEventFrame`.
  - `applyDraftEvent(view: DraftStateView, data: string): ApplyEventResult` where `ApplyEventResult = { ok: true; view: DraftStateView } | { ok: false; outcome: "ignored" | "resync" }`.
  - `optimisticView(view, action, myTeamId): { view: DraftStateView; pendingPlayerId: string | null }`.
  - `EventSourceLike`, `DraftRoomDeps`, `DraftRoomDepsProvider`, `useDraftRoomDeps()`.
  - `useNow(intervalMs: number): number`.
  - `useDraftRoom(draftId: string): DraftRoom` (fields listed in Step 7) with `submit(action): Promise<SubmitOutcome>` and `refresh(): Promise<void>`; `SubmitOutcome = { ok: true } | { ok: false; reason: string }`.

**The synchronization contract this task implements (and `docs/draft-room.md` documents in Task 10):**
1. Mount → `GET /api/drafts/[draftId]` **and** `GET /api/drafts/[draftId]/players` in parallel.
2. Open a native `EventSource` on `/api/leagues/<leagueId>/events`. **The browser owns reconnect and `Last-Event-ID`.** We never write a retry loop.
3. For each `draft.*` frame, compare `payload.clock.sequence` to our `view.sequence`:
   - `< view.sequence` → **ignore** (already applied).
   - `=== view.sequence` → **apply** (a sibling event of the transition we just applied — `draft.timer_expire`, its `draft.pick`, and a trailing `draft.status` all carry the same sequence). Every apply is idempotent by content.
   - `=== view.sequence + 1` → **apply** (a new transition).
   - `> view.sequence + 1` → **resync**: refetch the whole view. This is the documented fallback for a gap that outlasted stream retention.
4. A `draft.bid` when we hold no open lot, or a `draft.nominate` on a non-auction view, is also a **resync** — that is exactly the "missed a bid war" case Step 5 of the spec calls out.
5. An `EventSource` `open` that follows an `error` (i.e. a reconnect) → **resync**, unconditionally.

- [ ] **Step 1: Add the new coverage gate**

```ts
// vitest.config.mts — extend the gated dirs and the thresholds
const COVERAGE_GATED_DIRS = ["src/scoring", "src/draft-engine", "src/draft-room/state"] as const;
```

```ts
      thresholds: {
        "src/scoring/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/draft-engine/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/draft-room/state/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
```

Only `src/draft-room/state/**` is gated — it is pure and deterministic. Hooks and components live in sibling directories and are covered by behavioral tests, not by a percentage.

- [ ] **Step 2: Write the failing formatter tests**

```ts
// src/draft-room/state/format.test.ts
import { describe, it, expect } from "vitest";
import { formatCountdown, formatClockLength, formatGap, formatTightening } from "./format";

describe("formatCountdown", () => {
  it.each([
    [0, "0:00"],
    [-5_000, "0:00"],
    [9_400, "0:10"],
    [125_000, "2:05"],
    [3_849_000, "1:04:09"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe("formatClockLength", () => {
  it.each([
    [8 * 60 * 60, "8 hours"],
    [60 * 60, "1 hour"],
    [10 * 60, "10 minutes"],
    [60, "1 minute"],
    [45, "45 seconds"],
    [1, "1 second"],
    [90, "90 seconds"],
  ])("renders %i seconds as %s", (seconds, expected) => {
    expect(formatClockLength(seconds)).toBe(expected);
  });
});

describe("formatGap", () => {
  it.each([
    [0, "under a minute"],
    [-10, "under a minute"],
    [59_000, "under a minute"],
    [14 * 60_000, "14m"],
    [134 * 60_000, "2h 14m"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatGap(ms)).toBe(expected);
  });
});

describe("formatTightening", () => {
  it("is null when nothing is scheduled to change", () => {
    expect(formatTightening(null, 0)).toBeNull();
  });

  it("says what it shortens to and when", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(formatTightening({ at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 }, now)).toBe("Picks shorten to 10 minutes in 2h 14m");
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement config + formatters**

Run: `npm test -- src/draft-room/state/format`
Expected: FAIL — cannot find module `./format`.

```ts
// src/draft-room/state/config.ts
/** Every tunable in the draft room. No component or hook may inline one of these. */
export const DRAFT_ROOM_CONFIG = {
  /** How often a countdown re-renders, ms. One second is the smallest unit we display. */
  countdownTickMs: 1_000,
  /** Rows the player pool lists before asking the user to narrow their search. */
  poolPageSize: 60,
  /** How long the pick-landing highlight stays up, ms. */
  celebrationMs: 2_400,
} as const;
```

```ts
// src/draft-room/state/format.ts
import type { Tightening } from "@/draft-engine";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "0:09", "2:05", "1:04:09". Clamped at zero — a passed deadline reads 0:00, never negative. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / MS_PER_SECOND));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The plain-language length of a pick clock: "8 hours", "10 minutes", "45 seconds". */
export function formatClockLength(seconds: number): string {
  if (seconds >= SECONDS_PER_HOUR && seconds % SECONDS_PER_HOUR === 0) return plural(seconds / SECONDS_PER_HOUR, "hour");
  if (seconds >= SECONDS_PER_MINUTE && seconds % SECONDS_PER_MINUTE === 0) return plural(seconds / SECONDS_PER_MINUTE, "minute");
  return plural(seconds, "second");
}

/** A coarse distance: "2h 14m", "14m", "under a minute". */
export function formatGap(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * "Picks shorten to 10 minutes in 2h 14m" — the auto-tightening clock made visible, which is
 * the only thing that turns it from an engine feature into a product feature. `nowMs` is
 * supplied by the caller (from `useNow`), never read here.
 */
export function formatTightening(next: Tightening | null, nowMs: number): string | null {
  if (next === null) return null;
  return `Picks shorten to ${formatClockLength(next.pickSeconds)} in ${formatGap(Date.parse(next.at) - nowMs)}`;
}
```

- [ ] **Step 4: Write the failing `applyDraftEvent` test**

```ts
// src/draft-room/state/apply-event.test.ts
import { describe, it, expect } from "vitest";
import type { DraftClockView, DraftStateView } from "@/draft-engine";
import { applyDraftEvent } from "./apply-event";

const clock = (over: Partial<DraftClockView> = {}): DraftClockView => ({
  phase: "in_progress",
  sequence: 2,
  pickNumber: 2,
  onClockTeamId: "t2",
  deadlineAt: "2026-09-01T08:00:00.000Z",
  clockSeconds: 28_800,
  nextTightening: null,
  ...over,
});

const snakeView: DraftStateView = {
  ...clock({ sequence: 1, pickNumber: 1, onClockTeamId: "t1" }),
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [], t2: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1"],
  minBid: null,
  maxBids: {},
};

const auctionView: DraftStateView = {
  ...snakeView,
  format: "auction",
  budgets: { t1: 100, t2: 100 },
  minBid: 1,
  maxBids: { t1: 99, t2: 99 },
  auction: { nominatingTeamId: "t1", lot: null },
};

const frame = (type: string, payload: unknown) => JSON.stringify({ id: "1-0", type, leagueId: "l1", timestamp: "2026-09-01T00:00:00.000Z", payload });

const pickPayload = {
  draftId: "d1",
  clock: clock(),
  pickNumber: 1,
  round: 1,
  teamId: "t1",
  playerId: "qb1",
  slot: "QB",
  slotIndex: 0,
  price: null,
  timestamp: "2026-09-01T00:05:00.000Z",
  auto: false,
};

describe("applyDraftEvent — framing and sequencing", () => {
  it("ignores anything that is not valid JSON", () => {
    expect(applyDraftEvent(snakeView, "not json")).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores an event type this reducer does not own", () => {
    expect(applyDraftEvent(snakeView, frame("chat.message", { text: "hi" }))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores a malformed draft payload rather than trusting it", () => {
    expect(applyDraftEvent(snakeView, frame("draft.pick", { draftId: "d1" }))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores an event for a different draft on the same league stream", () => {
    expect(applyDraftEvent(snakeView, frame("draft.pick", { ...pickPayload, draftId: "other" }))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores an event we are already past", () => {
    const stale = { ...pickPayload, clock: clock({ sequence: 0 }) };
    expect(applyDraftEvent(snakeView, frame("draft.pick", stale))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("asks for a resync when the sequence skips ahead", () => {
    const ahead = { ...pickPayload, clock: clock({ sequence: 5 }) };
    expect(applyDraftEvent(snakeView, frame("draft.pick", ahead))).toEqual({ ok: false, outcome: "resync" });
  });
});

describe("applyDraftEvent — draft.pick", () => {
  it("records the pick, fills the roster slot, drops the player from the pool and adopts the new clock", () => {
    const result = applyDraftEvent(snakeView, frame("draft.pick", pickPayload));
    expect(result.ok).toBe(true);
    const view = (result as { view: DraftStateView }).view;
    expect(view.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false },
    ]);
    expect(view.rosters.t1).toEqual([{ slot: "QB", slotIndex: 0, playerId: "qb1" }]);
    expect(view.availablePlayerIds).toEqual(["rb1"]);
    expect(view.onClockTeamId).toBe("t2");
    expect(view.sequence).toBe(2);
  });

  it("is idempotent — a redelivered sibling event does not duplicate the pick", () => {
    const once = applyDraftEvent(snakeView, frame("draft.pick", pickPayload));
    const view = (once as { view: DraftStateView }).view;
    const twice = applyDraftEvent(view, frame("draft.pick", pickPayload));
    expect((twice as { view: DraftStateView }).view.picks).toHaveLength(1);
  });

  it("starts a roster for a team it has not seen before", () => {
    const bare: DraftStateView = { ...snakeView, rosters: {} };
    const view = (applyDraftEvent(bare, frame("draft.pick", pickPayload)) as { view: DraftStateView }).view;
    expect(view.rosters.t1).toHaveLength(1);
  });

  it("takes the awarded budgets and ceilings from the payload instead of doing arithmetic", () => {
    const withLot: DraftStateView = { ...auctionView, auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 30, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false } } };
    const award = { ...pickPayload, price: 30, budgets: { t1: 70, t2: 100 }, maxBids: { t1: 70, t2: 99 }, clock: clock({ onClockTeamId: "t2" }) };
    const view = (applyDraftEvent(withLot, frame("draft.pick", award)) as { view: DraftStateView }).view;
    expect(view.budgets).toEqual({ t1: 70, t2: 100 });
    expect(view.maxBids).toEqual({ t1: 70, t2: 99 });
    expect(view.auction).toEqual({ nominatingTeamId: "t2", lot: null });
  });
});

describe("applyDraftEvent — auction lots", () => {
  const nominate = { draftId: "d1", clock: clock({ onClockTeamId: null }), teamId: "t1", playerId: "qb1", openingBid: 5, auto: false };

  it("opens a lot on a nomination", () => {
    const view = (applyDraftEvent(auctionView, frame("draft.nominate", nominate)) as { view: DraftStateView }).view;
    expect(view.auction).toEqual({
      nominatingTeamId: "t1",
      lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
  });

  it("asks for a resync if a nomination arrives for a snake draft", () => {
    expect(applyDraftEvent(snakeView, frame("draft.nominate", nominate))).toEqual({ ok: false, outcome: "resync" });
  });

  it("raises the high bid and bidder on a bid", () => {
    const opened = (applyDraftEvent(auctionView, frame("draft.nominate", nominate)) as { view: DraftStateView }).view;
    const bid = { draftId: "d1", clock: clock({ sequence: opened.sequence + 1, onClockTeamId: null }), teamId: "t2", playerId: "qb1", amount: 6 };
    const view = (applyDraftEvent(opened, frame("draft.bid", bid)) as { view: DraftStateView }).view;
    expect(view.auction?.lot).toMatchObject({ highBid: 6, highBidTeamId: "t2" });
  });

  it("asks for a resync when a bid arrives and we hold no open lot — the missed-bid-war case", () => {
    const bid = { draftId: "d1", clock: clock(), teamId: "t2", playerId: "qb1", amount: 6 };
    expect(applyDraftEvent(auctionView, frame("draft.bid", bid))).toEqual({ ok: false, outcome: "resync" });
    expect(applyDraftEvent(snakeView, frame("draft.bid", bid))).toEqual({ ok: false, outcome: "resync" });
  });
});

describe("applyDraftEvent — clock-only events", () => {
  it("adopts the clock on a timer expiry", () => {
    const payload = { draftId: "d1", clock: clock({ onClockTeamId: "t2" }), pickNumber: 1 };
    const view = (applyDraftEvent(snakeView, frame("draft.timer_expire", payload)) as { view: DraftStateView }).view;
    expect(view.onClockTeamId).toBe("t2");
    expect(view.picks).toEqual([]);
  });

  it("adopts the phase on a status change", () => {
    const payload = { draftId: "d1", clock: clock({ phase: "complete", onClockTeamId: null, deadlineAt: null, clockSeconds: null }), phase: "complete" };
    const view = (applyDraftEvent(snakeView, frame("draft.status", payload)) as { view: DraftStateView }).view;
    expect(view.phase).toBe("complete");
    expect(view.deadlineAt).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify failure, then implement the payload schemas and the reducer**

Run: `npm test -- src/draft-room/state/apply-event`
Expected: FAIL — cannot find module `./apply-event`.

```ts
// src/draft-room/state/payloads.ts
import { z } from "zod";

/**
 * The SSE boundary. Everything arriving on the stream is untrusted text until it has been
 * through these schemas — the same "validate at every boundary" rule the API routes follow,
 * applied in the other direction.
 */
const clockSchema = z.object({
  phase: z.enum(["scheduled", "in_progress", "complete"]),
  sequence: z.number().int().nonnegative(),
  pickNumber: z.number().int().nonnegative(),
  onClockTeamId: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  clockSeconds: z.number().nullable(),
  nextTightening: z.object({ at: z.string(), pickSeconds: z.number() }).nullable(),
});

const common = { draftId: z.string().min(1), clock: clockSchema };
const dollarsByTeam = z.record(z.string(), z.number());

const pickPayloadSchema = z.object({
  ...common,
  pickNumber: z.number().int().positive(),
  round: z.number().int().positive(),
  teamId: z.string().min(1),
  playerId: z.string().min(1),
  slot: z.enum(["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BENCH"]),
  slotIndex: z.number().int().nonnegative(),
  price: z.number().nullable(),
  timestamp: z.string().min(1),
  auto: z.boolean(),
  /** Auction awards only — the post-award money, computed by the engine. */
  budgets: dollarsByTeam.optional(),
  maxBids: dollarsByTeam.optional(),
});

const nominatePayloadSchema = z.object({ ...common, teamId: z.string().min(1), playerId: z.string().min(1), openingBid: z.number(), auto: z.boolean() });
const bidPayloadSchema = z.object({ ...common, teamId: z.string().min(1), playerId: z.string().min(1), amount: z.number() });
const statusPayloadSchema = z.object({ ...common, phase: z.enum(["scheduled", "in_progress", "complete"]) });
const expirePayloadSchema = z.object({ ...common, pickNumber: z.number().int().nonnegative() });

/**
 * A `draft.*` frame off the league stream. Non-draft event types (`chat.*`, `score.update`)
 * simply fail this union and are ignored — the draft room is not their consumer.
 */
export const draftEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft.pick"), payload: pickPayloadSchema }),
  z.object({ type: z.literal("draft.nominate"), payload: nominatePayloadSchema }),
  z.object({ type: z.literal("draft.bid"), payload: bidPayloadSchema }),
  z.object({ type: z.literal("draft.status"), payload: statusPayloadSchema }),
  z.object({ type: z.literal("draft.timer_expire"), payload: expirePayloadSchema }),
]);

export type DraftEventFrame = z.infer<typeof draftEventSchema>;
export type DraftPickPayload = z.infer<typeof pickPayloadSchema>;
export type DraftNominatePayload = z.infer<typeof nominatePayloadSchema>;
export type DraftBidPayload = z.infer<typeof bidPayloadSchema>;
```

```ts
// src/draft-room/state/apply-event.ts
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { draftEventSchema, type DraftEventFrame, type DraftPickPayload } from "./payloads";

export type ApplyOutcome = "ignored" | "resync";

export type ApplyEventResult =
  | { readonly ok: true; readonly view: DraftStateView }
  | { readonly ok: false; readonly outcome: ApplyOutcome };

const IGNORED: ApplyEventResult = { ok: false, outcome: "ignored" };
const RESYNC: ApplyEventResult = { ok: false, outcome: "resync" };

function parseFrame(data: string): DraftEventFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = draftEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function applyPick(view: DraftStateView, payload: DraftPickPayload): DraftStateView {
  // A sibling/redelivered frame for a pick we already hold is a no-op — the clock in `view`
  // has already been updated by the caller, so returning it keeps that and adds nothing.
  if (view.picks.some((pick) => pick.pickNumber === payload.pickNumber)) return view;

  const pick: CompletedPick = {
    pickNumber: payload.pickNumber,
    round: payload.round,
    teamId: payload.teamId,
    playerId: payload.playerId,
    slot: payload.slot,
    slotIndex: payload.slotIndex,
    price: payload.price,
    timestamp: payload.timestamp,
    auto: payload.auto,
  };

  return {
    ...view,
    picks: [...view.picks, pick],
    rosters: {
      ...view.rosters,
      [payload.teamId]: [...(view.rosters[payload.teamId] ?? []), { slot: payload.slot, slotIndex: payload.slotIndex, playerId: payload.playerId }],
    },
    availablePlayerIds: view.availablePlayerIds.filter((id) => id !== payload.playerId),
    // Money is assigned, never computed: the engine sent the post-award numbers.
    budgets: payload.budgets ?? view.budgets,
    maxBids: payload.maxBids ?? view.maxBids,
    // A resolved lot closes, and `onClockTeamId` is the engine's own next nominator.
    auction: view.auction === null ? null : { nominatingTeamId: payload.clock.onClockTeamId, lot: null },
  };
}

/** Returns the next view, or null when the frame proves we are out of sync and must refetch. */
function applyFrame(view: DraftStateView, frame: DraftEventFrame): DraftStateView | null {
  switch (frame.type) {
    case "draft.timer_expire":
    case "draft.status":
      return view;
    case "draft.pick":
      return applyPick(view, frame.payload);
    case "draft.nominate":
      return view.format !== "auction"
        ? null
        : {
            ...view,
            auction: {
              nominatingTeamId: frame.payload.teamId,
              lot: {
                playerId: frame.payload.playerId,
                highBid: frame.payload.openingBid,
                highBidTeamId: frame.payload.teamId,
                nominatedByTeamId: frame.payload.teamId,
                autoNominated: frame.payload.auto,
              },
            },
          };
    case "draft.bid": {
      const auction = view.auction;
      if (auction === null || auction.lot === null) return null;
      return { ...view, auction: { ...auction, lot: { ...auction.lot, highBid: frame.payload.amount, highBidTeamId: frame.payload.teamId } } };
    }
  }
}

/**
 * Fold one SSE frame into the draft view. Pure, total, and idempotent by content: the only
 * thing it ever *computes* is set membership and list append — every draft rule (turn,
 * deadline, tier, slot, budget, ceiling) arrives already decided in `payload.clock` or the
 * payload's own fields.
 *
 * `resync` is the caller's cue to refetch `GET /api/drafts/[draftId]` — the documented
 * fallback for a gap that outlasted the stream's retention window, and for the auction case
 * where a bid arrives against a lot we never saw open.
 */
export function applyDraftEvent(view: DraftStateView, data: string): ApplyEventResult {
  const frame = parseFrame(data);
  if (frame === null) return IGNORED;
  if (frame.payload.draftId !== view.draftId) return IGNORED;

  const { sequence } = frame.payload.clock;
  if (sequence < view.sequence) return IGNORED;
  if (sequence > view.sequence + 1) return RESYNC;

  const next = applyFrame({ ...view, ...frame.payload.clock }, frame);
  return next === null ? RESYNC : { ok: true, view: next };
}
```

- [ ] **Step 6: Write and pass the `optimisticView` test, then implement it**

```ts
// src/draft-room/state/optimistic.test.ts
import { describe, it, expect } from "vitest";
import type { DraftStateView } from "@/draft-engine";
import { optimisticView } from "./optimistic";

const base: DraftStateView = {
  phase: "in_progress",
  sequence: 4,
  pickNumber: 3,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T08:00:00.000Z",
  clockSeconds: 28_800,
  nextTightening: null,
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1"],
  minBid: null,
  maxBids: {},
};

const auction: DraftStateView = { ...base, format: "auction", budgets: { t1: 100 }, minBid: 1, maxBids: { t1: 99 }, auction: { nominatingTeamId: "t1", lot: null } };

describe("optimisticView", () => {
  it("does nothing for a spectator with no team", () => {
    expect(optimisticView(base, { type: "MAKE_PICK", playerId: "qb1" }, null)).toEqual({ view: base, pendingPlayerId: null });
  });

  it("removes the player from the pool and marks them pending on a pick — and guesses no roster slot", () => {
    const result = optimisticView(base, { type: "MAKE_PICK", playerId: "qb1" }, "t1");
    expect(result.pendingPlayerId).toBe("qb1");
    expect(result.view.availablePlayerIds).toEqual(["rb1"]);
    expect(result.view.rosters.t1).toEqual([]);
    expect(result.view.picks).toEqual([]);
  });

  it("shows the nomination as an open lot at the opening bid", () => {
    const result = optimisticView(auction, { type: "NOMINATE", playerId: "qb1", openingBid: 5 }, "t1");
    expect(result.pendingPlayerId).toBe("qb1");
    expect(result.view.auction).toEqual({
      nominatingTeamId: "t1",
      lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
  });

  it("leaves a nomination on a non-auction view alone", () => {
    const result = optimisticView(base, { type: "NOMINATE", playerId: "qb1", openingBid: 5 }, "t1");
    expect(result.view).toBe(base);
    expect(result.pendingPlayerId).toBe("qb1");
  });

  it("shows my bid as the high bid immediately", () => {
    const withLot: DraftStateView = { ...auction, auction: { nominatingTeamId: "t2", lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t2", nominatedByTeamId: "t2", autoNominated: false } } };
    const result = optimisticView(withLot, { type: "BID", amount: 6 }, "t1");
    expect(result.view.auction?.lot).toMatchObject({ highBid: 6, highBidTeamId: "t1" });
    expect(result.pendingPlayerId).toBe("qb1");
  });

  it("does nothing for a bid with no open lot, in either format", () => {
    expect(optimisticView(auction, { type: "BID", amount: 6 }, "t1")).toEqual({ view: auction, pendingPlayerId: null });
    expect(optimisticView(base, { type: "BID", amount: 6 }, "t1")).toEqual({ view: base, pendingPlayerId: null });
  });
});
```

Run: `npm test -- src/draft-room/state/optimistic`
Expected: FAIL — cannot find module `./optimistic`.

```ts
// src/draft-room/state/optimistic.ts
import type { ClientDraftAction, DraftStateView } from "@/draft-engine";

export interface OptimisticPatch {
  readonly view: DraftStateView;
  /** The player this user is committing to — rendered as "pending" until the server answers. */
  readonly pendingPlayerId: string | null;
}

/**
 * The acting client's instant feedback — what makes a draft feel live for the person acting,
 * exactly as the spec's "optimistic UI" bullet requires.
 *
 * Deliberately DISPLAY-ONLY. It never guesses a roster slot, a round, a price, a budget or a
 * turn change, because every one of those is a draft rule the engine owns. The authoritative
 * view arrives in the POST response (or over SSE) moments later and replaces this one.
 */
export function optimisticView(view: DraftStateView, action: ClientDraftAction, myTeamId: string | null): OptimisticPatch {
  if (myTeamId === null) return { view, pendingPlayerId: null };

  switch (action.type) {
    case "MAKE_PICK":
      return {
        view: { ...view, availablePlayerIds: view.availablePlayerIds.filter((id) => id !== action.playerId) },
        pendingPlayerId: action.playerId,
      };
    case "NOMINATE":
      if (view.auction === null) return { view, pendingPlayerId: action.playerId };
      return {
        view: {
          ...view,
          auction: {
            nominatingTeamId: myTeamId,
            lot: { playerId: action.playerId, highBid: action.openingBid, highBidTeamId: myTeamId, nominatedByTeamId: myTeamId, autoNominated: false },
          },
        },
        pendingPlayerId: action.playerId,
      };
    case "BID": {
      const auction = view.auction;
      if (auction === null || auction.lot === null) return { view, pendingPlayerId: null };
      return {
        view: { ...view, auction: { ...auction, lot: { ...auction.lot, highBid: action.amount, highBidTeamId: myTeamId } } },
        pendingPlayerId: auction.lot.playerId,
      };
    }
  }
}
```

- [ ] **Step 7: Write the failing hook tests**

```tsx
// src/draft-room/hooks/use-now.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./use-now";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("advances on the given interval", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNow(1_000));
    const first = result.current;
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBeGreaterThan(first);
  });

  it("clears its interval on unmount so a closed room stops ticking", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useNow(1_000));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
```

```tsx
// src/draft-room/hooks/use-draft-room.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DraftStateView } from "@/draft-engine";
import { DraftRoomDepsProvider, type DraftRoomDeps, type EventSourceLike } from "./deps";
import { useDraftRoom } from "./use-draft-room";

class FakeEventSource implements EventSourceLike {
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, payload?: unknown): void {
    const data = payload === undefined ? "" : JSON.stringify({ id: "1-0", type, leagueId: "l1", timestamp: "2026-09-01T00:00:00.000Z", payload });
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as unknown as MessageEvent);
  }
}

const VIEW: DraftStateView = {
  phase: "in_progress",
  sequence: 1,
  pickNumber: 1,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T08:00:00.000Z",
  clockSeconds: 28_800,
  nextTightening: null,
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [], t2: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1"],
  minBid: null,
  maxBids: {},
};

const PLAYERS = [
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC" },
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "SF" },
];

const TEAMS = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Dana", ownerAvatarUrl: null },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Rey", ownerAvatarUrl: null },
];

const pickPayload = (sequence: number) => ({
  draftId: "d1",
  clock: { ...VIEW, sequence, pickNumber: 2, onClockTeamId: "t2" },
  pickNumber: 1,
  round: 1,
  teamId: "t1",
  playerId: "qb1",
  slot: "QB",
  slotIndex: 0,
  price: null,
  timestamp: "2026-09-01T00:05:00.000Z",
  auto: false,
});

function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

interface Harness {
  /** Mutable: a couple of cases swap in a failing `fetchJson` before mounting. */
  deps: DraftRoomDeps;
  readonly sources: FakeEventSource[];
  readonly fetches: string[];
  snapshot: DraftStateView;
  postResponse: unknown;
}

function harness(): Harness {
  const state: Harness = {
    sources: [],
    fetches: [],
    snapshot: VIEW,
    postResponse: null,
    deps: {
      fetchJson: async (url, init) => {
        state.fetches.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/players")) return jsonOf({ ok: true, data: { players: PLAYERS } });
        if (init?.method === "POST") return jsonOf(state.postResponse);
        return jsonOf({ ok: true, data: { draft: state.snapshot, teamId: "t1", isCommissioner: false, teams: TEAMS } });
      },
      openEventSource: (url) => {
        const source = new FakeEventSource(url);
        state.sources.push(source);
        return source;
      },
    },
  };
  return state;
}

const wrapper = (deps: DraftRoomDeps) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DraftRoomDepsProvider deps={deps}>{children}</DraftRoomDepsProvider>;
  };

async function mounted(h: Harness) {
  const rendered = renderHook(() => useDraftRoom("d1"), { wrapper: wrapper(h.deps) });
  await waitFor(() => expect(rendered.result.current.status).toBe("ready"));
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDraftRoom", () => {
  it("loads the view, the players and the teams, then subscribes to the league stream", async () => {
    const h = harness();
    const { result } = await mounted(h);
    expect(result.current.view?.draftId).toBe("d1");
    expect(result.current.players).toHaveLength(2);
    expect(result.current.teams).toHaveLength(2);
    expect(result.current.myTeamId).toBe("t1");
    expect(h.sources[0]?.url).toBe("/api/leagues/l1/events");
  });

  it("surfaces the server's own message when the state request fails", async () => {
    const h = harness();
    h.deps = { ...h.deps, fetchJson: async () => jsonOf({ ok: false, error: "You don't have a team in this league." }) };
    const { result } = renderHook(() => useDraftRoom("d1"), { wrapper: wrapper(h.deps) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("You don't have a team in this league.");
  });

  it("applies a pick event to the local view without refetching", async () => {
    const h = harness();
    const { result } = await mounted(h);
    const before = h.fetches.length;
    act(() => h.sources[0]!.emit("draft.pick", pickPayload(2)));
    await waitFor(() => expect(result.current.view?.picks).toHaveLength(1));
    expect(result.current.view?.onClockTeamId).toBe("t2");
    expect(result.current.lastPick).toEqual({ pick: expect.objectContaining({ playerId: "qb1" }), isMine: true });
    expect(h.fetches).toHaveLength(before);
  });

  it("refetches the whole view when the sequence skips ahead", async () => {
    const h = harness();
    const { result } = await mounted(h);
    h.snapshot = { ...VIEW, sequence: 9, pickNumber: 5, availablePlayerIds: ["rb1"] };
    act(() => h.sources[0]!.emit("draft.pick", pickPayload(9)));
    await waitFor(() => expect(result.current.view?.sequence).toBe(9));
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1")).toHaveLength(2);
  });

  it("refetches after a reconnect and reports the connection state while it is down", async () => {
    const h = harness();
    const { result } = await mounted(h);
    act(() => h.sources[0]!.emit("error"));
    await waitFor(() => expect(result.current.connection).toBe("reconnecting"));
    h.snapshot = { ...VIEW, sequence: 12 };
    act(() => h.sources[0]!.emit("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    await waitFor(() => expect(result.current.view?.sequence).toBe(12));
  });

  it("does not refetch on the first open — only after a drop", async () => {
    const h = harness();
    const { result } = await mounted(h);
    const before = h.fetches.length;
    act(() => h.sources[0]!.emit("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    expect(h.fetches).toHaveLength(before);
  });

  it("renders a submitted pick immediately and settles on the server's view", async () => {
    const h = harness();
    const settled = { ...VIEW, sequence: 2, pickNumber: 2, onClockTeamId: "t2", availablePlayerIds: ["rb1"], picks: [{ pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false }] };
    h.postResponse = { ok: true, data: { draft: settled } };
    const { result } = await mounted(h);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.view?.picks).toHaveLength(1);
    expect(result.current.pendingPlayerId).toBeNull();
    expect(h.fetches).toContain("POST /api/drafts/d1/actions");
  });

  it("rolls back and reports the reducer's reason when the server rejects the action", async () => {
    const h = harness();
    h.postResponse = { ok: false, error: "It's not your turn to pick." };
    const { result } = await mounted(h);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });
    expect(outcome).toEqual({ ok: false, reason: "It's not your turn to pick." });
    expect(result.current.view?.availablePlayerIds).toEqual(["qb1", "rb1"]);
    expect(result.current.pendingPlayerId).toBeNull();
  });

  it("rolls back and explains itself when the request never lands", async () => {
    const h = harness();
    const inner = h.deps.fetchJson;
    h.deps = {
      ...h.deps,
      fetchJson: async (url, init) => {
        if (init?.method === "POST") throw new Error("offline");
        return inner(url, init);
      },
    };
    const { result } = renderHook(() => useDraftRoom("d1"), { wrapper: wrapper(h.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let outcome: { readonly ok: boolean; readonly reason?: string } | undefined;
    await act(async () => {
      outcome = await result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.reason).toMatch(/connection/i);
    expect(result.current.view?.availablePlayerIds).toEqual(["qb1", "rb1"]);
  });

  it("closes the stream on unmount", async () => {
    const h = harness();
    const { unmount } = await mounted(h);
    unmount();
    expect(h.sources[0]?.closed).toBe(true);
  });
});
```

- [ ] **Step 8: Run to verify failure, then implement the hooks**

Run: `npm test -- src/draft-room/hooks`
Expected: FAIL — cannot find module `./deps` / `./use-now` / `./use-draft-room`.

```tsx
// src/draft-room/hooks/deps.tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The slice of `EventSource` the room uses. Narrow on purpose, so a test double is trivial. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface DraftRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
  readonly openEventSource: (url: string) => EventSourceLike;
}

/**
 * Real browser dependencies. `new EventSource(...)` is constructed lazily inside the factory
 * so importing this module is safe in happy-dom, which has no `EventSource`.
 */
const BROWSER_DEPS: DraftRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
  openEventSource: (url) => new EventSource(url),
};

const DepsContext = createContext<DraftRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function DraftRoomDepsProvider({ deps, children }: { readonly deps: DraftRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useDraftRoomDeps(): DraftRoomDeps {
  return useContext(DepsContext);
}
```

```ts
// src/draft-room/hooks/use-now.ts
"use client";

import { useEffect, useState } from "react";

/**
 * The ONE place browser code reads the wall clock. Returns epoch milliseconds, re-rendering
 * every `intervalMs`. Display only: a countdown never decides anything — the server ticker
 * owns clock expiry, and `TIMER_EXPIRE` has no HTTP path a client could use.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
```

```ts
// src/draft-room/hooks/use-draft-room.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { ClientDraftAction, CompletedPick, DraftStateView } from "@/draft-engine";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { DraftPlayersBody, DraftSnapshotBody } from "@/draft-room/contract";
import { applyDraftEvent } from "@/draft-room/state/apply-event";
import { optimisticView } from "@/draft-room/state/optimistic";
import { useDraftRoomDeps } from "./deps";

/** The five event types this room consumes. Chat and scoring ride the same stream and are ignored. */
const DRAFT_EVENT_TYPES = ["draft.pick", "draft.nominate", "draft.bid", "draft.timer_expire", "draft.status"] as const;

const NETWORK_ERROR = "We couldn't reach the draft. Check your connection and try again.";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";
export type SubmitOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface LandedPick {
  readonly pick: CompletedPick;
  readonly isMine: boolean;
}

interface RoomState {
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly view: DraftStateView | null;
  readonly players: readonly Player[];
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly isCommissioner: boolean;
  readonly connection: ConnectionStatus;
  readonly pendingPlayerId: string | null;
  readonly submitting: boolean;
  readonly lastPick: LandedPick | null;
}

export interface DraftRoom extends RoomState {
  readonly submit: (action: ClientDraftAction) => Promise<SubmitOutcome>;
  readonly refresh: () => Promise<void>;
}

const INITIAL: RoomState = {
  status: "loading",
  error: null,
  view: null,
  players: [],
  teams: [],
  myTeamId: null,
  isCommissioner: false,
  connection: "connecting",
  pendingPlayerId: null,
  submitting: false,
  lastPick: null,
};

/**
 * The draft room's one data layer. Fetch the view, subscribe to the league stream, fold
 * events in by sequence, refetch on a gap or a reconnect, and submit actions optimistically.
 *
 * Reconnect is the browser's: a native `EventSource` retries on its own and replays
 * `Last-Event-ID` automatically. There is deliberately no retry loop, backoff timer or poll
 * in here — only the full-state refetch the conventions name as the fallback.
 */
export function useDraftRoom(draftId: string): DraftRoom {
  const deps = useDraftRoomDeps();
  const [state, setState] = useState<RoomState>(INITIAL);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  // Event handlers are long-lived closures; refs give them today's view without re-subscribing.
  const viewRef = useRef<DraftStateView | null>(null);
  const teamRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [snapshotResponse, playersResponse] = await Promise.all([
        deps.fetchJson(`/api/drafts/${draftId}`),
        deps.fetchJson(`/api/drafts/${draftId}/players`),
      ]);
      const snapshot = (await snapshotResponse.json()) as ApiEnvelope<DraftSnapshotBody>;
      if (!snapshot.ok) {
        setState((prev) => ({ ...prev, status: "error", error: snapshot.error }));
        return;
      }
      const players = (await playersResponse.json()) as ApiEnvelope<DraftPlayersBody>;
      if (!players.ok) {
        setState((prev) => ({ ...prev, status: "error", error: players.error }));
        return;
      }
      viewRef.current = snapshot.data.draft;
      teamRef.current = snapshot.data.teamId;
      setLeagueId(snapshot.data.draft.leagueId);
      setState((prev) => ({
        ...prev,
        status: "ready",
        error: null,
        view: snapshot.data.draft,
        players: players.data.players,
        teams: snapshot.data.teams,
        myTeamId: snapshot.data.teamId,
        isCommissioner: snapshot.data.isCommissioner,
        pendingPlayerId: null,
      }));
    } catch {
      setState((prev) => ({ ...prev, status: "error", error: NETWORK_ERROR }));
    }
  }, [deps, draftId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (leagueId === null) return;
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);
    let dropped = false;

    const onDraftEvent = (event: MessageEvent) => {
      const current = viewRef.current;
      if (current === null) return;
      const result = applyDraftEvent(current, String(event.data));
      if (!result.ok) {
        if (result.outcome === "resync") void refresh();
        return;
      }
      const landed = result.view.picks.length > current.picks.length ? result.view.picks[result.view.picks.length - 1] ?? null : null;
      viewRef.current = result.view;
      setState((prev) => ({
        ...prev,
        view: result.view,
        lastPick: landed === null ? prev.lastPick : { pick: landed, isMine: landed.teamId === teamRef.current },
      }));
    };

    const onOpen = () => {
      setState((prev) => ({ ...prev, connection: "live" }));
      // Only a reconnect needs a refetch: the browser has already replayed whatever the
      // stream still held, and a gap beyond retention is exactly what this covers.
      if (dropped) {
        dropped = false;
        void refresh();
      }
    };

    const onError = () => {
      dropped = true;
      setState((prev) => ({ ...prev, connection: "reconnecting" }));
    };

    for (const type of DRAFT_EVENT_TYPES) source.addEventListener(type, onDraftEvent);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => source.close();
  }, [deps, leagueId, refresh]);

  const submit = useCallback(
    async (action: ClientDraftAction): Promise<SubmitOutcome> => {
      const before = viewRef.current;
      if (before === null) return { ok: false, reason: "The draft isn't loaded yet." };

      const patch = optimisticView(before, action, teamRef.current);
      viewRef.current = patch.view;
      setState((prev) => ({ ...prev, view: patch.view, pendingPlayerId: patch.pendingPlayerId, submitting: true }));

      const rollback = (): void => {
        viewRef.current = before;
        setState((prev) => ({ ...prev, view: before, pendingPlayerId: null, submitting: false }));
      };

      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        const body = (await response.json()) as ApiEnvelope<{ readonly draft: DraftStateView }>;
        if (!body.ok) {
          rollback();
          return { ok: false, reason: body.error };
        }
        // SSE may already have carried us past this response; never move the view backwards.
        const held = viewRef.current;
        const settled = held !== null && held.sequence > body.data.draft.sequence ? held : body.data.draft;
        viewRef.current = settled;
        setState((prev) => ({ ...prev, view: settled, pendingPlayerId: null, submitting: false }));
        return { ok: true };
      } catch {
        rollback();
        return { ok: false, reason: NETWORK_ERROR };
      }
    },
    [deps, draftId],
  );

  return { ...state, submit, refresh };
}
```

- [ ] **Step 9: Run everything, including the new coverage gate**

Run: `npm test -- src/draft-room`
Expected: PASS.

Run: `npm run test:coverage`
Expected: PASS with `src/draft-room/state/**` at 100%. `payloads.ts` is schema declarations only (no functions, no branches) and is covered by importing it.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add vitest.config.mts src/draft-room
git commit -m "feat(draft-room): pure SSE view reducer and useDraftRoom hook

applyDraftEvent folds one draft.* frame into a DraftStateView and reports a resync on any
sequence gap or on a bid against a lot we never saw open; useDraftRoom wires fetch, native
EventSource (browser-owned reconnect + Last-Event-ID) and optimistic submit with rollback."
```

---
### Task 6: The snake draft room — pool, rosters, clock/tier banner, history, page

**Model tier:** standard (UI transcription over an already-specified data layer).

**Files:**
- Create: `src/draft-room/test-fixtures.tsx`, `src/draft-room/components/connection-banner.tsx`, `clock-banner.tsx`, `player-pool.tsx`, `roster-board.tsx`, `pick-history.tsx`, `snake-room.tsx`, `draft-room.tsx`, `src/app/app/drafts/[draftId]/page.tsx`
- Test: `src/draft-room/components/clock-banner.test.tsx`, `player-pool.test.tsx`, `roster-board.test.tsx`, `pick-history.test.tsx`, `draft-room.test.tsx`

**Interfaces:**
- Consumes: `useDraftRoom`, `useNow`, `DRAFT_ROOM_CONFIG`, `formatCountdown`, `formatClockLength`, `formatTightening`, `Button`, `Input`, `Select`, `Card`, `Badge`, `Table`, `Avatar`, `Skeleton`, `EmptyState`, `ErrorState`, `Icon`, `ToastProvider`, `useToast`, `requireCurrentUser`.
- Produces:
  - `ConnectionBanner({ connection })`
  - `ClockBanner({ view, teams, myTeamId })`
  - `PlayerPool({ players, view, pendingPlayerId, canAct, actionLabel, submitting, onAct })`
  - `RosterBoard({ view, teams, playersById, myTeamId })`
  - `PickHistory({ view, teams, playersById })`
  - `SnakeRoom({ room, playersById, onAct })` where `onAct: (action: ClientDraftAction) => void`
  - `DraftRoom({ draftId })` — the client entry point
  - Route `/app/drafts/[draftId]`
  - `test-fixtures.tsx`: `SNAKE_VIEW`, `AUCTION_VIEW`, `PLAYERS`, `TEAMS`, `playersById(players)`, `FakeEventSource`, `fixtureDeps()`, `renderInRoom(ui, deps)`

**Design notes the implementer must preserve:**
- **The countdown is `aria-hidden`.** A number that changes every second inside a live region is unusable with a screen reader. The banner instead carries a static, screen-reader-visible sentence naming the current clock length and whose turn it is; the ticking digits are decoration on top of it.
- **The player pool lists every player in server-ranked order** and marks drafted ones; it never re-ranks. Availability is `view.availablePlayerIds`, not a client computation.
- **The act button is disabled unless it is genuinely this user's turn** — `view.onClockTeamId === myTeamId` for snake — and shows `loading` while a submit is in flight. The server is still the authority; this is affordance, not enforcement.
- **The roster grid draws `view.slotConfig`**, so empty slots are visible; a filled slot is matched by `(slot, slotIndex)` — both supplied by the engine.
- 360px: the room is a single column that becomes two at `lg`. Every table scrolls inside itself.

- [ ] **Step 1: Write the shared fixtures (not a `.test.` file, so vitest does not collect it)**

```tsx
// src/draft-room/test-fixtures.tsx
import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { DraftRoomDepsProvider, type DraftRoomDeps, type EventSourceLike } from "./hooks/deps";

export const PLAYERS: readonly Player[] = [
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC" },
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "SF" },
  { id: "rb2", name: "Devon Marsh", position: "RB", nflTeam: "NYJ" },
  { id: "wr1", name: "Andre Salas", position: "WR", nflTeam: "DAL" },
];

export const TEAMS: readonly TeamCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Dana Whitfield", ownerAvatarUrl: null },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Rey Okafor", ownerAvatarUrl: null },
];

export const SNAKE_VIEW: DraftStateView = {
  phase: "in_progress",
  sequence: 1,
  pickNumber: 1,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T00:02:05.000Z",
  clockSeconds: 28_800,
  nextTightening: { at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 },
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  ],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [], t2: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1", "rb2", "wr1"],
  minBid: null,
  maxBids: {},
};

export const AUCTION_VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  format: "auction",
  onClockTeamId: "t1",
  budgets: { t1: 100, t2: 100 },
  minBid: 1,
  maxBids: { t1: 97, t2: 97 },
  auction: { nominatingTeamId: "t1", lot: null },
};

export function playersById(players: readonly Player[] = PLAYERS): ReadonlyMap<string, Player> {
  return new Map(players.map((player) => [player.id, player]));
}

export class FakeEventSource implements EventSourceLike {
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, payload?: unknown): void {
    const data = payload === undefined ? "" : JSON.stringify({ id: "1-0", type, leagueId: "l1", timestamp: "2026-09-01T00:00:00.000Z", payload });
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as unknown as MessageEvent);
  }
}

export interface FixtureDeps {
  /** Mutable: some cases swap in a failing `fetchJson` before mounting. */
  deps: DraftRoomDeps;
  readonly sources: FakeEventSource[];
  readonly calls: string[];
  /** Mutable: reassign before emitting an event to control what a resync refetch returns. */
  view: DraftStateView;
  teamId: string | null;
  postResponse: unknown;
}

/** Injected doubles for the whole room: no module mocks, no real network, no real EventSource. */
export function fixtureDeps(view: DraftStateView = SNAKE_VIEW): FixtureDeps {
  const fixture: FixtureDeps = {
    sources: [],
    calls: [],
    view,
    teamId: "t1",
    postResponse: { ok: true, data: { draft: view } },
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        const body = url.endsWith("/players")
          ? { ok: true, data: { players: PLAYERS } }
          : init?.method === "POST"
            ? fixture.postResponse
            : { ok: true, data: { draft: fixture.view, teamId: fixture.teamId, isCommissioner: false, teams: TEAMS } };
        return { json: async () => body } as unknown as Response;
      },
      openEventSource: (url) => {
        const source = new FakeEventSource(url);
        fixture.sources.push(source);
        return source;
      },
    },
  };
  return fixture;
}

export function renderInRoom(ui: ReactElement, deps: DraftRoomDeps): RenderResult {
  return render(<DraftRoomDepsProvider deps={deps}>{ui}</DraftRoomDepsProvider>);
}
```

- [ ] **Step 2: Write the failing component tests**

```tsx
// src/draft-room/components/clock-banner.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { inBothThemes } from "@/components/ui/test-utils";
import { SNAKE_VIEW, TEAMS } from "../test-fixtures";
import { ClockBanner } from "./clock-banner";

/**
 * Deadlines are built relative to the real clock rather than with fake timers: `useNow` reads
 * `Date.now()` once on mount, and `formatCountdown` rounds up, so a 125-second gap renders
 * "2:05" for any elapsed time under a second. Fake timers are avoided here on purpose — axe
 * runs async and deadlocks against them.
 */
function liveView(over: Partial<DraftStateView> = {}): DraftStateView {
  return {
    ...SNAKE_VIEW,
    deadlineAt: new Date(Date.now() + 125_000).toISOString(),
    // 134.5 minutes out, so the floor-to-minutes gap reads "2h 14m" with room to spare.
    nextTightening: { at: new Date(Date.now() + 134 * 60_000 + 30_000).toISOString(), pickSeconds: 600 },
    ...over,
  };
}

const finished: Partial<DraftStateView> = { onClockTeamId: null, deadlineAt: null, clockSeconds: null, nextTightening: null };

describe("ClockBanner", () => {
  it("names who is on the clock, counts down, and says when the clock tightens — both themes, axe-clean", async () => {
    await inBothThemes(<ClockBanner view={liveView()} teams={TEAMS} myTeamId="t2" />, async ({ container }) => {
      expect(screen.getByText("On the clock")).toBeInTheDocument();
      expect(screen.getByTestId("countdown")).toHaveTextContent("2:05");
      expect(screen.getByText("Picks shorten to 10 minutes in 2h 14m")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("hides the ticking digits from assistive tech and states the clock in words instead", () => {
    render(<ClockBanner view={liveView()} teams={TEAMS} myTeamId="t2" />);
    expect(screen.getByTestId("countdown")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Bay Bandits is on the clock. This round's pick clock is 8 hours.")).toBeInTheDocument();
  });

  it("says it is your turn when it is", () => {
    render(<ClockBanner view={liveView()} teams={TEAMS} myTeamId="t1" />);
    expect(screen.getByText("You're on the clock")).toBeInTheDocument();
  });

  it("explains a draft that has not started and one that has finished", () => {
    const { rerender } = render(<ClockBanner view={{ ...SNAKE_VIEW, phase: "scheduled", ...finished }} teams={TEAMS} myTeamId="t1" />);
    expect(screen.getByText("This draft hasn't started yet.")).toBeInTheDocument();
    rerender(<ClockBanner view={{ ...SNAKE_VIEW, phase: "complete", ...finished }} teams={TEAMS} myTeamId="t1" />);
    expect(screen.getByText("This draft is complete.")).toBeInTheDocument();
  });
});
```

```tsx
// src/draft-room/components/player-pool.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW } from "../test-fixtures";
import { PlayerPool } from "./player-pool";

const props = {
  players: PLAYERS,
  view: SNAKE_VIEW,
  pendingPlayerId: null,
  canAct: true,
  actionLabel: "Draft",
  submitting: false,
  onAct: () => {},
};

describe("PlayerPool", () => {
  it("lists every player in ranked order and is axe-clean in both themes", async () => {
    await inBothThemes(<PlayerPool {...props} />, async ({ container }) => {
      const rows = within(screen.getByRole("table", { name: /available players/i })).getAllByRole("row").slice(1);
      expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
        "Jalen Croft",
        "Marcus Reed",
        "Devon Marsh",
        "Andre Salas",
      ]);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("filters by name as you type", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "marc" } });
    expect(screen.getByText("Marcus Reed")).toBeInTheDocument();
    expect(screen.queryByText("Jalen Croft")).toBeNull();
  });

  it("filters by position", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "RB" } });
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + two RBs
  });

  it("offers a way out when nothing matches", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "zzzz" } });
    expect(screen.getByRole("heading", { name: "No players match" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
  });

  it("marks drafted players and refuses to act on them", () => {
    render(<PlayerPool {...props} view={{ ...SNAKE_VIEW, availablePlayerIds: ["rb1", "rb2", "wr1"] }} />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(within(row).getByText("Drafted")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("disables acting when it is not your turn, and reports the player when it is", () => {
    const onAct = vi.fn();
    const { rerender } = render(<PlayerPool {...props} canAct={false} onAct={onAct} />);
    expect(screen.getAllByRole("button", { name: "Draft" })[0]).toBeDisabled();

    rerender(<PlayerPool {...props} canAct onAct={onAct} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Draft" })[0]!);
    expect(onAct).toHaveBeenCalledWith("qb1");
  });

  it("shows the in-flight player as pending", () => {
    render(<PlayerPool {...props} pendingPlayerId="qb1" submitting />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(within(row).getByRole("button", { name: "Draft" })).toHaveAttribute("aria-busy", "true");
  });
});
```

```tsx
// src/draft-room/components/roster-board.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { RosterBoard } from "./roster-board";

const filled = { ...SNAKE_VIEW, rosters: { t1: [{ slot: "QB" as const, slotIndex: 0, playerId: "qb1" }], t2: [] } };

describe("RosterBoard", () => {
  it("draws every configured slot, filled and empty, in both themes with no axe violations", async () => {
    await inBothThemes(<RosterBoard view={filled} teams={TEAMS} playersById={playersById(PLAYERS)} myTeamId="t1" />, async ({ container }) => {
      const mine = screen.getByRole("group", { name: "Bay Bandits" });
      expect(within(mine).getByText("Jalen Croft")).toBeInTheDocument();
      // QB×1 + RB×2 = three slots, two of them still empty.
      expect(within(mine).getAllByText("Empty")).toHaveLength(2);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks your own team so you can find it at a glance", () => {
    render(<RosterBoard view={filled} teams={TEAMS} playersById={playersById(PLAYERS)} myTeamId="t1" />);
    expect(within(screen.getByRole("group", { name: "Bay Bandits" })).getByText("Your team")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Iron Owls" })).queryByText("Your team")).toBeNull();
  });
});
```

```tsx
// src/draft-room/components/pick-history.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { PickHistory } from "./pick-history";

const withPicks = {
  ...SNAKE_VIEW,
  picks: [
    { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false },
    { pickNumber: 2, round: 1, teamId: "t2", playerId: "rb1", slot: "RB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:06:00.000Z", auto: true },
  ],
};

describe("PickHistory", () => {
  it("lists picks newest first, flags autopicks, and is axe-clean in both themes", async () => {
    await inBothThemes(<PickHistory view={withPicks} teams={TEAMS} playersById={playersById(PLAYERS)} />, async ({ container }) => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveTextContent("Marcus Reed");
      expect(rows[0]).toHaveTextContent("Auto");
      expect(rows[1]).toHaveTextContent("Jalen Croft");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says nothing has happened yet rather than showing an empty table", () => {
    render(<PickHistory view={SNAKE_VIEW} teams={TEAMS} playersById={playersById(PLAYERS)} />);
    expect(screen.getByRole("heading", { name: "No picks yet" })).toBeInTheDocument();
  });
});
```

```tsx
// src/draft-room/components/draft-room.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { fixtureDeps, renderInRoom, SNAKE_VIEW } from "../test-fixtures";
import { DraftRoom } from "./draft-room";

function mount(fixture = fixtureDeps()) {
  const rendered = renderInRoom(
    <ToastProvider>
      <DraftRoom draftId="d1" />
    </ToastProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

describe("DraftRoom", () => {
  it("shows a loading state, then the live snake room, axe-clean", async () => {
    const { rendered } = mount();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    // "Bay Bandits" appears in the clock banner AND its roster card — assert presence, not uniqueness.
    await waitFor(() => expect(screen.getAllByText("Bay Bandits").length).toBeGreaterThan(0));
    expect(screen.getByRole("table", { name: /available players/i })).toBeInTheDocument();
    expect(await axe(rendered.container)).toHaveNoViolations();
  });

  it("offers a retry when the draft cannot be loaded", async () => {
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft doesn't exist." }) }) as unknown as Response };
    renderInRoom(<ToastProvider><DraftRoom draftId="d1" /></ToastProvider>, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft doesn't exist."));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("submits a pick and shows the reducer's reason in a toast when it is rejected", async () => {
    const fixture = fixtureDeps();
    fixture.postResponse = { ok: false, error: "It's not your turn to pick." };
    mount(fixture);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Draft" })[0]).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Draft" })[0]!);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("It's not your turn to pick.");
    // rolled back: the player is available again
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
  });

  it("tells the user when the connection drops", async () => {
    const { fixture } = mount();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));
    act(() => fixture.sources[0]!.emit("error"));
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/draft-room/components`
Expected: FAIL — none of the component modules exist.

- [ ] **Step 4: Implement the presentational components**

```tsx
// src/draft-room/components/connection-banner.tsx
"use client";

import { Badge } from "@/components/ui";
import type { ConnectionStatus } from "../hooks/use-draft-room";

const COPY: Readonly<Record<ConnectionStatus, string | null>> = {
  connecting: "Connecting…",
  live: null,
  reconnecting: "Reconnecting…",
};

/**
 * The connection is only worth mentioning when it is not working. The browser reconnects on
 * its own and the room refetches once it is back, so this is information, not a control.
 */
export function ConnectionBanner({ connection }: { readonly connection: ConnectionStatus }) {
  const copy = COPY[connection];
  if (copy === null) return null;
  return (
    <p aria-live="polite" className="text-sm text-text-muted">
      <Badge tone="warning">{copy}</Badge>
    </p>
  );
}
```

```tsx
// src/draft-room/components/clock-banner.tsx
"use client";

import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Card } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { formatClockLength, formatCountdown, formatTightening } from "../state/format";
import { useNow } from "../hooks/use-now";

export interface ClockBannerProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
}

/**
 * Whose turn it is, how long is left, and — the part that turns the auto-tightening schedule
 * from an engine feature into a product feature — when the clock next shortens.
 *
 * The ticking digits are `aria-hidden`: a number changing every second inside a live region
 * is unusable with a screen reader. The sentence beneath them says the same thing statically.
 */
export function ClockBanner({ view, teams, myTeamId }: ClockBannerProps) {
  const now = useNow(DRAFT_ROOM_CONFIG.countdownTickMs);

  if (view.phase === "scheduled") {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">This draft hasn&apos;t started yet.</p>
        <p className="text-sm text-text-muted">Your commissioner starts it when everyone is here.</p>
      </Card>
    );
  }
  if (view.phase === "complete") {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">This draft is complete.</p>
        <p className="text-sm text-text-muted">Every roster below is final.</p>
      </Card>
    );
  }

  const onClockTeam = teams.find((team) => team.id === view.onClockTeamId) ?? null;
  const isMine = view.onClockTeamId !== null && view.onClockTeamId === myTeamId;
  const remainingMs = view.deadlineAt === null ? null : Date.parse(view.deadlineAt) - now;
  const clockLength = view.clockSeconds === null ? null : formatClockLength(view.clockSeconds);
  const tightening = formatTightening(view.nextTightening, now);
  const who = onClockTeam?.name ?? "Nobody";

  return (
    <Card as="section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={isMine ? "accent" : "neutral"}>{isMine ? "You're on the clock" : "On the clock"}</Badge>
        <span className="text-xl font-semibold text-text-primary">{who}</span>
        {remainingMs === null ? null : (
          <span data-testid="countdown" aria-hidden="true" className="ml-auto text-2xl font-semibold tabular-nums text-text-primary">
            {formatCountdown(remainingMs)}
          </span>
        )}
      </div>
      <p className="text-sm text-text-muted">
        {who} is on the clock.{clockLength === null ? "" : ` This round's pick clock is ${clockLength}.`}
      </p>
      {tightening === null ? null : <p className="text-sm text-warning">{tightening}</p>}
    </Card>
  );
}
```

> The static sentence and the badge deliberately repeat the team name: the badge is scanned, the sentence is read aloud.

```tsx
// src/draft-room/components/player-pool.tsx
"use client";

import { useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Input, Select, Table, type TableColumn } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../state/config";

const ALL = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const POSITION_OPTIONS = [{ value: ALL, label: "All positions" }, ...POSITIONS.map((position) => ({ value: position, label: position }))];

export interface PlayerPoolProps {
  /** Server-ranked, best first. This component never re-ranks. */
  readonly players: readonly Player[];
  readonly view: DraftStateView;
  readonly pendingPlayerId: string | null;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly submitting: boolean;
  readonly onAct: (playerId: string) => void;
}

interface PoolRow {
  readonly player: Player;
  readonly rank: number;
  readonly drafted: boolean;
}

export function PlayerPool({ players, view, pendingPlayerId, canAct, actionLabel, submitting, onAct }: PlayerPoolProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(ALL);

  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .map((player, index): PoolRow => ({ player, rank: index + 1, drafted: !available.has(player.id) }))
      .filter((row) => (position === ALL || row.player.position === position) && (needle === "" || row.player.name.toLowerCase().includes(needle)))
      .slice(0, DRAFT_ROOM_CONFIG.poolPageSize);
  }, [players, available, query, position]);

  const columns: readonly TableColumn<PoolRow>[] = [
    { key: "name", header: "Player", cell: (row) => row.player.name },
    { key: "position", header: "Pos", cell: (row) => row.player.position },
    { key: "team", header: "NFL", cell: (row) => row.player.nflTeam, hideOnNarrow: true },
    { key: "rank", header: "Rank", cell: (row) => row.rank, numeric: true, hideOnNarrow: true },
    {
      key: "action",
      header: "Action",
      cell: (row) =>
        row.drafted ? (
          <Badge tone="neutral">Drafted</Badge>
        ) : (
          <Button size="sm" disabled={!canAct} loading={submitting && pendingPlayerId === row.player.id} onClick={() => onAct(row.player.id)}>
            {actionLabel}
          </Button>
        ),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Search players" value={query} placeholder="Name" onChange={(event) => setQuery(event.target.value)} />
        <Select label="Position" options={POSITION_OPTIONS} value={position} onChange={(event) => setPosition(event.target.value)} />
      </div>
      <Table
        caption="Available players, best first"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.player.id}
        rowClassName={(row) => (row.drafted ? "opacity-60" : "")}
        empty={
          <EmptyState
            title="No players match"
            description="Try a different name or position."
            icon="search"
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setPosition(ALL);
                }}
              >
                Clear filters
              </Button>
            }
          />
        }
      />
    </section>
  );
}
```

```tsx
// src/draft-room/components/roster-board.tsx
"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Avatar, Badge, Card } from "@/components/ui";

export interface RosterBoardProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
}

interface SlotCell {
  readonly key: string;
  readonly slot: string;
  readonly playerName: string | null;
}

/** Expands the league's declared roster shape into one cell per spot, filled or not. */
function cellsFor(view: DraftStateView, teamId: string, playersById: ReadonlyMap<string, Player>): readonly SlotCell[] {
  const filled = view.rosters[teamId] ?? [];
  return view.slotConfig.flatMap((config) =>
    Array.from({ length: config.count }, (_, slotIndex): SlotCell => {
      const entry = filled.find((slot) => slot.slot === config.slot && slot.slotIndex === slotIndex);
      const playerId = entry?.playerId ?? null;
      return {
        key: `${config.slot}-${slotIndex}`,
        slot: config.slot,
        playerName: playerId === null ? null : (playersById.get(playerId)?.name ?? playerId),
      };
    }),
  );
}

export function RosterBoard({ view, teams, playersById, myTeamId }: RosterBoardProps) {
  const ordered = view.draftOrder.map((teamId) => teams.find((team) => team.id === teamId)).filter((team): team is TeamCard => team !== undefined);

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {ordered.map((team) => (
        <Card
          key={team.id}
          as="article"
          role="group"
          aria-label={team.name}
          className={team.id === myTeamId ? "border-accent" : ""}
        >
          <header className="mb-3 flex items-center gap-2">
            <Avatar name={team.ownerDisplayName} src={team.ownerAvatarUrl} size="sm" />
            <span className="font-semibold text-text-primary">{team.name}</span>
            {team.id === myTeamId ? <Badge tone="accent">Your team</Badge> : null}
          </header>
          <ul className="flex flex-col gap-1">
            {cellsFor(view, team.id, playersById).map((cell) => (
              <li key={cell.key} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="w-12 shrink-0 text-text-muted">{cell.slot}</span>
                <span className={cell.playerName === null ? "grow text-text-muted" : "grow text-text-primary"}>{cell.playerName ?? "Empty"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}
```

```tsx
// src/draft-room/components/pick-history.tsx
"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@/components/ui";

export interface PickHistoryProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
}

export function PickHistory({ view, teams, playersById }: PickHistoryProps) {
  const rows = [...view.picks].reverse();
  const nameOf = (teamId: string) => teams.find((team) => team.id === teamId)?.name ?? teamId;

  const columns: readonly TableColumn<CompletedPick>[] = [
    { key: "pick", header: "#", cell: (pick) => pick.pickNumber, numeric: true },
    { key: "player", header: "Player", cell: (pick) => playersById.get(pick.playerId)?.name ?? pick.playerId },
    { key: "team", header: "Team", cell: (pick) => nameOf(pick.teamId), hideOnNarrow: true },
    { key: "slot", header: "Slot", cell: (pick) => pick.slot, hideOnNarrow: true },
    { key: "price", header: "Price", cell: (pick) => (pick.price === null ? "—" : `$${pick.price}`), numeric: true },
    { key: "auto", header: "Auto", cell: (pick) => (pick.auto ? <Badge tone="warning">Auto</Badge> : null) },
  ];

  return (
    <Table
      caption="Pick history, newest first"
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(pick) => String(pick.pickNumber)}
      empty={<EmptyState title="No picks yet" description="Every pick lands here the moment it happens." action={<Button disabled>Waiting for the first pick</Button>} />}
    />
  );
}
```

> `EmptyState` requires an action. A disabled button that names what is being waited for is the honest affordance here — there is nothing for the user to do but wait, and saying so is better than a dead end.

- [ ] **Step 5: Implement the snake room and the client entry point**

```tsx
// src/draft-room/components/snake-room.tsx
"use client";

import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { ClockBanner } from "./clock-banner";
import { PlayerPool } from "./player-pool";
import { RosterBoard } from "./roster-board";
import { PickHistory } from "./pick-history";

export interface SnakeRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
}

export function SnakeRoom({ room, playersById, onAct }: SnakeRoomProps) {
  const view = room.view!;
  // Affordance only — the server decides. `onClockTeamId` is the engine's answer, not ours.
  const canAct = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;

  return (
    <div className="flex flex-col gap-4">
      <ClockBanner view={view} teams={room.teams} myTeamId={room.myTeamId} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerPool
          players={room.players}
          view={view}
          pendingPlayerId={room.pendingPlayerId}
          canAct={canAct}
          actionLabel="Draft"
          submitting={room.submitting}
          onAct={(playerId) => onAct({ type: "MAKE_PICK", playerId })}
        />
        <div className="flex flex-col gap-4">
          <RosterBoard view={view} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} />
          <PickHistory view={view} teams={room.teams} playersById={playersById} />
        </div>
      </div>
    </div>
  );
}
```

> `room.view!` is safe because `DraftRoom` only renders `SnakeRoom` once `status === "ready"`, which implies a view. Keep the non-null assertion here rather than adding an unreachable branch that no test could cover.

```tsx
// src/draft-room/components/draft-room.tsx
"use client";

import { useMemo } from "react";
import type { ClientDraftAction } from "@/draft-engine";
import { Button, ErrorState, Skeleton, useToast } from "@/components/ui";
import { useDraftRoom } from "../hooks/use-draft-room";
import { ConnectionBanner } from "./connection-banner";
import { SnakeRoom } from "./snake-room";

/**
 * The client entry point. Owns the three page-level states (loading / error / ready) and the
 * one place a rejected action becomes a toast — components below never talk to the server.
 */
export function DraftRoom({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const { show } = useToast();
  const playersById = useMemo(() => new Map(room.players.map((player) => [player.id, player])), [room.players]);

  const act = (action: ClientDraftAction): void => {
    void room.submit(action).then((outcome) => {
      if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
    });
  };

  if (room.status === "loading") return <Skeleton lines={6} />;
  if (room.status === "error" || room.view === null) {
    return (
      <ErrorState
        title="We couldn't open this draft"
        description={room.error ?? "Something went wrong on our side."}
        action={<Button onClick={() => void room.refresh()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ConnectionBanner connection={room.connection} />
      <SnakeRoom room={room} playersById={playersById} onAct={act} />
    </div>
  );
}
```

> Task 7 replaces the single `<SnakeRoom>` with a switch on `room.view.format`. Until then a room only renders the snake layout; nothing else in this task depends on that.

```tsx
// src/app/app/drafts/[draftId]/page.tsx
import { requireCurrentUser } from "@/lib/auth/current-user";
import { ToastProvider } from "@/components/ui";
import { DraftRoom } from "@/draft-room/components/draft-room";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * The authed shell. Membership is enforced by the API the room calls — a non-member gets a
 * 403 that surfaces as the room's error state. The rule lives in `resolveDraftActor`, once.
 */
export default async function DraftRoomPage({ params }: PageProps) {
  await requireCurrentUser();
  const { draftId } = await params;
  return (
    <ToastProvider>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold text-text-primary">Draft room</h1>
        <DraftRoom draftId={draftId} />
      </main>
    </ToastProvider>
  );
}
```

- [ ] **Step 6: Run the tests and the checks**

Run: `npm test -- src/draft-room`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Keyboard and 360px walkthrough (manual, recorded in the task report)**

Run: `npm run dev`, sign in, seed if needed (`npm run seed` with `DEV_SEED_CLAIM_USER_ID` set to your WorkOS user id), open `/app/drafts/dev_draft_snake` at a 360px viewport and confirm: Tab reaches the search box, the position select, and every enabled Draft button; the page does not scroll sideways; the countdown updates; both themes look right.

- [ ] **Step 8: Commit**

```bash
git add src/draft-room "src/app/app/drafts"
git commit -m "feat(draft-room): live snake draft room — pool, rosters, clock/tier banner, history"
```

---
### Task 7: The auction room — nomination, live lot, bidding, budgets, and resync hardening

**Model tier:** standard.

**Files:**
- Create: `src/draft-room/components/auction-lot.tsx`, `bid-controls.tsx`, `nominate-modal.tsx`, `budget-table.tsx`, `auction-room.tsx`
- Modify: `src/draft-room/components/draft-room.tsx`, `src/draft-room/state/format.ts`, `src/draft-room/state/format.test.ts`
- Test: `src/draft-room/components/auction-lot.test.tsx`, `bid-controls.test.tsx`, `auction-room.test.tsx`

**Interfaces:**
- Consumes: everything from Task 6 plus `Modal`, `Input`, `Table`.
- Produces:
  - `rosterSpots(slotConfig: readonly RosterSlotConfig[]): number` (added to `state/format.ts`).
  - `AuctionLotPanel({ view, teams, playersById })`
  - `BidControls({ view, myTeamId, submitting, onBid })`
  - `NominateModal({ open, playerName, view, myTeamId, onClose, onNominate })`
  - `BudgetTable({ view, teams, myTeamId })`
  - `AuctionRoom({ room, playersById, onAct })`
  - `DraftRoom` now switches on `room.view.format`.

**Design notes the implementer must preserve:**
- **Every number in this room comes from the server.** `view.minBid` is the bid floor, `view.maxBids[myTeamId]` is this team's ceiling (already reserve-adjusted by the engine), `view.budgets` is remaining money. The reserve formula appears **nowhere** in React — that is the whole point of Task 4's `maxBids`.
- Disabling the bid button when you are already the high bidder, or when your ceiling is below the floor, is **affordance**, not enforcement — the reducer still rejects those, and the rejection still becomes a toast.
- **Resync is the auction's safety net.** `applyDraftEvent` returns `resync` for a bid against a lot we never saw open, and for any sequence gap; `useDraftRoom` then refetches the whole view, which restores the lot *and* every budget in one shot. Two tests in this task prove exactly the two cases Step 5 of the spec names: a missed bid war and a budget desync.
- The nomination flow uses `Modal` so the opening bid is a deliberate choice, not a mis-click on a crowded board.

- [ ] **Step 1: Add `rosterSpots` (test first)**

```ts
// src/draft-room/state/format.test.ts — append
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { totalRosterSlots } from "@/draft-engine";
import { rosterSpots } from "./format";

describe("rosterSpots", () => {
  it("sums the league's declared slot counts", () => {
    expect(rosterSpots([{ slot: "QB", count: 1, eligiblePositions: ["QB"] }, { slot: "RB", count: 2, eligiblePositions: ["RB"] }])).toBe(3);
    expect(rosterSpots([])).toBe(0);
  });

  it("agrees with the engine's own total, which is what pins the two together", () => {
    expect(rosterSpots(STANDARD_ROSTER_SLOTS)).toBe(totalRosterSlots(STANDARD_ROSTER_SLOTS));
  });
});
```

```ts
// src/draft-room/state/format.ts — append
import type { RosterSlotConfig } from "@/domain/roster";

/**
 * How many roster spots the league declares. Config arithmetic, not a draft rule — which is
 * why it lives here rather than being value-imported from `@/draft-engine` (the room imports
 * types from the engine and nothing else, so no rule can leak into React). The test above
 * asserts it agrees with the engine's `totalRosterSlots`, so the two cannot silently diverge.
 */
export function rosterSpots(slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.reduce((sum, config) => sum + config.count, 0);
}
```

Run: `npm test -- src/draft-room/state/format`
Expected: PASS.

- [ ] **Step 2: Write the failing auction component tests**

```tsx
// src/draft-room/components/auction-lot.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW, PLAYERS, TEAMS, playersById } from "../test-fixtures";
import { AuctionLotPanel } from "./auction-lot";

/** Relative deadline for the same reason `clock-banner.test.tsx` uses one: axe and fake timers deadlock. */
const withLot: DraftStateView = {
  ...AUCTION_VIEW,
  onClockTeamId: null,
  deadlineAt: new Date(Date.now() + 12_000).toISOString(),
  clockSeconds: 15,
  auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 24, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
};

describe("AuctionLotPanel", () => {
  it("shows the player up for bid, the high bid and bidder, and the time left — both themes, axe-clean", async () => {
    await inBothThemes(<AuctionLotPanel view={withLot} teams={TEAMS} playersById={playersById(PLAYERS)} />, async ({ container }) => {
      expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
      expect(screen.getByText("$24")).toBeInTheDocument();
      expect(screen.getByText("Iron Owls")).toBeInTheDocument();
      expect(screen.getByTestId("lot-countdown")).toHaveTextContent("0:12");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says who everyone is waiting on between lots", () => {
    render(<AuctionLotPanel view={AUCTION_VIEW} teams={TEAMS} playersById={playersById(PLAYERS)} />);
    expect(screen.getByText("Bay Bandits is choosing who goes up next.")).toBeInTheDocument();
  });

  it("flags a lot the clock nominated", () => {
    const auto = { ...withLot, auction: { ...withLot.auction, lot: { ...withLot.auction.lot, autoNominated: true } } };
    render(<AuctionLotPanel view={auto} teams={TEAMS} playersById={playersById(PLAYERS)} />);
    expect(screen.getByText("Auto-nominated")).toBeInTheDocument();
  });
});
```

```tsx
// src/draft-room/components/bid-controls.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW } from "../test-fixtures";
import { BidControls } from "./bid-controls";

const open = {
  ...AUCTION_VIEW,
  minBid: 25,
  maxBids: { t1: 80, t2: 97 },
  auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 24, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
};

describe("BidControls", () => {
  it("states the legal range from the server's own numbers, in both themes, axe-clean", async () => {
    await inBothThemes(<BidControls view={open} myTeamId="t1" submitting={false} onBid={() => {}} />, async ({ container }) => {
      const input = screen.getByLabelText("Your bid");
      expect(input).toHaveAttribute("min", "25");
      expect(input).toHaveAttribute("max", "80");
      expect(screen.getByText("Between $25 and $80.")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("submits the typed amount", () => {
    const onBid = vi.fn();
    render(<BidControls view={open} myTeamId="t1" submitting={false} onBid={onBid} />);
    fireEvent.change(screen.getByLabelText("Your bid"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Bid" }));
    expect(onBid).toHaveBeenCalledWith(30);
  });

  it("defaults to the minimum legal bid", () => {
    render(<BidControls view={open} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect((screen.getByLabelText("Your bid") as HTMLInputElement).value).toBe("25");
  });

  it("tells you why you cannot bid instead of silently disabling", () => {
    const mine = { ...open, auction: { ...open.auction, lot: { ...open.auction.lot, highBidTeamId: "t1" } } };
    const { rerender } = render(<BidControls view={mine} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You already have the high bid.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bid" })).toBeDisabled();

    rerender(<BidControls view={{ ...open, maxBids: { t1: 10, t2: 97 } }} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You can't afford the current bid and still fill your roster.")).toBeInTheDocument();

    rerender(<BidControls view={AUCTION_VIEW} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("Nobody is up for bid right now.")).toBeInTheDocument();

    rerender(<BidControls view={open} myTeamId={null} submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You're watching this draft — you don't have a team in it.")).toBeInTheDocument();
  });
});
```

```tsx
// src/draft-room/components/auction-room.test.tsx
import { describe, it, expect } from "vitest";
import { screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { AUCTION_VIEW, fixtureDeps, renderInRoom } from "../test-fixtures";
import { DraftRoom } from "./draft-room";

const clockOf = (view: typeof AUCTION_VIEW, sequence: number) => ({
  phase: view.phase,
  sequence,
  pickNumber: view.pickNumber,
  onClockTeamId: null,
  deadlineAt: "2026-09-01T00:00:12.000Z",
  clockSeconds: 15,
  nextTightening: null,
});

function mountAuction(view = AUCTION_VIEW) {
  const fixture = fixtureDeps(view);
  const rendered = renderInRoom(
    <ToastProvider>
      <DraftRoom draftId="d1" />
    </ToastProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

describe("AuctionRoom", () => {
  it("renders the auction layout — lot, bid controls, budgets — axe-clean", async () => {
    const { rendered } = mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
    expect(screen.getByText("Bay Bandits is choosing who goes up next.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeInTheDocument();
    expect(await axe(rendered.container)).toHaveNoViolations();
  });

  it("shows every team's remaining budget and reserve-adjusted ceiling from the server", async () => {
    mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
    // Scope to the budgets table: team names also appear in the clock banner and roster cards.
    const table = screen.getByRole("table", { name: /budgets/i });
    const row = within(table).getByText("Bay Bandits").closest("tr")!;
    expect(row).toHaveTextContent("$100");
    expect(row).toHaveTextContent("$97");
  });

  it("follows a live bid war over the stream", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    act(() =>
      fixture.sources[0]!.emit("draft.nominate", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, 2),
        teamId: "t1",
        playerId: "qb1",
        openingBid: 5,
        auto: false,
      }),
    );
    await waitFor(() => expect(screen.getByText("$5")).toBeInTheDocument());

    act(() =>
      fixture.sources[0]!.emit("draft.bid", { draftId: "d1", clock: clockOf(AUCTION_VIEW, 3), teamId: "t2", playerId: "qb1", amount: 12 }),
    );
    await waitFor(() => expect(screen.getByText("$12")).toBeInTheDocument());
    expect(screen.getAllByText("Iron Owls").length).toBeGreaterThan(0);
  });

  it("resyncs the whole view when a bid arrives for a lot it never saw open — the missed bid war", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));
    const before = fixture.calls.filter((call) => call === "GET /api/drafts/d1").length;

    fixture.view = {
      ...AUCTION_VIEW,
      sequence: 7,
      onClockTeamId: null,
      auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 31, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
    };
    // Sequence 2 is the very next one, so this is NOT a gap — it resyncs purely because a bid
    // arrived for a lot this client never saw open, which is the missed-bid-war case.
    act(() =>
      fixture.sources[0]!.emit("draft.bid", { draftId: "d1", clock: clockOf(AUCTION_VIEW, 2), teamId: "t2", playerId: "qb1", amount: 31 }),
    );

    await waitFor(() => expect(screen.getByText("$31")).toBeInTheDocument());
    expect(fixture.calls.filter((call) => call === "GET /api/drafts/d1")).toHaveLength(before + 1);
  });

  it("resyncs budgets when the stream skips an award", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());

    fixture.view = { ...AUCTION_VIEW, sequence: 11, budgets: { t1: 63, t2: 100 }, maxBids: { t1: 61, t2: 97 } };
    act(() =>
      fixture.sources[0]!.emit("draft.pick", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, 11),
        pickNumber: 1,
        round: 1,
        teamId: "t1",
        playerId: "qb1",
        slot: "QB",
        slotIndex: 0,
        price: 37,
        timestamp: "2026-09-01T00:05:00.000Z",
        auto: false,
      }),
    );

    await waitFor(() => {
      const table = screen.getByRole("table", { name: /budgets/i });
      expect(within(table).getByText("Bay Bandits").closest("tr")).toHaveTextContent("$63");
    });
  });

  it("nominates through a modal so the opening bid is a deliberate choice", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole("button", { name: "Nominate" })[0]!);

    const dialog = screen.getByRole("dialog", { name: "Nominate Jalen Croft" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Opening bid"), { target: { value: "7" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Nominate for $7" }));
    });
    expect(fixture.calls).toContain("POST /api/drafts/d1/actions");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/draft-room/components`
Expected: FAIL — the auction modules do not exist.

- [ ] **Step 4: Implement the auction components**

```tsx
// src/draft-room/components/auction-lot.tsx
"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Card } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { formatCountdown } from "../state/format";
import { useNow } from "../hooks/use-now";

export interface AuctionLotPanelProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
}

/** The lot everyone is watching: who is up, the standing bid, who holds it, and how long is left. */
export function AuctionLotPanel({ view, teams, playersById }: AuctionLotPanelProps) {
  const now = useNow(DRAFT_ROOM_CONFIG.countdownTickMs);
  const nameOf = (teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? "Someone";
  const lot = view.auction?.lot ?? null;

  if (lot === null) {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">{nameOf(view.auction?.nominatingTeamId ?? null)} is choosing who goes up next.</p>
      </Card>
    );
  }

  const remainingMs = view.deadlineAt === null ? null : Date.parse(view.deadlineAt) - now;
  const player = playersById.get(lot.playerId);

  return (
    <Card as="section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-xl font-semibold text-text-primary">{player?.name ?? lot.playerId}</span>
        {player === undefined ? null : <Badge tone="neutral">{player.position}</Badge>}
        {lot.autoNominated ? <Badge tone="warning">Auto-nominated</Badge> : null}
        {remainingMs === null ? null : (
          <span data-testid="lot-countdown" aria-hidden="true" className="ml-auto text-2xl font-semibold tabular-nums text-text-primary">
            {formatCountdown(remainingMs)}
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-baseline gap-2 text-md text-text-primary">
        <span className="text-2xl font-semibold">${lot.highBid}</span>
        <span className="text-text-muted">high bid —</span>
        <span className="font-medium">{nameOf(lot.highBidTeamId)}</span>
      </p>
      <p className="text-sm text-text-muted">
        {player?.name ?? lot.playerId} is up for bid at ${lot.highBid}, held by {nameOf(lot.highBidTeamId)}.
      </p>
    </Card>
  );
}
```

```tsx
// src/draft-room/components/bid-controls.tsx
"use client";

import { useEffect, useState } from "react";
import type { DraftStateView } from "@/draft-engine";
import { Button, Input } from "@/components/ui";

export interface BidControlsProps {
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly submitting: boolean;
  readonly onBid: (amount: number) => void;
}

/**
 * Every number here is the server's: `view.minBid` is the floor the engine computed and
 * `view.maxBids[myTeamId]` is this team's reserve-adjusted ceiling. The reserve formula does
 * not exist in this file, or anywhere else in React.
 */
export function BidControls({ view, myTeamId, submitting, onBid }: BidControlsProps) {
  const lot = view.auction?.lot ?? null;
  const minBid = view.minBid;
  const maxBid = myTeamId === null ? null : (view.maxBids[myTeamId] ?? null);
  const [amount, setAmount] = useState(minBid ?? 0);

  useEffect(() => {
    if (minBid !== null) setAmount(minBid);
  }, [minBid]);

  const blocked =
    myTeamId === null
      ? "You're watching this draft — you don't have a team in it."
      : lot === null || minBid === null
        ? "Nobody is up for bid right now."
        : lot.highBidTeamId === myTeamId
          ? "You already have the high bid."
          : maxBid === null || maxBid < minBid
            ? "You can't afford the current bid and still fill your roster."
            : null;

  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Your bid"
        type="number"
        inputMode="numeric"
        value={amount}
        min={minBid ?? undefined}
        max={maxBid ?? undefined}
        disabled={blocked !== null}
        hint={blocked ?? `Between $${minBid} and $${maxBid}.`}
        onChange={(event) => setAmount(Number(event.target.value))}
      />
      <Button disabled={blocked !== null} loading={submitting} onClick={() => onBid(amount)}>
        Bid
      </Button>
    </div>
  );
}
```

```tsx
// src/draft-room/components/nominate-modal.tsx
"use client";

import { useEffect, useState } from "react";
import type { DraftStateView } from "@/draft-engine";
import { Button, Input, Modal } from "@/components/ui";

export interface NominateModalProps {
  readonly open: boolean;
  readonly playerId: string | null;
  readonly playerName: string;
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly onClose: () => void;
  readonly onNominate: (playerId: string, openingBid: number) => void;
}

/** Nominating commits money, so it gets a deliberate confirm step rather than a single click. */
export function NominateModal({ open, playerId, playerName, view, myTeamId, onClose, onNominate }: NominateModalProps) {
  const minBid = view.minBid ?? 1;
  const maxBid = myTeamId === null ? null : (view.maxBids[myTeamId] ?? null);
  const [openingBid, setOpeningBid] = useState(minBid);

  useEffect(() => {
    setOpeningBid(minBid);
  }, [minBid, playerId]);

  return (
    <Modal
      open={open}
      title={`Nominate ${playerName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={playerId === null}
            onClick={() => {
              if (playerId !== null) onNominate(playerId, openingBid);
            }}
          >
            {`Nominate for $${openingBid}`}
          </Button>
        </>
      }
    >
      <Input
        label="Opening bid"
        type="number"
        inputMode="numeric"
        value={openingBid}
        min={minBid}
        max={maxBid ?? undefined}
        hint={maxBid === null ? `At least $${minBid}.` : `Between $${minBid} and $${maxBid}.`}
        onChange={(event) => setOpeningBid(Number(event.target.value))}
      />
    </Modal>
  );
}
```

```tsx
// src/draft-room/components/budget-table.tsx
"use client";

import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@/components/ui";
import { rosterSpots } from "../state/format";

export interface BudgetTableProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
}

interface BudgetRow {
  readonly team: TeamCard;
  readonly budget: number;
  readonly maxBid: number;
  readonly spotsLeft: number;
}

/** Remaining money and each team's ceiling — both read straight off the view, never computed. */
export function BudgetTable({ view, teams, myTeamId }: BudgetTableProps) {
  const spots = rosterSpots(view.slotConfig);
  const rows: readonly BudgetRow[] = view.draftOrder.flatMap((teamId) => {
    const team = teams.find((candidate) => candidate.id === teamId);
    if (team === undefined) return [];
    return [{ team, budget: view.budgets[teamId] ?? 0, maxBid: view.maxBids[teamId] ?? 0, spotsLeft: spots - (view.rosters[teamId]?.length ?? 0) }];
  });

  const columns: readonly TableColumn<BudgetRow>[] = [
    {
      key: "team",
      header: "Team",
      // The name is its own element so a test (and a screen reader) can address it without
      // the badge's text being concatenated onto it.
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span>{row.team.name}</span>
          {row.team.id === myTeamId ? <Badge tone="accent">You</Badge> : null}
        </span>
      ),
    },
    { key: "budget", header: "Budget", cell: (row) => `$${row.budget}`, numeric: true },
    { key: "max", header: "Max bid", cell: (row) => `$${row.maxBid}`, numeric: true },
    { key: "spots", header: "Spots left", cell: (row) => row.spotsLeft, numeric: true, hideOnNarrow: true },
  ];

  return (
    <Table
      caption="Team budgets"
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(row) => row.team.id}
      empty={<EmptyState title="No teams yet" description="Budgets appear once the draft starts." action={<Button disabled>Waiting for the draft to start</Button>} />}
    />
  );
}
```

```tsx
// src/draft-room/components/auction-room.tsx
"use client";

import { useState } from "react";
import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { ClockBanner } from "./clock-banner";
import { AuctionLotPanel } from "./auction-lot";
import { BidControls } from "./bid-controls";
import { NominateModal } from "./nominate-modal";
import { BudgetTable } from "./budget-table";
import { PlayerPool } from "./player-pool";
import { RosterBoard } from "./roster-board";
import { PickHistory } from "./pick-history";

export interface AuctionRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
}

export function AuctionRoom({ room, playersById, onAct }: AuctionRoomProps) {
  const view = room.view!;
  const [nominating, setNominating] = useState<string | null>(null);
  // Affordance only. `onClockTeamId` is the engine's nominator, and it is null while a lot is live.
  const canNominate = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;

  return (
    <div className="flex flex-col gap-4">
      <ClockBanner view={view} teams={room.teams} myTeamId={room.myTeamId} />
      <AuctionLotPanel view={view} teams={room.teams} playersById={playersById} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <BidControls view={view} myTeamId={room.myTeamId} submitting={room.submitting} onBid={(amount) => onAct({ type: "BID", amount })} />
          <PlayerPool
            players={room.players}
            view={view}
            pendingPlayerId={room.pendingPlayerId}
            canAct={canNominate}
            actionLabel="Nominate"
            submitting={room.submitting}
            onAct={setNominating}
          />
        </div>
        <div className="flex flex-col gap-4">
          <BudgetTable view={view} teams={room.teams} myTeamId={room.myTeamId} />
          <RosterBoard view={view} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} />
          <PickHistory view={view} teams={room.teams} playersById={playersById} />
        </div>
      </div>
      <NominateModal
        open={nominating !== null}
        playerId={nominating}
        playerName={nominating === null ? "" : (playersById.get(nominating)?.name ?? nominating)}
        view={view}
        myTeamId={room.myTeamId}
        onClose={() => setNominating(null)}
        onNominate={(playerId, openingBid) => {
          setNominating(null);
          onAct({ type: "NOMINATE", playerId, openingBid });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Switch the room on format**

```tsx
// src/draft-room/components/draft-room.tsx — replace the final return block
  return (
    <div className="flex flex-col gap-3">
      <ConnectionBanner connection={room.connection} />
      {room.view.format === "auction" ? (
        <AuctionRoom room={room} playersById={playersById} onAct={act} />
      ) : (
        <SnakeRoom room={room} playersById={playersById} onAct={act} />
      )}
    </div>
  );
```

(with `import { AuctionRoom } from "./auction-room";` added.)

- [ ] **Step 6: Run the tests and the checks**

Run: `npm test -- src/draft-room`
Expected: PASS, including the two resync cases.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/draft-room
git commit -m "feat(draft-room): auction room — live lot, bidding, budgets, and resync hardening

A bid against a lot we never saw open, or any sequence gap, refetches the whole view — which
restores the lot and every budget in one shot. Bid floors and ceilings are the server's."
```

---
### Task 8: The pick-landing moment

**Model tier:** cheap/standard.

**Why:** the UX review's finding I8 — "zero moments of delight, celebration, or motion design" — against a strategy doc (§4) whose entire thesis is that this category feels flat. A pick landing is the moment the draft is *for*; the acting user's own pick gets a distinctly warmer treatment than everyone else's.

**Files:**
- Create: `src/draft-room/components/pick-celebration.tsx`
- Modify: `src/app/globals.css`, `src/draft-room/components/snake-room.tsx`, `src/draft-room/components/auction-room.tsx`
- Test: `src/draft-room/components/pick-celebration.test.tsx`

**Interfaces:**
- Consumes: `usePrefersReducedMotion` (`@/design/use-reduced-motion`), `DRAFT_ROOM_CONFIG.celebrationMs`, `LandedPick` (`../hooks/use-draft-room`).
- Produces: `PickCelebration({ lastPick, playersById, teams })`.

**Design notes the implementer must preserve:**
- The animation is keyed on `pick.pickNumber`, not on a timestamp — nothing here reads a clock beyond the auto-dismiss timer, and the same pick never re-animates.
- Reduced motion is a **real branch**, not a faster animation: the panel still appears (the user must not lose the information), it simply carries no animation class. `globals.css`'s global reduced-motion block is the safety net underneath; this is the deliberate layer above it, per `docs/design-system.md`.
- The panel is `role="status"` so the pick is announced once, politely — a draft room is noisy and an assertive alert per pick would be hostile.

- [ ] **Step 1: Write the failing test**

```tsx
// src/draft-room/components/pick-celebration.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { inBothThemes } from "@/components/ui/test-utils";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { PLAYERS, TEAMS, playersById } from "../test-fixtures";
import { PickCelebration } from "./pick-celebration";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const pick = { pickNumber: 4, round: 2, teamId: "t2", playerId: "rb1", slot: "RB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PickCelebration", () => {
  it("renders nothing before any pick has landed", () => {
    stubMatchMedia(false);
    const { container } = render(<PickCelebration lastPick={null} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces someone else's pick politely, in both themes, axe-clean", async () => {
    stubMatchMedia(false);
    await inBothThemes(<PickCelebration lastPick={{ pick, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />, async ({ container }) => {
      expect(screen.getByRole("status")).toHaveTextContent("Iron Owls drafted Marcus Reed.");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives your own pick a distinct treatment and copy", () => {
    stubMatchMedia(false);
    render(<PickCelebration lastPick={{ pick, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel).toHaveTextContent("You drafted Marcus Reed!");
    expect(panel).toHaveAttribute("data-own", "true");
    expect(panel.className).toMatch(/animate-pick-mine/);
  });

  it("animates another team's pick differently from your own", () => {
    stubMatchMedia(false);
    render(<PickCelebration lastPick={{ pick, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel.className).toMatch(/animate-pick-landed/);
    expect(panel.className).not.toMatch(/animate-pick-mine/);
  });

  it("drops every animation class when the user prefers reduced motion — but still shows the pick", () => {
    stubMatchMedia(true);
    render(<PickCelebration lastPick={{ pick, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel.className).not.toMatch(/animate-pick/);
    expect(panel).toHaveTextContent("You drafted Marcus Reed!");
  });

  it("shows the winning price for an auction pick and fades out on its own", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    render(<PickCelebration lastPick={{ pick: { ...pick, price: 42 }, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByText("Won for $42.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(DRAFT_ROOM_CONFIG.celebrationMs));
    expect(screen.queryByTestId("pick-celebration")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm test -- src/draft-room/components/pick-celebration`
Expected: FAIL — cannot find module `./pick-celebration`.

```tsx
// src/draft-room/components/pick-celebration.tsx
"use client";

import { useEffect, useState } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import type { LandedPick } from "../hooks/use-draft-room";

export interface PickCelebrationProps {
  readonly lastPick: LandedPick | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly teams: readonly TeamCard[];
}

/**
 * The moment a pick lands. Keyed on `pickNumber`, so the same pick never re-animates and no
 * clock is consulted. Reduced motion is a real branch — the panel still appears, it just
 * carries no animation class, because losing the information would be worse than the motion.
 */
export function PickCelebration({ lastPick, playersById, teams }: PickCelebrationProps) {
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const pickNumber = lastPick?.pick.pickNumber ?? null;

  useEffect(() => {
    if (pickNumber === null) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), DRAFT_ROOM_CONFIG.celebrationMs);
    return () => clearTimeout(timer);
  }, [pickNumber]);

  if (lastPick === null || !visible) return null;

  const { pick, isMine } = lastPick;
  const playerName = playersById.get(pick.playerId)?.name ?? pick.playerId;
  const teamName = teams.find((team) => team.id === pick.teamId)?.name ?? pick.teamId;
  const motion = reduced ? "" : isMine ? "animate-pick-mine" : "animate-pick-landed";

  return (
    <div
      role="status"
      data-testid="pick-celebration"
      data-own={isMine ? "true" : "false"}
      className={`rounded-lg border p-3 text-center ${isMine ? "border-accent bg-accent/10" : "border-border bg-surface-elevated"} ${motion}`}
    >
      <p className="text-lg font-semibold text-text-primary">
        {isMine ? `You drafted ${playerName}!` : `${teamName} drafted ${playerName}.`}
      </p>
      {pick.price === null ? null : <p className="text-sm text-text-muted">Won for ${pick.price}.</p>}
    </div>
  );
}
```

```css
/* src/app/globals.css — append, above the existing prefers-reduced-motion block */

/* The pick-landing moment. Durations and easings come from the generated token variables,
   never from a literal — see docs/design-system.md. The reduced-motion block below is the
   safety net; PickCelebration also drops these classes outright when the user asks for
   less motion, so nothing merely runs faster. */
@keyframes commish-pick-landed {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes commish-pick-mine {
  0% { opacity: 0; transform: scale(0.96); }
  60% { opacity: 1; transform: scale(1.03); }
  100% { opacity: 1; transform: scale(1); }
}

.animate-pick-landed {
  animation: commish-pick-landed var(--commish-motion-duration-base) var(--commish-motion-easing-standard) both;
}

.animate-pick-mine {
  animation: commish-pick-mine var(--commish-motion-duration-slow) var(--commish-motion-easing-emphasized) both;
}
```

- [ ] **Step 3: Wire it into both rooms**

In `snake-room.tsx` and `auction-room.tsx`, render it immediately below `<ClockBanner …/>`:

```tsx
<PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />
```

(with `import { PickCelebration } from "./pick-celebration";` in each.)

- [ ] **Step 4: Run and commit**

Run: `npm test -- src/draft-room && npm run typecheck && npm run lint`
Expected: PASS, no errors.

```bash
git add src/draft-room src/app/globals.css
git commit -m "feat(draft-room): pick-landing moment with a distinct own-pick treatment

Reduced motion is a real branch, not a faster animation: the panel still appears with no
animation class at all, so the information survives the preference."
```

---

### Task 9: The read-only TV draftboard at `/draft/[draftId]/board`

**Model tier:** cheap/standard.

**Why:** "draft-party TV casting" is named twice in the strategy doc and was never scheduled (UX review I4). It is a URL you open on a laptop plugged into a TV — no native casting support required today.

**Files:**
- Create: `src/draft-room/components/tv-board.tsx`, `src/app/draft/[draftId]/board/page.tsx`
- Test: `src/draft-room/components/tv-board.test.tsx`

**Interfaces:**
- Consumes: `useDraftRoom`, `ClockBanner`, `PickCelebration`, `Table`, `Card`, `Avatar`, `Badge`, `Skeleton`, `ErrorState`, `Button`, `requireCurrentUser`.
- Produces: `TvBoard({ draftId })`; route `/draft/[draftId]/board`.

**Design notes the implementer must preserve:**
- **Still authenticated, still authorized.** The page calls `requireCurrentUser()`, and the API it reads enforces league membership exactly as it does for the room — a public board would leak a league's roster construction to anyone with the URL. It is *read-only*, not *public*.
- **No controls at all.** No buttons, no inputs, no toasts. The only interactive element on an error is the retry, because a dead end is never acceptable.
- Ten-foot legibility: oversized type, high contrast, a full pick grid, and a spotlight on the pick currently being made. Still renders at 360px (a phone propped on a table is a real use).
- It uses the same `useDraftRoom` hook, so it inherits SSE, gap-refetch and reconnect for free. There is no second data path.

- [ ] **Step 1: Write the failing test**

```tsx
// src/draft-room/components/tv-board.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { fixtureDeps, renderInRoom, SNAKE_VIEW } from "../test-fixtures";
import { TvBoard } from "./tv-board";

/** `PickCelebration` calls `usePrefersReducedMotion`, which reads `matchMedia`; happy-dom's is minimal. */
function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TvBoard", () => {
  it("shows the board with no controls at all, axe-clean", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    const { container } = renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getAllByText("Bay Bandits").length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("spotlights whoever is on the clock", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByTestId("spotlight")).toHaveTextContent("Bay Bandits"));
  });

  it("updates live from the stream without any control being touched", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    act(() =>
      fixture.sources[0]!.emit("draft.pick", {
        draftId: "d1",
        clock: { phase: "in_progress", sequence: 2, pickNumber: 2, onClockTeamId: "t2", deadlineAt: SNAKE_VIEW.deadlineAt, clockSeconds: 28_800, nextTightening: null },
        pickNumber: 1,
        round: 1,
        teamId: "t1",
        playerId: "qb1",
        slot: "QB",
        slotIndex: 0,
        price: null,
        timestamp: "2026-09-01T00:05:00.000Z",
        auto: false,
      }),
    );

    await waitFor(() => expect(screen.getByTestId("spotlight")).toHaveTextContent("Iron Owls"));
    expect(screen.getByRole("table", { name: /every pick/i })).toHaveTextContent("Jalen Croft");
  });

  it("still offers a way forward if the board cannot load", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft doesn't exist." }) }) as unknown as Response };
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft doesn't exist."));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm test -- src/draft-room/components/tv-board`
Expected: FAIL — cannot find module `./tv-board`.

```tsx
// src/draft-room/components/tv-board.tsx
"use client";

import { useMemo } from "react";
import type { CompletedPick } from "@/draft-engine";
import { Avatar, Badge, Button, EmptyState, ErrorState, Skeleton, Table, type TableColumn } from "@/components/ui";
import { useDraftRoom } from "../hooks/use-draft-room";
import { ClockBanner } from "./clock-banner";
import { PickCelebration } from "./pick-celebration";

/**
 * The draft-party board: one URL you open on the laptop plugged into the TV. Read-only by
 * construction — it renders no control of any kind — but still authenticated and still
 * league-authorized by the API behind it. It shares `useDraftRoom` with the real room, so it
 * inherits SSE, gap-refetch and reconnect rather than growing a second data path.
 */
export function TvBoard({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const playersById = useMemo(() => new Map(room.players.map((player) => [player.id, player])), [room.players]);

  if (room.status === "loading") return <Skeleton lines={8} />;
  if (room.status === "error" || room.view === null) {
    return (
      <ErrorState
        title="We couldn't open this board"
        description={room.error ?? "Something went wrong on our side."}
        action={<Button onClick={() => void room.refresh()}>Try again</Button>}
      />
    );
  }

  const view = room.view;
  const onClock = room.teams.find((team) => team.id === view.onClockTeamId) ?? null;

  const columns: readonly TableColumn<CompletedPick>[] = [
    { key: "pick", header: "#", cell: (pick) => pick.pickNumber, numeric: true },
    { key: "round", header: "Rd", cell: (pick) => pick.round, numeric: true, hideOnNarrow: true },
    { key: "team", header: "Team", cell: (pick) => room.teams.find((team) => team.id === pick.teamId)?.name ?? pick.teamId },
    { key: "player", header: "Player", cell: (pick) => playersById.get(pick.playerId)?.name ?? pick.playerId },
    { key: "price", header: "Price", cell: (pick) => (pick.price === null ? "—" : `$${pick.price}`), numeric: true },
  ];

  return (
    <div className="flex flex-col gap-6 text-lg">
      <ClockBanner view={view} teams={room.teams} myTeamId={room.myTeamId} />
      <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />

      {/* A plain <section>, not <Card>: `data-*` attributes are not part of `CardProps`, and
          the spotlight needs a stable test hook. */}
      <section data-testid="spotlight" className="flex items-center gap-4 rounded-lg border border-border bg-surface-elevated p-6">
        {onClock === null ? null : <Avatar name={onClock.ownerDisplayName} src={onClock.ownerAvatarUrl} size="lg" />}
        <div>
          <p className="text-sm uppercase tracking-wide text-text-muted">On the clock</p>
          <p className="text-3xl font-semibold text-text-primary">{onClock?.name ?? "Nobody"}</p>
          {onClock === null ? null : <Badge tone="neutral">{onClock.ownerDisplayName}</Badge>}
        </div>
      </section>

      <Table
        caption="Every pick so far"
        captionVisible
        columns={columns}
        rows={[...view.picks].reverse()}
        rowKey={(pick) => String(pick.pickNumber)}
        empty={<EmptyState title="The board is empty" description="Picks appear here the moment they land." action={<span className="text-text-muted">Waiting for the first pick</span>} />}
      />
    </div>
  );
}
```

> The empty state's "action" is a plain `<span>`, not a button: this surface has no controls, and putting one here would break its whole contract. `EmptyState.action` is `ReactNode`, so this is a legal, deliberate use — noted here so a reviewer does not read it as an oversight.

```tsx
// src/app/draft/[draftId]/board/page.tsx
import { requireCurrentUser } from "@/lib/auth/current-user";
import { TvBoard } from "@/draft-room/components/tv-board";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * The TV board. Read-only, but NOT public: `requireCurrentUser()` here and league membership
 * in the API behind it. A public board would hand a league's roster construction to anyone
 * who guessed the URL.
 *
 * Note this route lives at `/draft/...`, not `/app/draft/...`, so `src/middleware.ts` does not
 * redirect it — an unauthenticated viewer gets `requireCurrentUser()`'s thrown error page
 * rather than a silent hop to hosted sign-in. That is the same behavior every other non-`/app`
 * page has; if a redirect is wanted later, the prefix in `src/middleware.ts` is the one knob.
 */
export default async function DraftBoardPage({ params }: PageProps) {
  await requireCurrentUser();
  const { draftId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <TvBoard draftId={draftId} />
    </main>
  );
}
```

- [ ] **Step 3: Run and commit**

Run: `npm test -- src/draft-room && npm run typecheck && npm run lint`
Expected: PASS, no errors.

```bash
git add src/draft-room "src/app/draft"
git commit -m "feat(draft-room): read-only large-format TV draftboard at /draft/[draftId]/board"
```

---
### Task 10: Documentation, the e2e follow-up note, and final verification

**Model tier:** cheap/standard.

**Files:**
- Create: `docs/draft-room.md`
- Modify: `docs/conventions.md`
- Test: none new — this task runs every existing check.

**Interfaces:**
- Consumes: everything Tasks 1–9 produced.
- Produces: the room's written contract, and a recorded, unblocking follow-up for the browser e2e.

- [ ] **Step 1: Write `docs/draft-room.md`**

```markdown
# Commish — The Draft Room (client)

Read this with `docs/conventions.md`, `docs/design-system.md` and `docs/draft-engine.md`
before touching anything under `src/draft-room/` or the draft pages. The engine is pure, the
service owns persistence and publishing — and this layer owns **nothing but rendering and
synchronization**.

## The one rule

**No draft rule is implemented in React.** Turn order, eligibility, slot assignment, budget
and reserve math, clock tiers and deadlines all belong to `src/draft-engine/`. If a component
needs one of those values, the engine computes it and the server sends it. This is enforced
structurally: everything under `src/draft-room/**` and `src/app/app/drafts/**` imports from
`@/draft-engine` with `import type` only, so no engine function can be called from a browser
bundle at all.

The one place this rule was tested and held: `rosterSpots()` in `state/format.ts` sums the
league's declared slot counts. It is config arithmetic, not a draft rule, and its test asserts
it agrees with the engine's `totalRosterSlots` so the two cannot diverge.

## Layers

| Path | Rule |
|---|---|
| `src/draft-room/state/` | Pure. No React, no I/O, no clock. **100% coverage enforced** (`vitest.config.mts`). |
| `src/draft-room/hooks/` | React state + effects. Every external dependency (`fetch`, `EventSource`) is injected through `DraftRoomDepsProvider`, so tests use doubles rather than module mocks. |
| `src/draft-room/components/` | Presentational. They receive a `DraftStateView` and callbacks; none of them fetch. |
| `src/app/app/drafts/[draftId]/` | Authed server shell for the live room. |
| `src/app/draft/[draftId]/board/` | Authed server shell for the read-only TV board. |

## The synchronization contract

1. **Mount** → `GET /api/drafts/[draftId]` and `GET /api/drafts/[draftId]/players` in parallel.
   The state route returns the `DraftStateView`, the caller's own `teamId`, whether they are
   the commissioner, and the league's team cards. The players route returns ranked player
   metadata, and is separate precisely because the state route is refetched often and the
   player dictionary never changes during a draft.
2. **Subscribe** → a native `EventSource` on `/api/leagues/<leagueId>/events`.
   **The browser owns reconnect and `Last-Event-ID`.** There is no retry loop, no backoff
   timer and no polling anywhere in this codebase; adding one would be a bug, not a feature.
3. **Apply** → `applyDraftEvent(view, data)` validates the frame with Zod, then compares
   `payload.clock.sequence` with `view.sequence`:
   - `< view.sequence` → ignore (already applied)
   - `=== view.sequence` → apply (a sibling of the transition just applied: `draft.timer_expire`,
     its `draft.pick`, and a trailing `draft.status` all share one sequence number)
   - `=== view.sequence + 1` → apply (a new transition)
   - `> view.sequence + 1` → **resync**
   Every apply is idempotent by content, so a redelivered sibling can never duplicate a pick.
4. **Resync** → refetch the whole view. Triggered by a sequence gap, by a `draft.bid` against a
   lot we never saw open, by a `draft.nominate` on a non-auction view, and by any `EventSource`
   `open` that follows an `error`. This is the fallback `docs/conventions.md` names for a gap
   that outlasted the stream's retention window, and it is what makes a missed auction bid war
   and a budget desync self-healing.
5. **Submit** → `optimisticView()` patches the view for instant feedback, the POST goes out,
   and the response replaces the view — unless SSE already carried us further, in which case
   the newer view wins. A 409 rolls the patch back and shows the reducer's own plain-language
   reason in a toast.

### What "optimistic" deliberately does not do

`optimisticView` never guesses a roster slot, a round, a price, a budget or a turn change,
because each is a draft rule. It removes the player from the pool, marks them **pending**, and
(for an auction) shows the bid you just made as the high bid. Everything else waits the one
round trip it takes for the truth to arrive.

## Wall clock

`useNow(intervalMs)` is the **only** place browser code reads `Date.now()`, and it exists
purely so countdowns tick. A countdown never decides anything: clock expiry is the server
ticker's job, and `TIMER_EXPIRE` has no HTTP path a client could use.

## Accessibility notes specific to this room

- Countdowns are `aria-hidden`. A number changing every second inside a live region is
  unusable with a screen reader; each countdown is paired with a static sentence that says the
  same thing.
- The pick-landing panel is `role="status"` — announced once, politely.
- Toasts carry the failure channel: `tone: "error"` also sets `role="alert"`, because a user
  on a clock cannot wait behind a polite announcement queue.
- The TV board renders **no controls at all** except the retry on its error state.

## Follow-up: browser e2e (`e2e/draft-room.spec.ts`) — NOT part of this plan

Everything above is covered by unit and component tests with injected `fetch`/`EventSource`
doubles. A real end-to-end pass — a browser, the real SSE route, the real Redis stream — is
still worth having, and is deliberately deferred:

- **Playwright is not a dependency of this repo** (`package.json` has no `@playwright/test`,
  and there is no `e2e/` directory or `npm run e2e` script). Adding a browser runner is its
  own change with its own CI cost.
- **It needs WorkOS credentials.** Sign-in is hosted by WorkOS AuthKit; there is no local
  password path to script, so the test needs a real test-tenant user plus
  `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` / `WORKOS_COOKIE_PASSWORD` / `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
  in the environment. Those secrets are not available at plan time.
- **The seam is already prepared.** `npm run seed` with `DEV_SEED_CLAIM_USER_ID=<your WorkOS
  user id>` hands that user team 1 and the commissioner's chair in both
  `dev_league_snake` and `dev_league_auction` (see `src/data/seed/config.ts`), so the e2e has
  a real league to drive as soon as credentials exist.

**When it is written, it should cover:** sign in → open `/app/drafts/dev_draft_snake` →
commissioner starts the draft → make a pick → assert a second browser context sees it →
kill the SSE connection and assert the board resyncs → open `/draft/dev_draft_snake/board`
and assert it shows the same picks with no controls.
```

- [ ] **Step 2: Update `docs/conventions.md`**

In the **Directory map** block, add these lines under `src/`:

```
  draft-room/             The browser half of the draft: pure view reducer (state/, 100% coverage),
                          the useDraftRoom hook (hooks/), and every room component (components/).
                          Imports from draft-engine are TYPE-ONLY — no draft rule runs in React.
                          See docs/draft-room.md.
```

and under the `app/` line, add:

```
  app/app/drafts/[draftId]/       The live draft room (snake + auction).
  app/draft/[draftId]/board/      The read-only large-format TV draftboard.
```

Then add one bullet to the **Real-time — one mechanism** rule:

```markdown
- **On the browser side there is exactly one consumer:** `useDraftRoom` (`src/draft-room/hooks/`),
  built on a native `EventSource`. The browser's own reconnect and `Last-Event-ID` are the whole
  reconnect mechanism — **no retry loop, no backoff timer, no polling.** A full refetch of
  `GET /api/drafts/[draftId]` is the documented fallback, and fires on a sequence gap or a
  reconnect. See `docs/draft-room.md`.
```

- [ ] **Step 3: Full verification — every check, unfiltered**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no errors, no warnings.

Run: `npm run infra:up && npm run db:migrate:test`
Expected: containers healthy, migrations applied to the test database (the `src/draft-service` suites need real Postgres and Redis).

Run: `npm test`
Expected: every suite passes.

Run: `npm run test:coverage`
Expected: PASS with **`src/scoring/**`, `src/draft-engine/**` and `src/draft-room/state/**` all at 100%** branches/functions/lines/statements. This must be the **unfiltered** run — a path-filtered coverage run reports the other gated directories at 0% and the gate becomes meaningless.

Run: `npm run build`
Expected: a successful production build. Watch for two things specifically: no `"use client"` module reaching for a server-only import, and no accidental **value** import from `@/draft-engine` in a client component (which would pull the engine into the browser bundle and violate the plan's central constraint — if the build shows one, convert it to `import type` or move the value to the server).

- [ ] **Step 4: Manual design review (recorded in the task report)**

At 360px and at a desktop width, in **both themes**, walk `/app/drafts/dev_draft_snake`,
`/app/drafts/dev_draft_auction` and `/draft/dev_draft_snake/board` and confirm:
loading → ready → error states all reachable and all offering a next action; keyboard-only
operation of search, filter, draft, bid and nominate; no horizontal page scroll; the countdown
and the "picks shorten to …" line both update; a pick landing animates, and stops animating
with the OS "reduce motion" setting on.

- [ ] **Step 5: Commit**

```bash
git add docs/draft-room.md docs/conventions.md
git commit -m "docs: the draft room's client contract, plus the deferred browser e2e note

Records the fetch → SSE → apply → gap → refetch loop, the optimistic-submit rules, and why
the Playwright pass is a follow-up (no Playwright dependency, no WorkOS test credentials)."
```

---
## Self-Review

**1. Spec coverage — Step 4's UI bullets (every one, mapped to a task):**

| Spec bullet | Task |
|---|---|
| Snake draft board: player pool, **searchable/filterable** | 6 (`PlayerPool`: name search + position `Select`, server-ranked order) |
| Team rosters **filling in live** | 6 (`RosterBoard`, driven by `view.rosters` + `view.slotConfig`) + 5 (`applyDraftEvent` appends the slot the engine assigned) |
| Pick clock countdown | 6 (`ClockBanner` + `useNow` + `formatCountdown`) |
| **The current auto-tightening tier and when it next shortens** ("picks shorten to 10 minutes in 2h 14m") | 6 (`formatTightening` over `view.nextTightening`) |
| Built from `docs/design-system.md`'s primitives, with loading/empty/error states, not just the happy path | 1–3 (the five missing primitives), 6 (`Skeleton` / `ErrorState` / `EmptyState` on every surface) |
| **Draft-pick landing moment**, distinct treatment for the acting user's own pick, `prefers-reduced-motion` respected | 8 |
| **Read-only large-format draftboard at `/draft/<id>/board`** for TV casting | 9 |
| Disconnect/reconnect: native `EventSource` + automatic `Last-Event-ID`, full-state refetch only as the fallback | 5 (no retry loop anywhere; refetch on gap or on `open`-after-`error`) |
| **Optimistic acting client** — render the action immediately, reconcile against the server | 5 (`optimisticView` + `submit`'s settle/rollback) |
| Verification `npm test -- src/draft-room` | Every task from 5 onward; Task 10 runs the full suite |

**Step 5's UI bullets:**

| Spec bullet | Task |
|---|---|
| Auction UI: **current nomination** | 7 (`AuctionLotPanel`, `NominateModal`) |
| **Live bid amount and bidder** | 7 (`AuctionLotPanel`) |
| **Time remaining on the current bid** | 7 (the bid-window countdown, from `view.deadlineAt`, which the engine already clamps to `AUCTION_CONFIG.bidWindowSeconds`) |
| **Remaining budget per team** | 7 (`BudgetTable`, from `view.budgets` / `view.maxBids`) |
| **A dropped connection must not let a user miss a bid war** | 5 (a `draft.bid` against a lot we never saw open ⇒ `resync`) + 7 (the test that proves it) |
| **…and must not desync remaining-budget state** | 4 (`budgets`/`maxBids` on the award event) + 5 (any gap ⇒ full refetch) + 7 (the budget-resync test) |

**Step 1's design-system bullet:** `Select` (1), `Avatar` (1), `Modal` (2), `Toast` (2), `Table` (3) — the five verified absent from `src/components/ui/index.ts`. Documented in `docs/design-system.md` by Task 3.

**Deliberate exclusions (with reasons):**
- **A browser end-to-end test (`e2e/draft-room.spec.ts`).** Playwright is not a dependency of this repo and there is no `e2e/` directory or script; sign-in is hosted by WorkOS AuthKit, so the test needs real test-tenant credentials that do not exist at plan time. Recorded as a specific, scoped follow-up in `docs/draft-room.md` (Task 10) — with the exact scenario to cover and the `DEV_SEED_CLAIM_USER_ID` seam already in place — and deliberately **not** made a blocking task. Everything it would cover in-process is covered by Tasks 5–9 with injected `fetch`/`EventSource` doubles, and Plan B's `draft-realtime.test.ts` already proves the real Redis→SSE path server-side.
- **A commissioner "start draft" control in the room.** `POST /api/drafts/[draftId]/start` exists (Plan B) and `isCommissioner` is already in the view, but starting a draft is a league-management surface, not a draft-room one, and it belongs with the league screens (spec Step 7). The room states plainly that the commissioner starts it.
- **Draft chat, GIFs and reactions.** `chat.*` rides the same stream and `applyDraftEvent` ignores those frames by design — the social layer is spec Step 8.
- **The AI draft moderator / copilot panel.** Spec Step 6, a separate plan. Nothing here forecloses it: it is another consumer of the same view.
- **Commissioner pick-undo, per-league clock editing, dynasty formats.** Not in Steps 4 or 5; each is an engine change first.
- **Virtualized scrolling for the player pool.** `DRAFT_ROOM_CONFIG.poolPageSize` caps the rendered rows at 60 and the search narrows from there. Virtualization is a real answer to a problem this product does not have yet with a few hundred players, and it would cost accessibility.
- **`next/image` for avatars.** Avatar URLs are arbitrary remote hosts; `next/image` needs a per-host allowlist that Phase 1 has no basis to write. A plain `<img>` with an explicit lint exemption is the honest choice.

**2. Placeholder scan:** no "TBD", "TODO", "implement later", "similar to Task N", or "add error handling" survives. Three placeholders found on review and fixed inline: the `rankedPlayers` body (was a `/* … */` comment, now the real code), the auction-money event test (was a prose comment with undefined variables, now two self-contained cases with hand-computed expectations — `$50 − $12 = $38` and a `$0` ceiling once the only roster spot is full), and the pool test's imaginary `seedLeagueWithProjections` fixture (now inserts its own two players and stat lines).

**3. Type and name consistency across tasks:**
- `DraftStateView` is the single view type end to end. Every field components read exists: `slotConfig`, `minBid`, `maxBids` and `picks[].slotIndex` are **added by Task 4**; `phase`/`sequence`/`pickNumber`/`onClockTeamId`/`deadlineAt`/`clockSeconds`/`nextTightening` come from `DraftClockView`, which `DraftStateView` extends and every event payload embeds as `payload.clock`.
- `applyDraftEvent(view, data) → { ok, view } | { ok: false, outcome }` — Task 5, called with exactly that shape by `useDraftRoom` (Task 5) and asserted in Tasks 6, 7 and 9's stream tests.
- `optimisticView(view, action, myTeamId) → { view, pendingPlayerId }` — Task 5, used only by `submit`.
- `useDraftRoom(draftId) → DraftRoom` — Task 5. `snake-room.tsx` and `auction-room.tsx` import it **as a type** under the alias `DraftRoomState`, because `DraftRoom` is also the component name in `draft-room.tsx`; that alias is written out in both files.
- `LandedPick` — Task 5, consumed by Tasks 8 and 9.
- `ConnectionStatus` — Task 5, consumed by `ConnectionBanner` (Task 6).
- `DraftSnapshotBody` / `DraftPlayersBody` (`@/draft-room/contract`) and `ApiEnvelope<T>` (`@/lib/api/respond`) — Task 4, used as the route return types **and** the hook's parse targets, so the two sides of the wire cannot drift.
- `TeamCard` (`@/domain/league`) and `Player` (`@/domain/player`) — the only two metadata DTOs; no third shape is invented.
- `usePrefersReducedMotion` / `REDUCED_MOTION_QUERY` live in `src/design/use-reduced-motion.ts` (Task 2) because both `Toast` (a primitive) and `PickCelebration` (a room component) need them; the File Structure table reflects that.
- `UI_CONFIG` (primitives) and `DRAFT_ROOM_CONFIG` (room) are the only two config objects introduced; no component inlines a duration or a page size.
- `rosterSpots` (Task 7) is pinned to the engine's `totalRosterSlots` by an assertion in its own test, so the two cannot diverge.

**4. Process checks:**
- **Every verification command exists in `package.json`:** `npm test`, `npm test -- <dir>`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run dev`, `npm run seed`, `npm run infra:up`, `npm run db:migrate:test`. No script is invented, and the deferred e2e explicitly notes that `npm run e2e` does **not** exist.
- **No draft rule is reimplemented client-side.** Turn order, deadlines, tiers, slot assignment, bid floors, reserve-adjusted ceilings and budgets are all engine-computed and carried on the view or the event payload (Task 4's table lists each one and where it now comes from). The rule is enforced structurally — `src/draft-room/**` imports from `@/draft-engine` with `import type` only — and Task 10's build step names it as something to watch for.
- **No module-level mocks where injection works.** `fetch` and `EventSource` are injected through `DraftRoomDepsProvider`; the only global stub anywhere is `window.matchMedia`, which is environment, not a module, and has no injection seam worth building.
- **`Last-Event-ID` is the browser's.** The hook only ever calls `new EventSource(url)` and `close()`. There is no retry loop, no backoff, no polling, and no manual `Last-Event-ID` header — the SSE route already emits `id:` frames (`src/lib/realtime/sse.ts`) and resumes its `XREAD` from whatever the browser echoes back.
- **Reduced motion is honored twice:** globally in `globals.css`, and as a real behavioral branch in `PickCelebration` (no animation class at all) and `Toast` (a longer dwell). Both branches are asserted.
- **`teamId` is never sent and `TIMER_EXPIRE` has no client path.** `submit` posts a `ClientDraftAction` verbatim; that union has only `MAKE_PICK`, `NOMINATE` and `BID`, and no member carries a `teamId` or a `timestamp`.
- **Wall clock:** the browser reads `Date.now()` in exactly one place, `useNow`. `Date.parse` on a server-supplied ISO string appears in `ClockBanner`, `AuctionLotPanel` and `formatTightening` — parsing a supplied timestamp, which the conventions permit everywhere.
- **Coverage:** three gated directories after Task 5, all verified by an **unfiltered** `npm run test:coverage` in Task 10.

