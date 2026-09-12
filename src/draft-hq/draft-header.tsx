import { ButtonLink, PageTitle, ViewSwitchNav, type ViewSwitchDestination } from "@/components/ui";

/**
 * THE DRAFT AREA'S ONE HEADER — the word Draft, the switch beside it, and the stop's one solid
 * verb at the right.
 *
 * THE NAME NEVER CHANGES WITH THE STOP (mock ruling 1). Three stops under one `<h1>Draft</h1>`,
 * because Board, Your sheet and Mock drafts are three views of one act, not three pages a reader
 * navigates between. The switch is the same track the draft room wears for Wall / Your sheet, one
 * stop wider, so a manager learns the gesture once; each stop is its own address, so the URL says
 * where you are and a stop survives a refresh.
 *
 * THE SWITCH CARRIES THE PAGE'S CONTEXT (fix round 1, H3). `?league=`/`?format=` ride every stop's
 * href, so moving between the Board and Your sheet moves the view and nothing else — a stop that
 * dropped the query would silently recompute every number on screen under different rules.
 *
 * ONE SOLID VERB PER STOP (mock ruling 2). On the two board stops the act is the same and it
 * belongs in the page's fixed furniture, where it is always in the first viewport. Mock drafts
 * shows none: its verb acts on the table the chips beside it set, so it lives inside that door
 * rather than up here, separated from the facts it uses.
 *
 * THE VERB SHARES A ROW AT 360 (fix round 1, H4). A verb on a row of its own cost about sixty
 * pixels at the top of the densest comparison surface in the product, and the measured phone board
 * had ONE player above the fold. Three things do not fit 328px — the title, a three-stop switch
 * and a verb — so the two SHORT ones pair up and the switch takes the full width beneath them: two
 * rows on a phone instead of three, one row from `sm:` up. Never a pinned bar floating over the
 * last row of the list, which the approved mock's own casual persona called out.
 */
export type DraftStop = "board" | "sheet" | "mocks";

const STOPS: readonly { readonly value: DraftStop; readonly label: string; readonly path: string }[] = [
  { value: "board", label: "Board", path: "/app/draft/board" },
  { value: "sheet", label: "Your sheet", path: "/app/draft/sheet" },
  { value: "mocks", label: "Mock drafts", path: "/app/draft/mock-drafts" },
];

/** The stop's address with the page's own context on it. The mock lobby is not league-aware, so
 *  it never carries one — and coming back from it lands on the Board's own default. */
export function draftStops(query: Readonly<Record<string, string>> = {}): readonly ViewSwitchDestination[] {
  const search = new URLSearchParams(query).toString();
  return STOPS.map((stop) => ({
    value: stop.value,
    label: stop.label,
    href: search === "" || stop.value === "mocks" ? stop.path : `${stop.path}?${search}`,
  }));
}

export function DraftHeader({ stop, query = {} }: { readonly stop: DraftStop; readonly query?: Readonly<Record<string, string>> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <PageTitle>Draft</PageTitle>
      {stop === "mocks" ? null : (
        <div className="ml-auto sm:order-last">
          <ButtonLink href="/app/draft/mock-drafts" variant="verb" size="sm" className="sm:min-h-10 sm:px-4.5 sm:text-md">
            Run a mock draft
          </ButtonLink>
        </div>
      )}
      <ViewSwitchNav label="Draft view" stops={draftStops(query)} value={stop} className="order-last sm:order-none sm:mr-auto" />
    </div>
  );
}
