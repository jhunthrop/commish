/** The push payloads the apps open (Lane 288, spec 2026-10-24-native-mobile-apps-design §5.3): what the
 * API's notify job sends a phone for each kind, as FCM's v1 message (Android) and APNs's body (iOS), and
 * the screen each payload's `path` names. The API is the source: api/internal/notify/push_fixture_test.go
 * builds the starter status cases through the producer's row (starterRow) and both senders and asserts
 * they equal this file, so a change to the API's payload fails the API's test until this file follows,
 * and the apps' routing tests then follow this file.
 *
 * The week reads and waiver claims kinds have no producer yet (api/internal/notify/kinds.go); their
 * cases are the contract their producers send: a `path` to the league's home and to its waivers. A
 * `path` the apps do not draw (the account), an absolute URL and a payload without one open the app
 * where it was.
 *
 * Written by export-parity.ts beside the others. */

export const PUSH_OUTPUT = 'shared/fixtures/parity/push.json';

/** The screens a push opens, the apps' tabs for the league it names. */
export type PushScreen = 'league' | 'lineup' | 'waivers';

export interface PushRoute {
	screen: PushScreen;
	league: string;
	player: string | null;
}

/** A starter status case's producer inputs, which the API's test feeds starterRow. */
export interface StarterInput {
	player_id: string;
	player_name: string;
	change: string;
	/** The leagues that start him, the first one's id and name in the link. */
	leagues: readonly { id: string; name: string }[];
	/** The newer capture's time, unix seconds: the dedupe key's part, never sent. */
	capture: number;
}

interface PushCase {
	name: string;
	kind: 'starter_status' | 'week_reads' | 'waiver_claims';
	title: string;
	body: string;
	/** What the phone receives beside the alert: FCM's data map, the APNs body's own keys. */
	data: Readonly<Record<string, string>>;
	starter?: StarterInput;
	route: PushRoute | null;
}

const LEAGUE = '6f1d1c52-2626-4a26-9a26-000000000026';
const OTHER_LEAGUE = '6f1d1c52-2626-4a26-9a26-000000000027';
const LEAGUE_NAME = 'S.U.C.K. - Severely Underrated Carolina Keepers';
const CAPTURE = 1_760_720_400;

function starter(input: StarterInput, title: string, body: string, name: string): PushCase {
	const first = input.leagues[0];
	const path = `/league/${first.id}/start?player=${encodeURIComponent(input.player_id)}`;
	return {
		name,
		kind: 'starter_status',
		title,
		body,
		data: {
			change: input.change,
			kind: 'starter_status',
			league_id: first.id,
			path,
			player_id: input.player_id
		},
		starter: input,
		route: { screen: 'lineup', league: first.id, player: input.player_id }
	};
}

function pathOnly(
	name: string,
	kind: PushCase['kind'],
	path: string | null,
	route: PushRoute | null
): PushCase {
	return {
		name,
		kind,
		title: 'Commish',
		body: 'A case for the route alone.',
		data: path === null ? { kind } : { kind, league_id: LEAGUE, path },
		route
	};
}

const CASES: readonly PushCase[] = [
	starter(
		{
			player_id: '8439',
			player_name: 'Aaron Rodgers',
			change: 'out',
			leagues: [{ id: LEAGUE, name: LEAGUE_NAME }],
			capture: CAPTURE
		},
		'Aaron Rodgers is out',
		`He starts in your ${LEAGUE_NAME} lineup. Set a replacement before his game.`,
		'a starter ruled out in one lineup'
	),
	starter(
		{
			player_id: '9509',
			player_name: "Ja'Marr Chase",
			change: 'cleared',
			leagues: [
				{ id: OTHER_LEAGUE, name: LEAGUE_NAME },
				{ id: LEAGUE, name: LEAGUE_NAME }
			],
			capture: CAPTURE
		},
		"Ja'Marr Chase is cleared to play",
		'He starts in 2 of your lineups. He no longer carries an injury designation.',
		'a starter cleared in two lineups opens the first'
	),
	pathOnly('the Thursday read opens the league', 'week_reads', `/league/${LEAGUE}`, {
		screen: 'league',
		league: LEAGUE,
		player: null
	}),
	pathOnly('a waiver claim opens the waivers', 'waiver_claims', `/league/${LEAGUE}/waivers`, {
		screen: 'waivers',
		league: LEAGUE,
		player: null
	}),
	pathOnly('a path the apps do not draw', 'starter_status', '/account', null),
	pathOnly('an absolute URL', 'starter_status', `https://example.com/league/${LEAGUE}/start`, null),
	pathOnly('no path', 'week_reads', null, null)
];

/** FCM v1's message as the API's FCM sender posts it, the token aside. */
function fcm(c: PushCase): unknown {
	return {
		notification: { title: c.title, body: c.body },
		data: c.data,
		android: { priority: 'high' }
	};
}

/** APNs's body as the API's APNs sender posts it: the alert, then the data's keys beside it. */
function apns(c: PushCase): unknown {
	return { aps: { alert: { title: c.title, body: c.body }, sound: 'default' }, ...c.data };
}

/** The parity file. */
export function renderPush(about: string): string {
	const cases = CASES.map((c) => ({ ...c, fcm: fcm(c), apns: apns(c) }));
	return `${JSON.stringify({ about, cases }, null, '\t')}\n`;
}
