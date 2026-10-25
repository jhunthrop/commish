/** The Waivers screen's parity (Lane 186): what the web's Waivers (WaiverScreen.svelte at 390 over
 * PickupStrip, WaiverTable, MovePanel and BasisBlock) prints for an answer at a clock, in the fixture's
 * zone, as JSON the apps' ports are held to: the strip (the week, the count of pickups, the sum, each
 * card's slot, mark, move, why and gains), the line under the heads, every row's cells as the phone
 * draws them in the table's default order (the rows that gain, then the rest under the divider, then
 * the Stash group with its line), each row's verb and its drop panel, the pinned verb with the line
 * under it, the arrival line, the phone's basis; and the claim's words (move.ts) for each platform
 * and each outcome, the bid's label and its problem. Written by export-parity.ts beside the others. */
import { BOX, boxNumber } from '../../web/src/lib/league/box/box.ts';
import { drawnText } from '../../web/src/lib/league/box/basis.ts';
import {
	addressedWeek,
	arrivesPart,
	weekProjected
} from '../../web/src/lib/league/box/next-week.ts';
import { stripMark } from '../../web/src/lib/league/box/strip.ts';
import {
	addVerbWords,
	beatsPlace,
	beatsWeekWord,
	beatsWord,
	cardGains,
	cardName,
	copiedWords,
	DEFAULT_SORT,
	dropLead,
	dropRows,
	dropTitle,
	dropWhyWords,
	gainGroups,
	gainWord,
	headBasis,
	headBasisText,
	moveWords,
	namesOnScreen,
	pickupCards,
	pickupSum,
	pickupsTitle,
	poolRows,
	sameWeekGain,
	sortRows,
	stashBasis,
	stashRows,
	STASH,
	stripDecision,
	WAIVERS,
	waiverBasis,
	withDrop,
	type PoolRow
} from '../../web/src/lib/league/box/waivers.ts';
import type { LeagueHost } from '../../web/src/lib/league/api.ts';
import type {
	HostBid,
	HostMoveResult,
	WaiverAdvice
} from '../../web/src/lib/league/inseason/api.ts';
import {
	bidLabel,
	bidProblem,
	claimsAdd,
	claimsOnHost,
	hostSaid,
	lostWords,
	moveTitle,
	openHostWords,
	readingWords,
	resultWords,
	settingWords
} from '../../web/src/lib/league/inseason/move.ts';
import { LINES, verbWords } from '../../web/src/lib/league/inseason/words.ts';
import { cells } from './lineup-parity.ts';

export const WAIVERS_OUTPUT = 'shared/fixtures/parity/waivers.json';

/** One row as the phone's table draws it: the box row's cells (lineup-parity's), the evidence line
 * with A game after it, the clearing day, the Stash row's week in place of his game, the Beats cell,
 * the row's verb and whether it gains. */
function rowOf(entry: PoolRow, advice: WaiverAdvice, host: LeagueHost): unknown {
	const stash = entry.stash;
	const box = cells(null, entry.row, stash === null ? null : 'slot');
	const more = `${WAIVERS.rest} ${boxNumber(entry.rest)}`;
	return {
		...box,
		evidence: `${box.evidence}, ${more}`,
		rest: boxNumber(entry.rest),
		clears: entry.clears,
		away: stash?.back ?? null,
		named: entry.named,
		gains: entry.gains,
		beats:
			stash === null
				? {
						who:
							entry.beats.who === null
								? null
								: { name: entry.beats.who.name, place: beatsPlace(entry.beats.who) },
						figure: beatsWord(entry.beats),
						loud: entry.gains && (entry.beats.gain ?? 0) > 0,
						week: entry.beats.week === null ? null : beatsWeekWord(entry.beats.week)
					}
				: { who: stash.who, figure: null, loud: false, week: null },
		// The row's own button: the platform's page for a stash an open IR slot takes with no drop, else
		// the drop panel opened by Add or Stash.
		button: stash?.verb === 'stash' ? STASH.verb : LINES.add,
		opensPage: stash?.verb === 'stash' && !stash.drops,
		verb: addVerbWords(advice.moves, entry.source.add.player.host_id, host),
		claimsHere: claimsAdd(advice.moves, entry.source.add.player.host_id)
	};
}

/** A row's drop panel: its title and lead, each drop's cells, Gain and week, and the pair the verb
 * makes with the first drop chosen. */
function dropsOf(entry: PoolRow, advice: WaiverAdvice, zone: string, now: number): unknown {
	const drops = dropRows(entry.source, advice.roster, zone, now);
	const week = sameWeekGain(drops);
	const names = namesOnScreen(advice);
	const first = drops[0] ?? null;
	const pair = withDrop(entry.source, first);
	return {
		title: dropTitle(entry.row.name),
		lead: dropLead(week),
		rows: drops.map((d) => ({
			key: d.key,
			cells: cells(null, d.row, d.row.reserve && d.starter === null ? 'bench' : null),
			evidence: `${cells(null, d.row, null).evidence}, ${WAIVERS.rest} ${boxNumber(d.rest)}`,
			gain: gainWord(d.gain),
			week: week === null && d.weekGain !== null ? `${gainWord(d.weekGain)} ${BOX.proj}` : null,
			starter: d.starter === null ? null : d.starter.mark
		})),
		pair: moveWords({
			add: cardName(pair.add.player.name, names),
			drop: first === null ? null : cardName(first.row.name, names)
		})
	};
}

