/** The fixture account's paired devices (Lane 198), as GET /devices answers them, newest first: the
 * member's iPhone, signed in through the app and used the morning of the fixture week's Saturday, and
 * a browser extension paired before the season and never used. The apps' Account screens mark the
 * first as the phone they run on and unpair the second; the web's account page lists both. */
export const FIXTURE_DEVICES = [
	{
		id: '6f1d1c52-2626-4a26-9a26-0000000000d1',
		name: 'iPhone',
		kind: 'ios',
		scopes: ['league:write', 'draft:write', 'session'],
		created_at: '2026-10-12T15:00:00.000Z',
		last_used_at: '2026-10-17T16:00:00.000Z'
	},
	{
		id: '6f1d1c52-2626-4a26-9a26-0000000000d2',
		name: 'Chrome on a Mac',
		kind: 'extension',
		scopes: ['league:write'],
		created_at: '2026-09-03T14:00:00.000Z',
		last_used_at: null
	}
] as const;
