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

/** A club's nickname, "Texans"; the code itself for a code we do not know. */
export function clubNickname(club: string): string {
	return NICKNAMES[club.toUpperCase()] ?? club;
}

/** A defense's mark in words: "Texans defense". */
export function defenseWords(club: string): string {
	return `${clubNickname(club)} defense`;
}