/** The Waivers at one clock, as the web's phone draws it. */
export function waiversAt(
	advice: WaiverAdvice,
	host: LeagueHost,
	now: string,
	zone: string
): unknown {
	const at = Date.parse(now);
	const pool = poolRows(advice, zone, at);
	const sorted = sortRows(pool, DEFAULT_SORT);
	const groups = gainGroups(sorted);
	const stash = sortRows(stashRows(advice, zone, at), DEFAULT_SORT);
	const cards = pickupCards(advice);
	const names = namesOnScreen(advice);
	const card = cards[0] ?? null;
	const lines = [...advice.rows.map((r) => r.add), ...advice.roster];
	const sum = pickupSum(advice, cards);
	return {
		now,
		week: addressedWeek(advice),
		title: pickupsTitle(cards.length),
		decision: stripDecision(cards),
		sum,
		cards: cards.map((c, i) => ({
			key: c.key,
			slot: c.slot,
			mark: stripMark(i, cards.length),
			move: moveWords(c),
			why: dropWhyWords(c.dropWhy),
			gains: cardGains(c),
			verb: addVerbWords(advice.moves, c.source.add.player.host_id, host)
		})),
		projected: weekProjected(advice),
		arrives: arrivesPart(advice, addressedWeek(advice), zone),
		heads: headBasisText(
			headBasis(advice.projection_previous_read_at, weekProjected(advice), { zone, zoned: false })
		),
		gaining: groups.gaining.map((e) => rowOf(e, advice, host)),
		rest: groups.rest.map((e) => rowOf(e, advice, host)),
		stash: stash.map((e) => rowOf(e, advice, host)),
		stashLine: stashBasis(advice),
		drops: Object.fromEntries(
			[...sorted.slice(0, 3), ...stash].map((e) => [e.key, dropsOf(e, advice, zone, at)])
		),
		onHost: claimsOnHost(advice),
		pinned: {
			verb: card === null ? null : addVerbWords(advice.moves, card.source.add.player.host_id, host),
			line: advice.moves.reason ?? advice.host_note ?? advice.moves.note ?? '',
			url: advice.host_waivers_url
		},
		copied:
			card === null ? null : copiedWords(host, cardName(card.source.add.player.name, names), true),
		copyFailed:
			card === null ? null : copiedWords(host, cardName(card.source.add.player.name, names), false),
		basis: drawnText(waiverBasis(advice, lines, { zone, zoned: false }, at), 'phone')
	};
}

/** A claim's outcomes as the API words them, for the words built over them: the fixture's three
 * and a pending claim with no time the platform runs it. */
function results(claims: readonly HostMoveResult[]): HostMoveResult[] {
	const pending = claims.find((r) => r.outcome === 'pending');
	return pending === undefined ? [...claims] : [...claims, { ...pending, processes_at: null }];
}

/** The bids the label and the problem are held to. */
const BIDS: readonly HostBid[] = [
	{ amount: 0, min: 0, max: 87, left_known: true },
	{ amount: 1, min: 1, max: 1000, left_known: false }
];
const TYPED = ['', '0', '5', '87', '88', '1.5', 'abc', ' 12 '];

/** The claim's words (move.ts) for each platform: the panel's title, the verb, its reading and
 * sending lines, the platform's page, a claim that never answered, each outcome's line in the zone
 * with the platform's own words under a refusal; and the bid's label and its problem for each typed
 * bid. */
export function claimWords(claims: readonly HostMoveResult[], zone: string): unknown {
	const hosts: readonly LeagueHost[] = ['espn', 'mfl', 'sleeper', 'yahoo', 'ffpc'];
	return {
		title: moveTitle('claim'),
		hosts: hosts.map((host) => ({
			host,
			verb: verbWords('waivers', host),
			reading: readingWords(host, 'claim'),
			setting: settingWords(host, 'claim'),
			open: openHostWords(host),
			lost: lostWords(host, 'claim'),
			results: results(claims).map((result) => ({
				outcome: result.outcome,
				sentence: result.sentence,
				processesAt: result.processes_at,
				hostWords: result.host_words,
				words: resultWords(host, result, zone),
				said: result.host_words === null ? null : hostSaid(host, result.host_words)
			})),
			bids: BIDS.map((bid) => ({
				bid,
				label: bidLabel(bid),
				problems: TYPED.map((typed) => ({ typed, problem: bidProblem(host, typed, bid) }))
			}))
		}))
	};
}
