// The phone bar's rows (Lane 87), one rule for every page: a row for each part the page passes (a
// stamp, a tail, a search) and no other. A page's props are its kind, not its data, so the bar is
// fixed before anything loads and never grows as the page fills. A page that passes none draws the
// one row a league's page draws, led by the site mark, the way home (Lane 66t).

/** The phone bar's row count: the switch row; then the stamp and the verb; then the search. */
export type BarRows = 1 | 2 | 3;

/** The bar parts a page passes. Only whether each is passed counts, never what it draws. */
export interface BarParts {
	stamp?: string;
	tail?: unknown;
	search?: unknown;
}

export function barRows({ stamp, tail, search }: BarParts): BarRows {
	if (search !== undefined) return 3;
	if ((stamp !== undefined && stamp !== '') || tail !== undefined) return 2;
	return 1;
}
