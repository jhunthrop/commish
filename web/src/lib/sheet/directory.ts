/**
 * Our board as the sheet reads it: every player we rank in a format, best first, with what a sheet
 * row needs. The sheet uses it to start a sheet from our board, to read a pasted list of names, to
 * put faces on an imported file, and to print our rank beside yours. It is fetched only when one
 * of those happens, from the prerendered file data/sheet-board/<format>.json.
 */
import { resolve } from '$app/paths';
import { parsePosition, type BoardFormat, type SheetPlayer } from './model.ts';

export interface DirectoryPlayer extends SheetPlayer {
	/** Our rank on this format's board. */
	rank: number;
	positionRank: number;
}

/** The file's row: short keys, because it is downloaded whole. */
export interface DirectoryEntry {
	i: string;
	n: string;
	p: string;
	t: string | null;
	h: string | null;
	r: number;
	pr: number;
}

export interface PlayerDirectory {
	/** The format's board, or null when we have no board for it. */
	board(format: BoardFormat): Promise<readonly DirectoryPlayer[] | null>;
}

export function toEntry(player: DirectoryPlayer): DirectoryEntry {
	return {
		i: player.id,
		n: player.name,
		p: player.position,
		t: player.team,
		h: player.headshot,
		r: player.rank,
		pr: player.positionRank
	};
}

function fromEntry(entry: DirectoryEntry): DirectoryPlayer | null {
	const position = parsePosition(entry.p);
	if (position === null) return null;
	return {
		id: entry.i,
		name: entry.n,
		position,
		team: entry.t,
		headshot: entry.h,
		rank: entry.r,
		positionRank: entry.pr
	};
}

const NOT_FOUND = 404;

export function boardFileUrl(format: BoardFormat): string {
	return resolve('/data/sheet-board/[format].json', { format });
}

/** The directory over the prerendered files, each fetched once per page. */
export function fileDirectory(fetcher: typeof fetch = fetch): PlayerDirectory {
	const cache = new Map<BoardFormat, Promise<readonly DirectoryPlayer[] | null>>();
	async function load(format: BoardFormat): Promise<readonly DirectoryPlayer[] | null> {
		const response = await fetcher(boardFileUrl(format));
		if (response.status === NOT_FOUND) return null;
		if (!response.ok) throw new Error(`Our ${format} board answered ${String(response.status)}.`);
		const entries: DirectoryEntry[] = await response.json();
		return entries.map(fromEntry).filter((player): player is DirectoryPlayer => player !== null);
	}
	return {
		board(format) {
			let pending = cache.get(format);
			if (!pending) {
				pending = load(format);
				pending.catch(() => cache.delete(format));
				cache.set(format, pending);
			}
			return pending;
		}
	};
}
