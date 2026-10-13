/**
 * Tiers on your sheet are drawn within each position, the way the board draws ours: a WR's tier
 * counts among WRs only. A position either has no tiers (every row null) or every row of it has
 * one, never lower than the WR above him, numbered from 1 with no gaps. One tier is no tiers.
 * The All view shows a tier as a chip, a position view draws the strips you drag.
 */
import type { Position } from '#lib/types/player.ts';
import { SHEET_LIMITS } from './limits.ts';

/** The part of a row tiers read and write. */
export interface Tiered {
	id: string;
	position: Position;
	tier: number | null;
}

function indicesOf(rows: readonly Tiered[], position: Position): number[] {
	const out: number[] = [];
	rows.forEach((row, index) => {
		if (row.position === position) out.push(index);
	});
	return out;
}

/** The tiers one position's rows should carry, from what they carry now. */
function repairedTiers(tiers: readonly (number | null)[]): readonly (number | null)[] {
	if (tiers.every((tier) => tier === null)) return tiers;
	let previousRaw = 0;
	let current = 0;
	const out = tiers.map((raw) => {
		const value = Math.max(raw ?? previousRaw, previousRaw);
		if (value > previousRaw || current === 0) current += 1;
		previousRaw = value;
		return Math.min(current, SHEET_LIMITS.tier);
	});
	return current <= 1 ? out.map(() => null) : out;
}

function writeTiers<T extends Tiered>(
	rows: readonly T[],
	indices: readonly number[],
	tiers: readonly (number | null)[]
): readonly T[] {
	const byIndex = new Map(indices.map((rowIndex, k) => [rowIndex, tiers[k] ?? null]));
	return rows.map((row, index) =>
		byIndex.has(index) && byIndex.get(index) !== row.tier
			? { ...row, tier: byIndex.get(index) ?? null }
			: row
	);
}

const positionsOf = (rows: readonly Tiered[]): Set<Position> =>
	new Set(rows.map((row) => row.position));

/** Every position's tiers made whole again after a move, an add, a removal or a merge: a row
 * without one joins the tier above him, a row below a lower tier rises to it, gaps close up. */
export function repairTiers<T extends Tiered>(rows: readonly T[]): readonly T[] {
	let out = rows;
	for (const position of positionsOf(rows)) {
		const indices = indicesOf(out, position);
		out = writeTiers(out, indices, repairedTiers(indices.map((index) => out[index]?.tier ?? null)));
	}
	return out;
}

interface Place {
	indices: number[];
	tiers: (number | null)[];
	/** His place among his position's rows. */
	at: number;
}

function placeOf(rows: readonly Tiered[], playerId: string): Place | null {
	const row = rows.find((candidate) => candidate.id === playerId);
	if (!row) return null;
	const indices = indicesOf(rows, row.position);
	const at = indices.findIndex((index) => rows[index]?.id === playerId);
	return { indices, tiers: indices.map((index) => rows[index]?.tier ?? null), at };
}

/** Whether a new tier can start at him: he is not first at his position, he does not already
 * start one, and his position has room for another. */
export function canStartTierAt(rows: readonly Tiered[], playerId: string): boolean {
	const place = placeOf(rows, playerId);
	if (!place || place.at <= 0) return false;
	const { tiers, at } = place;
	if (tiers[at] === null) return true;
	const top = Math.max(...tiers.map((tier) => tier ?? 0));
	return tiers[at] === tiers[at - 1] && top < SHEET_LIMITS.tier;
}

/** A new tier starting at him, within his position. */
export function startTierAt<T extends Tiered>(rows: readonly T[], playerId: string): readonly T[] {
	if (!canStartTierAt(rows, playerId)) return rows;
	const place = placeOf(rows, playerId);
	if (!place) return rows;
	const { indices, tiers, at } = place;
	const next = tiers.map((tier, k) => (tier ?? 1) + (k >= at ? 1 : 0));
	return repairTiers(writeTiers(rows, indices, next));
}

/** Whether he starts a tier below the first. */
export function startsTier(rows: readonly Tiered[], playerId: string): boolean {
	const place = placeOf(rows, playerId);
	if (!place || place.at <= 0) return false;
	const { tiers, at } = place;
	return tiers[at] !== null && tiers[at] !== tiers[at - 1];
}

/** The tier that starts at him joins the one above it. */
export function removeTierAt<T extends Tiered>(rows: readonly T[], playerId: string): readonly T[] {
	if (!startsTier(rows, playerId)) return rows;
	const place = placeOf(rows, playerId);
	if (!place) return rows;
	const { indices, tiers, at } = place;
	const next = tiers.map((tier, k) => (tier ?? 1) - (k >= at ? 1 : 0));
	return repairTiers(writeTiers(rows, indices, next));
}

/** Where the tier starting at a row can move to, as places among his position's rows: after the
 * start of the tier above and no further than the last row of his own tier. */
export function tierStartRange(
	rows: readonly Tiered[],
	playerId: string
): { first: number; last: number } | null {
	if (!startsTier(rows, playerId)) return null;
	const place = placeOf(rows, playerId);
	if (!place) return null;
	const { tiers, at } = place;
	const own = tiers[at];
	const above = tiers[at - 1];
	const first = tiers.findIndex((tier) => tier === above) + 1;
	const lastOfOwn = tiers.findLastIndex((tier) => tier === own);
	return { first, last: lastOfOwn };
}

/** The tier starting at `playerId` starts instead at the row `to` places down his position's list
 * (0 is the position's first row), clamped to tierStartRange. */
export function moveTierStart<T extends Tiered>(
	rows: readonly T[],
	playerId: string,
	to: number
): readonly T[] {
	const range = tierStartRange(rows, playerId);
	const place = placeOf(rows, playerId);
	if (!range || !place) return rows;
	const { indices, tiers, at } = place;
	const target = Math.max(range.first, Math.min(range.last, to));
	if (target === at) return rows;
	const upper = tiers[at - 1] ?? 1;
	const own = tiers[at] ?? upper + 1;
	const next = tiers.map((tier, k) => {
		if (target > at && k >= at && k < target) return upper;
		if (target < at && k >= target && k < at) return own;
		return tier;
	});
	return repairTiers(writeTiers(rows, indices, next));
}

/** A run of one position's rows sharing a tier, in order. */
export interface TierRun {
	tier: number;
	/** The id of the row the tier starts at. */
	startId: string;
	count: number;
}

/** The runs of tiers down one position's rows, or none when the position has no tiers. */
export function tierRuns(positionRows: readonly Tiered[]): readonly TierRun[] {
	const runs: TierRun[] = [];
	for (const row of positionRows) {
		if (row.tier === null) return [];
		const last = runs.at(-1);
		if (last?.tier === row.tier) {
			runs[runs.length - 1] = { ...last, count: last.count + 1 };
		} else {
			runs.push({ tier: row.tier, startId: row.id, count: 1 });
		}
	}
	return runs;
}
