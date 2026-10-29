/**
 * The cheat sheet's words (Lane 283, B266): one module the web's sheet files read and
 * shared/scripts/gen-words.ts carries into shared/words and the apps' Words tables, so the three
 * clients print one copy. Three tables by concern: the page's own (its bar, filters, rows, sheet list
 * and empty sheet), the import panel's, and the status line's. A word with a slot (a count, a name, a
 * limit) is a template where it is used and stays there until B256 gives slots a shape the apps can
 * read; the status line's two are functions here, which the generator lists under `functions`. The
 * print page's words are print-words.ts's.
 */

/** The page's words: the bar and its tools, the filters, a row and its editor, the sheet list, the
 * empty sheet, and the verbs that put a player or a draft on a sheet from elsewhere. */
export const SHEET = {
	/** The page's title in the bar. */
	title: 'Cheat sheet',
	/** The page's title in the browser's tab. */
	headTitle: 'Your cheat sheet',
	/** The name a sheet starts with. */
	defaultName: 'My sheet',
	sheetName: 'Sheet name',
	searchSheet: 'Search your sheet',
	yourSheets: 'Your sheets',
	importTool: 'Import',
	/** The export: the site downloads it, the phones hand it to the share sheet. */
	exportTool: 'Export CSV',
	saveToAccount: 'Save it to your account',
	undo: 'Undo',
	/** What a screen reader hears once an undo lands. */
	undone: 'Undone',
	more: 'More',
	gotIt: 'Got it',
	position: 'Position',
	tags: 'Tags',
	notes: 'Notes',
	all: 'All',
	notePlaceholder: 'Your note',
	ownTagPlaceholder: 'Your own tag',
	addTag: 'Add tag',
	startTier: 'Start a tier here',
	remove: 'Take off my sheet',
	hasNote: 'Has a note',
	openSheet: 'Open',
	deleteSheet: 'Delete',
	deleteIt: 'Delete it',
	keepIt: 'Keep it',
	newSheet: 'New sheet',
	done: 'Done',
	yourSheet: 'Your sheet',
	show: 'Show',
	showNotes: 'Show Notes',
	startHead: 'Start your sheet',
	start: 'Start from our board',
	importSheet: 'Import a sheet',
	boardFailed: 'Our board did not load. Try again in a moment',
	addToSheet: 'Add to my sheet',
	onYourSheet: 'On your sheet',
	saveDraft: 'Save this draft as a sheet',
	savedToSheets: 'Saved to your sheets',
	checkingAccount: 'Checking your account'
} as const;

/** The import panel's words, and the reasons a file or a row of it does not read that need no slot;
 * each says "row", the API's word for them too (Lane 283, the coordinator's C1 ruling). */
export const SHEET_IMPORT = {
	head: 'Import',
	fileLabel: 'A CSV file',
	chooseFile: 'Choose a CSV',
	/** Beside the button until a file is chosen. */
	noFile: 'No file chosen',
	/** The paste box's label: "row", never "line", which the copy rules keep for the field (Lane 283,
	 * the coordinator's C1 ruling). */
	pasteLabel: 'Or paste a CSV or a list of names, one per row',
	/** The paste box's placeholder: a list's shape. */
	pasteExample: "1. Puka Nacua\n2. Ja'Marr Chase, WR",
	replace: 'Replace my sheet',
	use: 'Use this sheet',
	cancel: 'Cancel',
	/** The phones' verb under an import that read no player: back to the paste box, the text kept to fix
	 * (Lane 297). The web reads in the browser and never sends such a list. */
	fixList: 'Fix the list',
	/** The phones' line under a CSV that read no player and skipped no row: its header and nothing under it,
	 * said in place of a list's shape (Lane 297 review, M2). */
	headerOnly: 'The file has a header and no players',
	unreadable: 'That file does not read as CSV',
	didNotOpen: 'That file did not open',
	tooLarge: 'That file is over 1 MB',
	boardNotLoaded: 'Our board did not load, so a list of names cannot be read yet',
	boardLoading: 'Our board is still loading',
	emptyFile: 'The file is empty',
	badHeader: 'The first row must name rank, player_id, name and position',
	notCsv: 'This row is not valid CSV',
	earlier: 'This player is already on an earlier row',
	bothTargetAndAvoid: 'Target and Avoid are both set, pick one',
	badRank: 'The rank is not a whole number from 1',
	badPosition: 'The position is not QB, RB, WR, TE, K or DST'
} as const;

/** The status line's words (status.ts statusWords says which when). */
export const SHEET_STATUS = {
	inBrowser: 'Saved in this browser',
	saving: 'Saving to your account',
	saved: 'Saved to your account',
	savedAt: (time: string): string => `Saved to your account at ${time}`,
	savedOn: (day: string): string => `Saved to your account ${day}`,
	offline: 'Offline.',
	unreachable: "Your account can't be reached right now",
	notSaved: 'Not saved to your account',
	notKept: 'This browser is not keeping it'
} as const;
