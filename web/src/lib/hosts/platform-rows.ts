/** The Account room's Platforms table (Lane 66k): one row per platform a member's league runs on,
 * each with its connection, the consent it was made under, whether its lineup is set from here and
 * why not, its last read and its one verb. Every state is the API's GET /hosts answer; Sleeper's
 * row is a fixed fact, since Sleeper leagues follow by id with nothing to connect. Pure, tested in
 * platform-rows.test.ts. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import type { components } from '#lib/api/types.ts';
import { dayLabel } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import { agoWords } from '#lib/league/model.ts';
import { hostWords } from '#lib/league/names.ts';
import { NOT_YET_OPEN, WORKING_WORDS, againWords, statusWords } from './connection-words.ts';

type HostConnections = components['schemas']['HostConnections'];
type HostConnection = components['schemas']['HostConnection'];
type ConnectedHost = components['schemas']['ConnectedHost'];

/** The table's platforms, in the brief's order. */
export const PLATFORMS = ['espn', 'sleeper', 'yahoo', 'mfl', 'ffpc'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** What a row's verb does: disconnect, connect for the first time, connect again after the
 * platform dropped the connection, or follow a league where there is nothing to connect. */
export type PlatformVerb = 'disconnect' | 'connect' | 'again' | 'follow';

export interface PlatformRow {
	key: Platform;
	name: string;
	/** ok: connected or nothing to connect; bad: the platform dropped it; off: not connected. */
	dot: 'ok' | 'bad' | 'off';
	state: string;
	line: string;
	/** Lineups from here, null where there is no connection to say it for. */
	writes: { on: boolean; words: string } | null;
	/** One sentence across the Lineups and Last read cells where neither applies, null elsewhere. */
	note: string | null;
	read: string;
	verb: { kind: PlatformVerb; words: string } | null;
}

/** Every word the table prints that is not a platform's name, for the copy guard. */
export const PLATFORM_WORDS = {
	title: 'Platforms',
	aside: 'Where your leagues run, and what we keep to read them',
	platform: 'Platform',
	connection: 'Connection',
	lineups: 'Lineups from here',
	lastRead: 'Last read',
	on: 'Lineups on',
	off: 'Lineups off',
	onWords: 'Set there when you confirm a move',
	never: EMPTY_FIGURE,
	sleeperState: WORKING_WORDS.sleeper,
	sleeperNone: 'Not followed',
	sleeperLine: 'Leagues read in public',
	sleeperNote: 'Followed by league id, nothing to connect',
	notConnected: 'Not connected',
	notOpen: NOT_YET_OPEN,
	notOpenLine: 'Connecting opens here soon',
	noLeague: 'no league followed',
	followed: 'followed',
	disconnect: 'Disconnect',
	connect: 'Connect',
	followSleeper: 'Follow a Sleeper league',
	unread: "Your platforms can't be read right now."
} as const;

/** Why to connect a platform not yet connected. */
const CONNECT_LINES: Readonly<Record<ConnectedHost, string>> = {
	espn: 'Connect to follow your ESPN leagues, public or private',
	yahoo: 'Connect to follow your Yahoo leagues',
	mfl: 'Connect to set your lineup on MyFantasyLeague from here',
	ffpc: 'Connect when you follow an FFPC league'
};

const DAY_SECONDS = 86_400;

/** The member's leagues on one platform, from the account's league list: how many, and the newest
 * read of any of them, the one time the row says (Lane 94 fix round 1: the time the leagues table
 * says for its leagues, never the connection's own). */
export interface PlatformLeagues {
	count: number;
	readAt: string | null;
}

/** Each platform's leagues. */
export type LeaguesByPlatform = Readonly<Partial<Record<Platform, PlatformLeagues>>>;

const NO_LEAGUES: PlatformLeagues = { count: 0, readAt: null };

/** What a connection reads: "1 league followed", "no league followed". */
function leaguesWords(count: number): string {
	return count === 0
		? PLATFORM_WORDS.noLeague
		: `${plural(count, 'league')} ${PLATFORM_WORDS.followed}`;
}

/** A read's age: "4 minutes ago" within a day, its date after, "--" never. */
export function readWords(at: string | null, now: Date): string {
	if (at === null) return PLATFORM_WORDS.never;
	const age = Math.max(0, (now.getTime() - Date.parse(at)) / 1000);
	return age < DAY_SECONDS ? agoWords(age) : dayLabel(at);
}

/** A connected platform's row; leagues null when the account's list could not be read, so the row
 * says only when it was connected and its connection's own last read. */
function connectedRow(c: HostConnection, now: Date, leagues: PlatformLeagues | null): PlatformRow {
	const dropped = c.status === 'signed_out';
	const since = `Since ${dayLabel(c.connected_at)}`;
	return {
		key: c.host,
		name: hostWords(c.host),
		dot: dropped ? 'bad' : 'ok',
		state: statusWords(c),
		line: leagues === null ? since : `${since}, ${leaguesWords(leagues.count)}`,
		writes: c.writes_on
			? { on: true, words: PLATFORM_WORDS.onWords }
			: { on: false, words: c.writes_reason ?? PLATFORM_WORDS.never },
		note: null,
		read: readWords(leagues === null ? c.last_read_at : leagues.readAt, now),
		verb: dropped
			? { kind: 'again', words: againWords(c.host) }
			: { kind: 'disconnect', words: PLATFORM_WORDS.disconnect }
	};
}

function unconnectedRow(host: ConnectedHost, open: boolean): PlatformRow {
	return {
		key: host,
		name: hostWords(host),
		dot: 'off',
		state: open ? PLATFORM_WORDS.notConnected : PLATFORM_WORDS.notOpen,
		line: open ? CONNECT_LINES[host] : PLATFORM_WORDS.notOpenLine,
		writes: null,
		note: null,
		read: PLATFORM_WORDS.never,
		verb: open ? { kind: 'connect', words: PLATFORM_WORDS.connect } : null
	};
}

/** Sleeper's row: followed by league id with nothing to connect, "Followed" once a league is. */
function sleeperRow(leagues: number): PlatformRow {
	const followed = leagues > 0;
	// Its note spans the Lineups and Last read cells, so the row says no read.
	return {
		key: 'sleeper',
		name: hostWords('sleeper'),
		dot: followed ? 'ok' : 'off',
		state: followed ? PLATFORM_WORDS.sleeperState : PLATFORM_WORDS.sleeperNone,
		line: followed ? leaguesWords(leagues) : PLATFORM_WORDS.sleeperLine,
		writes: null,
		note: PLATFORM_WORDS.sleeperNote,
		read: PLATFORM_WORDS.never,
		verb: { kind: 'follow', words: PLATFORM_WORDS.followSleeper }
	};
}

/** Every platform's row, in the table's order, from GET /hosts and the account's leagues by
 * platform. */
export function platformRows(
	hosts: HostConnections,
	now: Date,
	leagues: LeaguesByPlatform | null = {}
): PlatformRow[] {
	return PLATFORMS.map((key) => {
		const mine = leagues === null ? null : (leagues[key] ?? NO_LEAGUES);
		if (key === 'sleeper') return sleeperRow(mine?.count ?? 0);
		const c = hosts.connections.find((x) => x.host === key);
		return c ? connectedRow(c, now, mine) : unconnectedRow(key, hosts.enabled.includes(key));
	});
}

/** The newer of two reads, either may be none. */
function newer(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return Date.parse(b) > Date.parse(a) ? b : a;
}

/** The account's leagues by platform: each platform's count and newest read. */
export function leaguesByPlatform(
	leagues: readonly { host: Platform; last_read_at: string | null }[]
): LeaguesByPlatform {
	const out: Partial<Record<Platform, PlatformLeagues>> = {};
	for (const l of leagues) {
		const was = out[l.host] ?? NO_LEAGUES;
		out[l.host] = { count: was.count + 1, readAt: newer(was.readAt, l.last_read_at) };
	}
	return out;
}
