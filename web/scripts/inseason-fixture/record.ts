// The league record's answer (Lane 93, GET /leagues/attached/{id}/record) for the fixture's leagues:
// each league's lineup, and for the ESPN stand-ins one graded week of our picks against ESPN's
// projected lineup. STAND-IN: no week from 7 on is graded at the fixture's clock, so the ESPN week is
// made up to draw the sentence; the recorded Sleeper league answers its lineup and no week, as the API
// does for every platform but ESPN.
import type { components } from '../../src/lib/api/types.ts';

type LeagueRecord = components['schemas']['LeagueRecord'];

/** A 12-team ESPN lineup: QB, 2 RB, 2 WR, TE, a flex, a kicker and a defense, seven on the bench. */
const ESPN_LINEUP: LeagueRecord['lineup'] = {
	qb: 1,
	rb: 2,
	wr: 2,
	te: 1,
	flex: 1,
	super_flex: 0,
	k: 1,
	def: 1,
	bench: 7
};

/** The answer for a league: ESPN's with its stand-in week, any other league's with none. */
export function leagueRecordAnswer(espn: boolean): LeagueRecord {
	return {
		host: espn ? 'espn' : 'sleeper',
		teams: 12,
		lineup: ESPN_LINEUP,
		weeks: espn ? [{ week: 7, benchmark: 'espn', ours: 112.4, theirs: 104, margin: 8.4 }] : []
	};
}
