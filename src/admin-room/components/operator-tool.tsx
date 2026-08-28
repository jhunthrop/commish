import type { ReactNode } from "react";
import { Card, PageTitle } from "@/components/ui";

export interface OperatorToolProps {
  /** The tool's name, and the page's own `<h1>` — matched by the route's `metadata` (A5) and by
   *  `AdminConsoleNav`'s label for it. */
  readonly title: string;
  /** One line: what this tool does and what it costs. Never two paragraphs — an operator who has
   *  opened the page already knows why they came. */
  readonly intent: string;
  /** The control itself: a form, a table, a report. */
  readonly children: ReactNode;
}

/**
 * THE OPERATOR'S WORK AREA — the admin room's one page shape (Gameday).
 *
 * The spec's ruling on this route group is the whole design of this component: *"Gameday's
 * tokens and primitives apply; its drama does not. An operator surface is a tool, and laws 2 and
 * 6 are spent sparingly here."* So what this gives every admin page is the two things a tool
 * genuinely needs and nothing else.
 *
 * **A BOUNDED WORK AREA (law 4).** Five of the seven operator pages are one short form over an
 * opaque id, and every one of them rendered its `<input>` at the full width of a 1440px content
 * column. A field's width is a claim about how much to type, and a 1300px box asking for a
 * thirty-character user id is the loudest wrong claim on the page — it also leaves the operator's
 * eye travelling the whole screen between the label and the value they just pasted. `max-w-xl`
 * is the measure a form of ids and short strings actually wants, and it is set ONCE here rather
 * than five times at five call sites that would drift.
 *
 * **NO DRAMA.** No hero number, no accent fill, no motion, no card depth response — a `Card` at
 * rest, and `PageTitle` at its ordinary `display-md`. An operator scanning a moderation queue at
 * 2am wants a dense, quiet, legible tool, and the discipline this component enforces is mostly
 * the things it refuses to offer: there is no `size`, no `tone`, and no `action` prop, because a
 * page that wanted one would be reaching for exactly the drama the ruling withholds.
 *
 * The queue is the one page that does NOT use this: it is a table rather than a form, and a
 * table wants the full width the ruling's density argument asks for.
 */
export function OperatorTool({ title, intent, children }: OperatorToolProps) {
  return (
    <>
      <header className="flex flex-col gap-1">
        <PageTitle>{title}</PageTitle>
        <p className="max-w-prose text-sm text-text-muted">{intent}</p>
      </header>
      <Card as="section" className="w-full max-w-xl">
        {children}
      </Card>
    </>
  );
}
