/** The board row's columns, the one place they are decided (Lane 66n): which columns a view carries,
 * in order, and each column's width in each band of the page's width. The board, ADP, a club, the
 * front door's top ten and the system page all draw their rows through it, so a row and its head
 * never drift. A column with no width in a band is hidden there: the table's style picks the band's
 * grid (BoardTable sets it once per table), and each cell carries the classes that hide it. */
import { FIGURE } from '#lib/format/figure-words.ts';
import { ADP_PAGE, CLUB_PAGE } from '#lib/site/reference-words.ts';
import { BOARD } from './board-words.ts';

/** Every column a board row can carry, in the order a row prints them. */
export const COLUMN_KEYS = [
	'rank',
	'adpLead',
	'face',
	'player',
	'tier',
	'bye',
	'proj',
	'vor',
	'order',
	'range',
	'adp',
	'ourRank',
	'gap',
	'gp',
	'avg',
	'action'
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** A column head's words: in full, on the phone where the column is narrower, and the title that
 * says an abbreviation in full. */
export interface ColumnHead {
	text: string;
	short?: string;
	title?: string;
	/** A second, quieter line under the head that says what it counts: Tier's "by position" (B47). */
	note?: string;
}

/** Each column's head, said once over the rows (RowHead), each figure's unit never in the rows (Lane
 * 66n). The figures' heads are the site's one word for each (format/figure-words.ts). */
export const COLUMN_HEADS: Readonly<Record<ColumnKey, ColumnHead>> = {
	rank: { text: ADP_PAGE.rank, title: CLUB_PAGE.ourRank },
	adpLead: { text: BOARD.adp },
	face: { text: '' },
	player: { text: 'Player' },
	tier: { text: 'Tier', note: 'by position' },
	bye: { text: BOARD.bye },
	proj: { text: FIGURE.projected },
	// Said in full where the column has the room, the basis saying what it counts (B46).
	vor: { text: 'Over replacement', short: BOARD.overReplShort, title: 'Over replacement' },
	order: { text: BOARD.draftOrder },
	range: { text: 'Floor to ceiling' },
	adp: { text: BOARD.adp },
	ourRank: { text: ADP_PAGE.rank, title: CLUB_PAGE.ourRank },
	gap: { text: BOARD.gap, title: "Gap, drafters' ADP less our rank" },
	gp: { text: 'GP', title: 'Games played' },
	avg: { text: FIGURE.avg, title: 'Points a game this season' },
	action: { text: '' }
};

/** The page's width bands: a desk (1440 and up), a laptop or an iPad in landscape (961 to 1439), an
 * iPad in portrait (761 to 960) and the phone. */
export const BANDS = ['desk', 'lap', 'tab', 'phone'] as const;
export type Band = (typeof BANDS)[number];

/** A track's width in a band: pixels, a grid track ("minmax(0, 1fr)"), or null where it is hidden. */
type Track = number | string | null;
type Widths = Readonly<Record<Band, Track>>;

const PLAYER_TRACK: Widths = {
	desk: 'minmax(176px, 1fr)',
	lap: 'minmax(140px, 1fr)',
	tab: 'minmax(0, 1fr)',
	phone: 'minmax(0, 1fr)'
};

/** Each column's width per band. The phone keeps the ranking key (Over repl), Projected and Gap, with
 * the bye folded under the name; a view in ADP order keeps its ADP lead, and a kicker's or a
 * defense's view its draft order and ADP. */
const WIDTHS: Readonly<Record<ColumnKey, Widths>> = {
	rank: { desk: 36, lap: 32, tab: 28, phone: null },
	adpLead: { desk: 52, lap: 48, tab: 44, phone: 40 },
	face: { desk: 40, lap: 40, tab: 36, phone: 32 },
	player: PLAYER_TRACK,
	tier: { desk: 64, lap: 64, tab: null, phone: null },
	bye: { desk: 32, lap: 32, tab: 32, phone: null },
	proj: { desk: 74, lap: 74, tab: 74, phone: 62 },
	vor: { desk: 92, lap: 90, tab: 88, phone: 58 },
	order: { desk: 88, lap: 80, tab: 72, phone: 64 },
	range: { desk: 176, lap: null, tab: null, phone: null },
	adp: { desk: 46, lap: 44, tab: 44, phone: null },
	ourRank: { desk: 40, lap: 36, tab: 36, phone: null },
	gap: { desk: 50, lap: 48, tab: 48, phone: 44 },
	gp: { desk: 28, lap: null, tab: null, phone: null },
	avg: { desk: 50, lap: 48, tab: null, phone: null },
	action: { desk: 60, lap: 36, tab: null, phone: null }
};

/** A kicker's or a defense's ADP is one of his two figures, so the phone keeps it. */
const DRAFT_ORDER_ADP: Widths = { desk: 72, lap: 64, tab: 60, phone: 56 };

/** What a view of board rows shows. */
export interface ColumnView {
	/** Our order (rank first) or the drafters' (ADP first, our rank among the figures). */
	order: 'board' | 'adp';
	/** The All view's tier chip column. A position view draws tier bands instead. */
	tier: boolean;
	/** The bye column. Off on a club page, whose rows share one bye, said once in its hero. */
	bye: boolean;
	/** The floor to ceiling column: the rows carry a range and the switch is on. */
	range: boolean;
	/** The drafters' gap to our rank: only where the board compares the two (row-framing.ts). */
	gap: boolean;
	/** This season's games and points a game, once the season is underway. */
	season: boolean;
	/** The row's sheet control at its end. */
	action: boolean;
	/** Kickers and defenses alone, in draft order: their place and ADP, no figures of ours. */
	draftOrder?: boolean;
	/** The board ranks the rest of the season (Lane 93): the in-season board, which draws no ADP. */
	restOfSeason?: boolean;
}

export interface BoardColumns {
	keys: readonly ColumnKey[];
	/** Each band's grid-template-columns, for the table's style. */
	templates: Readonly<Record<Band, string>>;
	/** Each column's cell classes: its name, and the bands that hide it. */
	cells: Readonly<Partial<Record<ColumnKey, string>>>;
}

function viewKeys(view: ColumnView): ColumnKey[] {
	if (view.draftOrder === true) {
		return ['face', 'player', ...(view.bye ? (['bye'] as const) : []), 'order', 'adp', 'action'];
	}
	const wanted: Readonly<Record<ColumnKey, boolean>> = {
		rank: view.order === 'board',
		adpLead: view.order === 'adp',
		face: true,
		player: true,
		tier: view.tier,
		bye: view.bye,
		proj: true,
		vor: true,
		order: false,
		range: view.range,
		// ADP is a draft-board column (Lane 93, B04): the rest-of-season board, in season, draws none.
		adp: view.order === 'board' && view.restOfSeason !== true,
		ourRank: view.order === 'adp',
		gap: view.gap,
		gp: view.season,
		avg: view.season,
		action: view.action
	};
	return COLUMN_KEYS.filter((key) => wanted[key]);
}

function track(width: Track): string | null {
	return width === null ? null : typeof width === 'number' ? `${String(width)}px` : width;
}

export function boardColumns(view: ColumnView): BoardColumns {
	const keys = viewKeys(view);
	const widthsOf = (key: ColumnKey): Widths =>
		key === 'adp' && view.draftOrder === true ? DRAFT_ORDER_ADP : WIDTHS[key];
	const templates = Object.fromEntries(
		BANDS.map((band) => [
			band,
			keys
				.map((key) => track(widthsOf(key)[band]))
				.filter((value): value is string => value !== null)
				.join(' ')
		])
	) as Record<Band, string>;
	const cells = Object.fromEntries(
		keys.map((key) => {
			const hidden = BANDS.filter((band) => widthsOf(key)[band] === null).map(
				(band) => `h-${band}`
			);
			return [key, [`c-${key}`, ...hidden].join(' ')];
		})
	);
	return { keys, templates, cells };
}

/** The table's style: each band's grid as a custom property its rows and head read. */
export function columnStyle(columns: BoardColumns): string {
	return BANDS.map((band) => `--cols-${band}: ${columns.templates[band]}`).join('; ');
}
