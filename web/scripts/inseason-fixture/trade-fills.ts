// The trade finder's Lane 287 and Lane 290 fields on the fixture's trades, served only to a request
// carrying the fixture_trades=needs cookie (Lane 290), so the recorded answers the shared fixtures and
// the apps read keep the older shape until a re-record lane brings them in (Lane 287's concern):
//   - each row's fills, their_fills and gives (Lane 287), and each side's lineup rest of season (its
//     gain a week times the weeks the order covers);
//   - each team with no listed trade, its empty_reason (Lane 290, B283), with two more teams emptied so
//     the row shows every reason a team can have;
//   - two pending offers from the host (Lane 279): one the builder can hold, with its expiry, and one
//     it cannot (the member's defense for their receiver; the builder takes QB, RB, WR and TE only).
// STAND-IN, named in the lane's report: fills is the position of the first player the member gets and
// their_fills that of the first he gives, never the search's need; the reasons are set by roster, not
// read from any search. Only the shapes are meant to hold.
import type {
	TradeAdvice,
	TradeCheck,
	TradeEmptyReason,
	TradeOffer,
	TradeRow
} from '../../src/lib/league/inseason/api.ts';
import { roundTenth } from './tenths.ts';

/** The cookie a request asks for the finder's newer fields by. */
export const TRADE_NEEDS_COOKIE = 'fixture_trades=needs';
const ASKED = /(?:^|; )fixture_trades=needs(?:;|$)/;

/** Whether a request's cookie header asks for them. */
export function needsAsked(cookie: string | undefined): boolean {
	return ASKED.test(cookie ?? '');
}

/** The teams the stand-in empties, each with its reason (the rest with none keep "dropped"). */
export const EMPTIED: Readonly<Record<number, TradeEmptyReason>> = {
	11: 'same_need',
	12: 'no_need',
	3: 'nothing'
};

/** The team whose second listed trade is offered to the member, and the team asking for his defense. */
export const OFFER_FROM = 10;
export const TOO_BIG_FROM = 6;
/** How long after the read the loadable offer lapses: two days. */
const OFFER_LAPSES_MS = 2 * 24 * 60 * 60 * 1000;

type Skill = NonNullable<TradeRow['gives']>;
const SKILL = new Set<string>(['QB', 'RB', 'WR', 'TE']);

/** The first skill position on a side, null for none. */
function positionOf(side: TradeRow['give']): Skill | null {
	const at = side.find((line) => SKILL.has(line.player.position))?.player.position;
	return at === undefined ? null : (at as Skill);
}

/** A row with the Lane 287 fields over `weeks`. */
function withFills<T extends Pick<TradeRow, 'give' | 'get' | 'my_gain' | 'their_gain'>>(
	row: T,
	weeks: number
): T {
	return {
		...row,
		fills: positionOf(row.get),
		their_fills: positionOf(row.give),
		gives: null,
		my_lineup_rest_of_season: roundTenth(row.my_gain * weeks),
		their_lineup_rest_of_season: roundTenth(row.their_gain * weeks)
	};
}

/** The member's offers from the host: the second trade OFFER_FROM lists, and the member's defense for
 * TOO_BIG_FROM's first get. */
function offersOf(advice: TradeAdvice, readAt: string): TradeOffer[] {
	const ids = (side: TradeRow['give']): string[] => side.map((line) => line.player.host_id);
	const from = advice.teams.find((t) => t.roster_id === OFFER_FROM);
	const row = from?.trades[1] ?? from?.trades[0];
	const big = advice.teams.find((t) => t.roster_id === TOO_BIG_FROM);
	const bigGet = big?.trades[0]?.get[0];
	const offer = (
		team: { roster_id: number; name: string },
		id: string,
		give: string[],
		get: string[],
		expires: string | null
	): TradeOffer => ({
		label: 'Offered to you',
		roster_id: team.roster_id,
		name: team.name,
		give,
		get,
		drop: [],
		host_offer_id: id,
		expires_at: expires,
		read_at: readAt
	});
	const lapses = new Date(Date.parse(readAt) + OFFER_LAPSES_MS).toISOString();
	return [
		...(from && row ? [offer(from, 'fixture-offer-1', ids(row.give), ids(row.get), lapses)] : []),
		...(big && bigGet
			? [
					offer(
						big,
						'fixture-offer-2',
						advice.roster
							.filter((line) => line.player.position === 'DEF')
							.map((line) => line.player.host_id),
						[bigGet.player.host_id],
						null
					)
				]
			: [])
	];
}

/** The finder's answer with the newer fields: each row's, each empty team's reason (the EMPTIED teams
 * cleared first), and the host's offers. */
export function tradesWithNeeds(advice: TradeAdvice, weeks: number, readAt: string): TradeAdvice {
	const offers = offersOf(advice, readAt);
	return {
		...advice,
		offers,
		teams: advice.teams.map((team) => {
			const emptied = EMPTIED[team.roster_id];
			const trades = emptied === undefined ? team.trades.map((r) => withFills(r, weeks)) : [];
			if (trades.length > 0) return { ...team, trades };
			return { ...team, trades, note: null, empty_reason: emptied ?? 'dropped' };
		})
	};
}

/** A check with the newer fields on its trade. */
export function checkWithNeeds(check: TradeCheck, weeks: number): TradeCheck {
	return { ...check, trade: withFills(check.trade, weeks) };
}
