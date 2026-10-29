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
		weeks: espn
			? [
					{
						week: 7,
						benchmark: 'espn',
						ours: 112.4,
						theirs: 104,
						margin: 8.4,
						// Lane 292, STAND-IN: the member's set lineup that week.
						set: { points: 101.2, matched: false },
						// Lane 114, STAND-IN: the week's weekly record on the league's rostered players.
						ranking: {
							players: 168,
							ours: { agreement: 0.6, places_off: 14.2, starters: 71, starters_of: 108 },
							espn: { agreement: 0.57, places_off: 15, starters: 69, starters_of: 108 }
						}
					}
				]
			: [],
		// Lane 292, STAND-IN: the member's start and sit record over the stand-in week; the sentence is
		// dashboard.go StartSitBasis, word for word.
		...(espn
			? {
					start_sit: {
						weeks: 1,
						matched: 0,
						ours_less_set: 11.2,
						basis: START_SIT_BASIS
					}
				}
			: {})
	};
}

/** dashboard.go StartSitBasis, word for word. */
export const START_SIT_BASIS =
	'Your start and sit: weeks your set lineup started the same players our order picks from your roster at quarterback, running back, receiver and tight end, and what our picks scored less yours, on played weeks.';
