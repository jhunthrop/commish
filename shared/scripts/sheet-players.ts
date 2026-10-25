/** The players the apps' player sheet and player page are tested on (Lane 192): each is on the fixture
 * league (web/scripts/inseason-fixture, so the fixture API answers his week) and has a page in the
 * stand-in run (web/scripts/run-from-mock-data.ts, so his read and his figures are the web's), and
 * together they hold every state the sheet draws. One list for the fixture export (his week's answers),
 * the stand-in's recorder (his page) and the parity (what the web's shelf and page print for him). */
export const SHEET_PLAYERS = {
	/** Questionable, his week 6 read written and standing; kicked off on the Sunday. */
	odunze: '4431299',
	/** Due back from injured reserve on the capture read after his read was written: the read is held
	 * for his status before his kickoff, and not written once his game is under way. */
	etienne: '4239996',
	/** On injured reserve, a season-long list: his week's tiles say the list; no read written. */
	dart: '4689114',
	/** On his bye in week 6: no game, no read written. */
	chase: '4362628',
	/** No designation and no read written, his game to come on the Sunday. */
	mahomes: '3139477'
} as const;

/** Every sheet player's id, in the list's order. */
export const SHEET_PLAYER_IDS: readonly string[] = Object.values(SHEET_PLAYERS);

/** The players whose public read (GET /players/{id}/week, no league) is exported too: the week tiles in
 * PPR and no verb. */
export const PUBLIC_SHEET_PLAYER_IDS: readonly string[] = [
	SHEET_PLAYERS.odunze,
	SHEET_PLAYERS.etienne
];
