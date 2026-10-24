/** Each prerendered page's head built at prerender from the page's own facts (Lane 169, rulings 1 to
 * 3): its description from the word table (site/head-words.ts), its canonical path, its share card
 * and its structured data, as the markup the page prints (site/head.ts headMarkup). The pages carry
 * the string, so no page's script builds a sentence or a tag. */
import { resolve } from '$app/paths';
import { BUILD_ZONE } from '#lib/format/day-time.ts';
import { isFreeAgent } from '#lib/format/free-agent.ts';
import type { LegalDoc } from '#lib/legal/legal-doc.ts';
import type { Club, Format, RunRecord } from '#lib/run/schema.ts';
import type { PlayerSeason } from '#lib/run/season.ts';
import { recordLead } from '#lib/run/record.ts';
import { RECORDS_WORDS } from '#lib/run/records.ts';
import type { Position } from '#lib/types/player.ts';
import { absentWords } from '#lib/site/absent.ts';
import { ERROR_WORDS } from '#lib/site/error-words.ts';
import { headMarkup, pageMeta, siteUrl, type HeadMarkup, type PageMeta } from '#lib/site/head.ts';
import { HEAD_WORDS, type BoardFacts, type WeekGame } from '#lib/site/head-words.ts';
import { links } from '#lib/site/links.ts';
import {
	datasetData,
	itemListData,
	organizationData,
	personData
} from '#lib/site/structured-data.ts';
import { headshotAt } from '#lib/ui/headshot.ts';
import { weekAhead } from './player-card.ts';

/** The width of a player's face in his structured data: the image route's widest. */
const FACE_WIDTH = 480;

/** A page's head as it prints, its defaults said once (site/head.ts pageMeta). */
function built(
	description: string,
	path: string | null,
	more: Partial<Omit<PageMeta, 'description' | 'path'>> = {}
): HeadMarkup {
	return headMarkup(pageMeta(description, path, more));
}

/** A board's facts from the run's format and season. */
export function boardFacts(format: Format, season: number): BoardFacts {
	return {
		season,
		label: format.label,
		teams: format.teams,
		rest: format.rosFromWeek !== undefined
	};
}

export function frontHead(format: Format, season: number): HeadMarkup {
	return built(HEAD_WORDS.front(season, format.label), resolve('/(run)'), {
		structured: organizationData()
	});
}

/** His club's city and nickname, from the run's clubs. */
function clubName(clubs: readonly Club[], abbr: string): string {
	const club = clubs.find((candidate) => candidate.abbr === abbr);
	if (!club) throw new Error(`${abbr} is not among the run's clubs.`);
	return `${club.city} ${club.nickname}`;
}

/** His week ahead, the card's (player-card.ts weekAhead): the game with its opponent named, or his bye.
 * A week before the one the board ranks from is passed over for his first game or bye from it, so his
 * line never names a week the rankings page has left behind when his log lags the run (fix round 1,
 * L2). */
function weekGame(
	season: PlayerSeason | null,
	clubs: readonly Club[],
	fromWeek: number | undefined
): WeekGame | null {
	const ahead = season === null ? null : weekAhead(season);
	const row =
		season !== null && ahead !== null && fromWeek !== undefined && ahead.week < fromWeek
			? (season.log.find(
					(entry) =>
						entry.week >= fromWeek &&
						(entry.status === 'bye' || (entry.status === 'upcoming' && entry.opponent !== null))
				) ?? null)
			: ahead;
	if (row === null) return null;
	if (row.opponent === null) return { kind: 'bye', week: row.week };
	return {
		kind: 'game',
		week: row.week,
		home: row.home === true,
		opponent: clubName(clubs, row.opponent)
	};
}

/** What a player's page is built from that his head reads. */
export interface PlayerHeadSource {
	slug: string;
	name: string;
	position: Position;
	team: string;
	headshot: string;
	season: PlayerSeason | null;
	/** His place at his position in the lead format, null while he is on a season-long list. */
	positionRank: number | null;
	lead: Format;
	year: number;
}

/** His description sentence, on its own for the persona panel and the shots. */
export function playerDescription(player: PlayerHeadSource, clubs: readonly Club[]): string {
	return HEAD_WORDS.player({
		name: player.name,
		position: player.position,
		club: isFreeAgent(player.team) ? null : clubName(clubs, player.team),
		positionRank: player.positionRank,
		season: player.year,
		label: player.lead.label,
		rest: player.lead.rosFromWeek !== undefined,
		game: weekGame(player.season, clubs, player.lead.rosFromWeek)
	});
}

export function playerHead(player: PlayerHeadSource, clubs: readonly Club[]): HeadMarkup {
	const path = links.player(player.slug);
	const face = headshotAt(player.headshot, FACE_WIDTH);
	return built(playerDescription(player, clubs), path, {
		type: 'profile',
		card: 'player',
		structured: personData({
			name: player.name,
			position: player.position,
			club: isFreeAgent(player.team) ? null : clubName(clubs, player.team),
			path,
			image: face === null ? null : siteUrl(face)
		})
	});
}

