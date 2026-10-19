/** The Account room's Platforms table (Lane 66k): one row per platform a member's league runs on,
 * each with its connection, the consent it was made under, whether its lineup is set from here and
 * why not, its last read and its one verb. Every state is the API's GET /hosts answer; Sleeper's
 * row is a fixed fact, since Sleeper leagues follow by id with nothing to connect. Pure, tested in
 * platform-rows.test.ts. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import type { components } from '#lib/api/types.ts';
import { dayLabel } from '#lib/format/date.ts';
import { agoWords } from '#lib/league/model.ts';
import { hostWords } from '#lib/league/names.ts';
import { statusWords } from './connection-words.ts';

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
	sleeperState: 'No sign-in',
	sleeperLine: 'Leagues read in public',
	sleeperNote: 'Followed by league id, nothing to connect',
	notConnected: 'Not connected',
	notOpen: 'Not open to your account yet',
	notOpenLine: 'Connecting opens here soon',
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

/** The verb that connects again once the platform dropped the connection. */
const AGAIN_WORDS: Readonly<Record<ConnectedHost, string>> = {
	espn: 'Connect ESPN again',
	yahoo: 'Connect Yahoo again',
	mfl: 'Connect MyFantasyLeague again',
	ffpc: 'Sign in to FFPC again'
};

const DAY_SECONDS = 86_400;

/** A read's age: "4 minutes ago" within a day, its date after, "--" never. */
export function readWords(at: string | null, now: Date): string {
	if (at === null) return PLATFORM_WORDS.never;
	const age = Math.max(0, (now.getTime() - Date.parse(at)) / 1000);
	return age < DAY_SECONDS ? agoWords(age) : dayLabel(at);
}

function connectedRow(c: HostConnection, now: Date): PlatformRow {
	const dropped = c.status === 'signed_out';
	return {
		key: c.host,
		name: hostWords(c.host),
		dot: dropped ? 'bad' : 'ok',
		state: statusWords(c),
		line: `Since ${dayLabel(c.connected_at)}, consent version ${String(c.consent_version)}`,
		writes: c.writes_on
			? { on: true, words: PLATFORM_WORDS.onWords }
			: { on: false, words: c.writes_reason ?? PLATFORM_WORDS.never },
		note: null,
		read: readWords(c.last_read_at, now),
		verb: dropped
			? { kind: 'again', words: AGAIN_WORDS[c.host] }
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

const SLEEPER_ROW: PlatformRow = {
	key: 'sleeper',
	name: hostWords('sleeper'),
	dot: 'ok',
	state: PLATFORM_WORDS.sleeperState,
	line: PLATFORM_WORDS.sleeperLine,
	writes: null,
	note: PLATFORM_WORDS.sleeperNote,
	read: PLATFORM_WORDS.never,
	verb: { kind: 'follow', words: PLATFORM_WORDS.followSleeper }
};

/** Every platform's row, in the table's order, from GET /hosts. */
export function platformRows(hosts: HostConnections, now: Date): PlatformRow[] {
	return PLATFORMS.map((key) => {
		if (key === 'sleeper') return SLEEPER_ROW;
		const c = hosts.connections.find((x) => x.host === key);
		return c ? connectedRow(c, now) : unconnectedRow(key, hosts.enabled.includes(key));
	});
}
