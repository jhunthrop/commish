/** The player page's rest-of-season figures on one clock (Lane 86, re-review N1): the run's until the
 * read answers, then the read's alone, a figure it lacks null (the page prints the empty figure), so no
 * box or column mixes the run's clock with the read's. Imports nothing: the page carries it. */
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
 * in. The table takes it only on the read that switched its figures (`LiveFormats`), never on a read
 * that left the run's figures in place (Lane 220 review H1). */
export interface RankRead {
	format: BoardFormat | null;
	positionRank: number | null;
}

/** The every-format table's rank column on the table's one clock (Lane 220, B184; review H1): while
 * the figures are the run's (no read, or a read with no figures for the table), every rank is the
 * run's; once the read's figures stand, the read's format takes the head's rank and every other format
 * shows none, as the read places him in its own format alone (the per-format rank is an API field
 * still to come, B206). `unranked` is the labels of the lines that show none, for the table's one
 * footnote. */
export function lineRanksAt(
	lines: readonly { run: number; format: BoardFormat | null; label: string }[],
	figures: LiveFormats | null,
	read: RankRead | null
): { ranks: (number | null)[]; unranked: string[] } {
	if (figures === null || read === null)
		return { ranks: lines.map((line) => line.run), unranked: [] };
	const ranks = lines.map((line) =>
		line.format !== null && line.format === read.format ? read.positionRank : null
	);
	return { ranks, unranked: lines.filter((_, i) => ranks[i] === null).map((line) => line.label) };
}
