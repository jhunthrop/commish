/** Our board as the league page reads it: the run's own board file for the league's format (written
 * at build, data/league-board), each row drawn as the rooms draw a player, with his bye from the
 * league's answer and his season so far from the run. The API sends only the league's own numbers
 * and which players are rostered. */
import { resolve } from '$app/paths';
import type { RoomPlayer } from '#lib/room/model.ts';
import type { LeagueBoardFile } from '#lib/run/league-board.ts';
import type { IndexSeason } from '#lib/run/schema.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';

/** A board player as a league row reads him: the room's player, his page and his season so far. */
export interface LeagueBoardPlayer extends RoomPlayer {
	slug: string;
	season: IndexSeason;
	/** His projection is the board's depth floor at his position: a fill value several players share
	 * below the last one we project, said in words, never as a measured number. */
	belowDepth: boolean;
}

/** How many players at a position must share its lowest projection for it to read as a fill value. */
const FLOOR_SHARED_BY = 3;

/** The players whose projection is their position's floor, shared by FLOOR_SHARED_BY or more. */
function depthFloor(rows: LeagueBoardFile['rows']): ReadonlySet<string> {
	const byPosition = Map.groupBy(rows, (r) => r.position);
	const out = new Set<string>();
	for (const group of byPosition.values()) {
		const floor = Math.min(...group.map((r) => r.projected));
		const atFloor = group.filter((r) => r.projected === floor);
		if (atFloor.length >= FLOOR_SHARED_BY) for (const r of atFloor) out.add(r.id);
	}
	return out;
}

export interface LeagueBoard {
	/** Best first, by points over replacement. */
	players: readonly LeagueBoardPlayer[];
	byId: ReadonlyMap<string, LeagueBoardPlayer>;
	/** The run's basis for the board's numbers, phrase by phrase. */
	basis: string;
	/** The last week whose games are all in, 0 before week 1's: the basis line's "through week 5". */
	seasonThrough: number;
	/** The scoring the season figures are in, as the run names it: "PPR". */
	seasonScoring: string;
	format: BoardFormat;
}

/** The format every run carries, read when the league's own is missing. */
const FALLBACK: BoardFormat = 'ppr';

async function fetchBoard(format: BoardFormat): Promise<LeagueBoardFile | null> {
	const response = await fetch(resolve('/data/league-board/[format].json', { format }));
	return response.ok ? await response.json<LeagueBoardFile>() : null;
}

function playerOf(
	row: LeagueBoardFile['rows'][number],
	byes: Readonly<Record<string, number>>,
	floor: ReadonlySet<string>
): LeagueBoardPlayer {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		position: row.position,
		positionRank: row.positionRank,
		team: row.team,
		headshot: row.headshot,
		adp: row.adp,
		points: row.projected,
		vor: row.vor,
		vorRound: row.vorRound,
		bye: byes[row.team] ?? null,
		season: row.season,
		belowDepth: floor.has(row.id)
	};
}

/** The run's board for the league's format, or PPR's when the run lacks it. */
export async function loadBoard(
	format: BoardFormat,
	byes: Readonly<Record<string, number>>
): Promise<LeagueBoard> {
	const own = await fetchBoard(format);
	const run = own ?? (await fetchBoard(FALLBACK));
	if (run === null) throw new Error('The run carries no board for a league.');
	const floor = depthFloor(run.rows);
	const players = run.rows.map((row) => playerOf(row, byes, floor));
	return {
		players,
		byId: new Map(players.map((p) => [p.id, p] as const)),
		basis: `${run.format.basis.join(', ')}.`,
		seasonThrough: run.season.through,
		seasonScoring: run.season.scoring,
		format: own === null ? FALLBACK : format
	};
}
