import { FIGURE } from './figure-words.ts';

/** A free agent's club cell (Lane 123, B101): the provider's list names him with no club, and the API
 * and the run carry the site's one word for it, "FA", where a club's code goes. No mark, no club page,
 * no bye and no game; a sentence says FREE_AGENT_WORDS. */
export const FREE_AGENT_CLUB = FIGURE.freeAgentClub;
export const FREE_AGENT_WORDS = FIGURE.freeAgent;

/** He has no club: the club cell is the free agent's. */
export function isFreeAgent(club: string): boolean {
	return club === FREE_AGENT_CLUB;
}

/** The clubs' nicknames by the codes the board and the API use, for the words a club's mark carries:
 * "Texans defense". One table for every screen that names a club in words. */
const NICKNAMES: Readonly<Record<string, string>> = {
	ARI: 'Cardinals',
	ATL: 'Falcons',
	BAL: 'Ravens',
	BUF: 'Bills',
	CAR: 'Panthers',
	CHI: 'Bears',
	CIN: 'Bengals',
	CLE: 'Browns',
	DAL: 'Cowboys',
	DEN: 'Broncos',
	DET: 'Lions',
	GB: 'Packers',
	HOU: 'Texans',
	IND: 'Colts',
	JAX: 'Jaguars',
	KC: 'Chiefs',
	LAC: 'Chargers',
	LAR: 'Rams',
	LV: 'Raiders',
	MIA: 'Dolphins',
	MIN: 'Vikings',
	NE: 'Patriots',
	NO: 'Saints',
	NYG: 'Giants',
	NYJ: 'Jets',
	PHI: 'Eagles',
	PIT: 'Steelers',
	SEA: 'Seahawks',
	SF: '49ers',
	TB: 'Buccaneers',
	TEN: 'Titans',
	WSH: 'Commanders',
	WAS: 'Commanders'
};

/** A code some feeds still use for a club the board names by another (WAS for WSH). */
const ALIASES = new Set(['WAS']);

/** The 32 clubs by the board's own codes (the club mark route serves these and no other). */
export function clubCodes(): readonly string[] {
	return Object.keys(NICKNAMES).filter((code) => !ALIASES.has(code));
}

/** A club's nickname, "Texans"; the code itself for a code we do not know. */
export function clubNickname(club: string): string {
	return NICKNAMES[club.toUpperCase()] ?? club;
}

/** A defense's mark in words: "Texans defense". */
export function defenseWords(club: string): string {
	return `${clubNickname(club)} defense`;
}