/** The rankings page's sentence (Players before the season). */
export function rankingsDescription(format: Format, season: number, week?: number): string {
	return week === undefined
		? HEAD_WORDS.players(season, format.label)
		: HEAD_WORDS.rankings(season, week);
}

/** The rankings page: its sentence and the top of its order. */
export function rankingsHead(
	format: Format,
	season: number,
	week: number | undefined,
	ordered: readonly { name: string; slug: string; ourRank: number }[]
): HeadMarkup {
	return built(rankingsDescription(format, season, week), links.players(), {
		structured: itemListData(
			HEAD_WORDS.rankingsList(season),
			ordered.map((player) => ({
				name: player.name,
				path: links.player(player.slug),
				rank: player.ourRank
			}))
		)
	});
}

/** An instant's day in the site's zone, "2026-09-10": a Thursday night kickoff is Thursday's. */
function zoneDay(iso: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: BUILD_ZONE }).format(new Date(iso));
}

/** What the record grades, one sentence: both records once the run carries the weekly one, else the
 * draft board's weeks as the page's lead says them. */
export function recordDescription(record: RunRecord, label: string): string {
	return record.weekly === undefined
		? HEAD_WORDS.recordDraft(record.season, recordLead(record, label))
		: HEAD_WORDS.recordWeekly(
				record.season,
				label,
				RECORDS_WORDS.weeklyWhat,
				RECORDS_WORDS.draftWhat
			);
}

/** The record: what it grades, over the season's first kickoff to the run's day. */
export function recordHead(
	record: RunRecord,
	format: Format,
	dates: { firstKickoff: string; runAt: string }
): HeadMarkup {
	const description = recordDescription(record, format.label);
	const path = links.record();
	return built(description, path, {
		structured: datasetData({
			name: HEAD_WORDS.recordName(record.season),
			description,
			from: zoneDay(dates.firstKickoff),
			through: zoneDay(dates.runAt),
			path
		})
	});
}

export function boardHead(
	format: Format,
	season: number,
	position: Position | null,
	positions: readonly Position[],
	inSeason: boolean
): HeadMarkup {
	const board = boardFacts(format, season);
	return built(
		position === null
			? HEAD_WORDS.board(board, positions)
			: HEAD_WORDS.boardPosition(board, position, inSeason),
		links.board(format.id, position)
	);
}

export function adpHead(format: Format, season: number, gap: boolean): HeadMarkup {
	return built(HEAD_WORDS.adp(boardFacts(format, season), gap), links.adp(format.id));
}

/** A format page for a format the run lacks: kept out of search, it says only that. */
export function absentHead(label: string, path: string): HeadMarkup {
	return built(`${absentWords(label, '', []).title}.`, path, { noindex: true });
}

export function clubsHead(format: Format, season: number): HeadMarkup {
	return built(HEAD_WORDS.clubs(boardFacts(format, season)), links.clubs());
}

export function clubHead(club: Club, format: Format, season: number): HeadMarkup {
	return built(
		HEAD_WORDS.club(`${club.city} ${club.nickname}`, boardFacts(format, season)),
		links.club(club.abbr)
	);
}

export function scheduleHead(season: number): HeadMarkup {
	return built(HEAD_WORDS.schedule(season), links.schedule());
}

/** A legal page: its own lead is its sentence. */
export function legalHead(doc: LegalDoc, path: string): HeadMarkup {
	return built(doc.lead, path);
}

/** The free season's page, in the words it paints at the build's clock. */
export function passHead(description: string): HeadMarkup {
	return built(description, links.pass());
}

/** The pages whose head names no run fact: the user pages whose shell is prerendered, the compare
 * page before two players are chosen, the offline board and the not-found page. A member's own page,
 * a page with nothing public until the browser fills it, the offline copy and the not-found page,
 * served at any address, are kept out of search. */
export const STATIC_HEADS = {
	sheet: (): HeadMarkup => built(HEAD_WORDS.sheet, links.sheet()),
	print: (): HeadMarkup => built(HEAD_WORDS.print, resolve('/sheet/print'), { noindex: true }),
	account: (): HeadMarkup => built(HEAD_WORDS.account, links.account(), { noindex: true }),
	compare: (): HeadMarkup => built(HEAD_WORDS.compare, links.compare(), { noindex: true }),
	offline: (): HeadMarkup => built(HEAD_WORDS.offline, resolve('/offline'), { noindex: true }),
	appSignedIn: (): HeadMarkup =>
		built(HEAD_WORDS.appSignedIn, resolve('/app/signed-in'), { noindex: true }),
	notFound: (): HeadMarkup => built(ERROR_WORDS.notFound.lead, null, { noindex: true })
} as const;
