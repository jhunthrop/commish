import { ButtonLink, PageTitle, ViewSwitchNav, type ViewSwitchDestination } from "@/components/ui";

/**
 * THE DRAFT AREA'S ONE HEADER (the Draft area round, 2026-09-12) — the word Draft, the switch
 * beside it, and the stop's one solid verb at the right.
 *
 * THE NAME NEVER CHANGES WITH THE STOP (mock ruling 1). Three stops under one `<h1>Draft</h1>`,
 * because Board, Your sheet and Mock drafts are three views of one act, not three pages a reader
 * navigates between. The switch is the same track the draft room wears for Wall / Your sheet,
 * one stop wider, so a manager learns the gesture once; each stop is its own address, so the URL
 * says where you are and a stop survives a refresh.
 *
 * ONE SOLID VERB PER STOP (mock ruling 2). On the two board stops the act is the same and it
 * belongs in the page's fixed furniture, where it is always in the first viewport. Mock drafts
 * passes `verb={false}`: its verb acts on the table the chips beside it set, so it lives inside
 * that door rather than up here, separated from the facts it uses.
 */
export type DraftStop = "board" | "sheet" | "mocks";

export const DRAFT_STOPS: readonly ViewSwitchDestination[] = [
  { value: "board", label: "Board", href: "/app/draft/board" },
  { value: "sheet", label: "Your sheet", href: "/app/draft/sheet" },
  { value: "mocks", label: "Mock drafts", href: "/app/draft/mock-drafts" },
];

export function DraftHeader({ stop }: { readonly stop: DraftStop }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <PageTitle>Draft</PageTitle>
      <ViewSwitchNav label="Draft view" stops={DRAFT_STOPS} value={stop} />
      {stop === "mocks" ? null : (
        <div className="ml-auto">
          <ButtonLink href="/app/draft/mock-drafts" variant="verb" size="lg">
            Run a mock draft
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
