/** The player page's rest-of-season figures on one clock (Lane 86, re-review N1): the run's until the
 * read answers, then the read's alone, a figure it lacks null (the page prints the empty figure), so no
 * box or column mixes the run's clock with the read's. Imports nothing; the page loads it with the read
 * (Lane 234: the player page's script budget). */
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import type { LiveFormats, LiveTier } from './week-words.ts';

/** A tier box player as the box draws him: his figure, his rank (null for none) and his weeks where they
 * are not the page's player's. */
interface DrawnMate {
	id: string;
	projected: number | null;
	positionRank: number | null;
	span: string | null;
}

/** Ranked players in their order, an unranked one after them. */
function byRank(a: number | null, b: number | null): number {
	if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
	return a - b;
}

/** The tier box's players: each one's live figure once the read has answered, and with an answer that
 * ranks them his rank and his weeks as the read says them, in the order of those ranks (Lane 162, D02
 * and D03: the box sorts by the number its head reads, a player unranked last). */
export function matesAt<M extends DrawnMate>(
	mates: readonly M[],
	live: LiveTier | null
): (Omit<M, keyof DrawnMate> & DrawnMate)[] {
	if (live === null) return [...mates];
	const drawn = mates.map((mate) => ({
		...mate,
		projected: live.points[mate.id] ?? null,
		positionRank: live.ranks === null ? mate.positionRank : (live.ranks[mate.id] ?? null),
		span: live.spans === null ? mate.span : (live.spans[mate.id] ?? null)
	}));
	if (live.ranks === null) return drawn;
	return drawn.toSorted((a, b) => byRank(a.positionRank, b.positionRank));
}

/** The tier's drop to the next: the live one once the read has answered. */
export function cliffAt(
	cliff: TierCliff | null,
	live: LiveTier | null
): (Omit<TierCliff, 'drop'> & { drop: number | null }) | null {
	if (cliff === null || live === null) return cliff;
	return { ...cliff, drop: live.drop };
}

/** One every-format line's points and Over repl.: the read's once it has answered. */
export function lineFiguresAt(
	run: { points: number; vor: number | null },
	format: BoardFormat | null,
	live: LiveFormats | null
): { points: number | null; vor: number | null } {
	if (live === null) return run;
	const read = format === null ? undefined : live.figures[format];
	return read ?? { points: null, vor: null };
}

/** The read's rank for the every-format table: his place at his position in the format the read is
 * in, the head's. The table takes it only on the read that switched its figures (`LiveFormats`), never
 * on a read that left the run's figures in place (Lane 220 review H1). */
export interface RankRead {
	format: BoardFormat | null;
	positionRank: number | null;
}

/** Why the table's footnote names a format whose rank cell reads none: an answer from before the
 * per-format ranks places him in its own format alone (`unread`); our order in that format does not
 * place him (`unplaced`). */
export type UnrankedReason = 'unread' | 'unplaced';

/** The every-format table's rank column on the table's one clock (Lane 220, B184; review H1; Lane 234,
 * B206 and B211): while the figures are the run's (no read, or a read with no figures for the table),
 * every rank is the run's; once the read's figures stand, each format takes the read's position rank
 * in it, from the same answer as its figures (`LiveFormats.ranks`), none where the order does not place
 * him. An answer from before those ranks (the deploy window) gives the read's format the head's rank
 * and the others none. `unranked` is the labels of the lines that show none, for the table's one
 * footnote, never the read's own format (the head says why it has none) and none at all for a player
 * on a season-long list, whose cells say his list. */
export function lineRanksAt(
	lines: readonly { run: number; format: BoardFormat | null; label: string }[],
	figures: LiveFormats | null,
	read: RankRead | null,
	listed: boolean
): { ranks: (number | null)[]; unranked: string[]; reason: UnrankedReason } {
	const reason: UnrankedReason = figures?.ranks == null ? 'unread' : 'unplaced';
	if (figures === null || read === null)
		return { ranks: lines.map((line) => line.run), unranked: [], reason };
	const own = (format: BoardFormat | null): boolean => format !== null && format === read.format;
	const ranks = lines.map(({ format }) => {
		if (format === null) return null;
		if (figures.ranks === null) return own(format) ? read.positionRank : null;
		return figures.ranks[format] ?? null;
	});
	const unranked = listed
		? []
		: lines.filter((line, i) => ranks[i] === null && !own(line.format)).map((line) => line.label);
	return { ranks, unranked, reason };
}
