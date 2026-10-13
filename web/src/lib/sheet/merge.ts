/**
 * How this browser's sheet and the account's become one sheet when both changed since they last
 * agreed. A three-way merge against the ancestor this browser keeps: the sheet as the account held
 * it at the last successful sync (storage.ts `base`).
 *
 * - A player in the ancestor and missing on either side was removed there, and stays removed.
 * - A player not in the ancestor was added on whichever side has him, and is kept.
 * - A field (a player's tags, his note, the sheet's name, the order) changed on one side only
 *   takes that side's value. Changed on both sides to different values, the account's copy stands
 *   and the page says what this browser's value was ("Your note on X was replaced by the one saved
 *   on another device").
 * - Tiers travel with the order: they come from the side whose order stands, and are made whole
 *   within each position after (tiers.ts), so an added player joins the tier above him.
 *
 * A replace in this browser (an import, a pasted list, our board) is this side's edit like any
 * other: the ancestor's players it dropped are removals, its new players are additions. When the
 * account has not changed since the ancestor, sync.ts writes this browser's copy as it is and never
 * calls this.
 */
import { SHEET_LIMITS } from './limits.ts';
import type { Sheet, SheetRow } from './model.ts';
import { repairTiers } from './tiers.ts';

export interface MergeSides {
	/** The sheet both sides last agreed on. */
	ancestor: Sheet;
	/** This browser's copy. */
	local: Sheet;
	/** The account's copy. */
	server: Sheet;
}

export interface MergeResult {
	sheet: Sheet;
	/** One line per conflict the account's copy won, naming what this browser had. */
	notices: readonly string[];
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((tag, index) => tag === b[index]);

/** Who appears where: the side's ids among those also in `other`, in the side's order. */
function relativeOrder(side: Sheet, other: ReadonlySet<string>): readonly string[] {
	return side.rows.filter((row) => other.has(row.id)).map((row) => row.id);
}

function orderChanged(ancestor: Sheet, side: Sheet): boolean {
	const inAncestor = new Set(ancestor.rows.map((row) => row.id));
	const inSide = new Set(side.rows.map((row) => row.id));
	const mine = relativeOrder(side, inAncestor);
	const theirs = relativeOrder(ancestor, inSide);
	return mine.length !== theirs.length || mine.some((id, index) => id !== theirs[index]);
}

/** The value that stands for one field, and whether this browser's value lost a conflict. */
function pick<T>(
	ancestor: T | undefined,
	local: T,
	server: T,
	same: (a: T, b: T) => boolean
): { value: T; overruled: boolean } {
	const localMoved = ancestor === undefined || !same(local, ancestor);
	const serverMoved = ancestor === undefined || !same(server, ancestor);
	if (localMoved && !serverMoved) return { value: local, overruled: false };
	return { value: server, overruled: localMoved && serverMoved && !same(local, server) };
}

function mergeRow(
	ancestor: SheetRow | undefined,
	local: SheetRow,
	server: SheetRow,
	tierFrom: SheetRow,
	notices: string[]
): SheetRow {
	const note = pick(ancestor?.note, local.note, server.note, (a, b) => a === b);
	const tags = pick(ancestor?.tags, local.tags, server.tags, sameTags);
	if (note.overruled) {
		notices.push(`Your note on ${local.name} was replaced by the one saved on another device`);
	}
	if (tags.overruled) {
		notices.push(`Your tags on ${local.name} were replaced by the ones saved on another device`);
	}
	return {
		...server,
		headshot: server.headshot ?? local.headshot,
		team: server.team ?? local.team,
		tier: tierFrom.tier,
		tags: tags.value,
		note: note.value
	};
}

/** The rows of `primary` that stay, then the kept rows only `secondary` has, each slotted in after
 * the player he followed there (at the top if he led it). */
function weave(
	primary: readonly SheetRow[],
	secondary: readonly SheetRow[],
	kept: (id: string) => boolean
): SheetRow[] {
	const out = primary.filter((row) => kept(row.id));
	const placed = new Set(out.map((row) => row.id));
	let anchor = -1;
	for (const row of secondary) {
		if (placed.has(row.id)) {
			anchor = out.findIndex((candidate) => candidate.id === row.id);
			continue;
		}
		if (!kept(row.id)) continue;
		anchor += 1;
		out.splice(anchor, 0, row);
		placed.add(row.id);
	}
	return out;
}

/** One sheet from the ancestor and both sides' copies. */
export function mergeSheets({ ancestor, local, server }: MergeSides): MergeResult {
	const notices: string[] = [];
	const inAncestor = new Map(ancestor.rows.map((row) => [row.id, row]));
	const inLocal = new Map(local.rows.map((row) => [row.id, row]));
	const inServer = new Map(server.rows.map((row) => [row.id, row]));
	const kept = (id: string): boolean =>
		inAncestor.has(id) ? inLocal.has(id) && inServer.has(id) : inLocal.has(id) || inServer.has(id);

	const localOrder = orderChanged(ancestor, local);
	const serverOrder = orderChanged(ancestor, server);
	const orderSide = localOrder && !serverOrder ? local : server;
	const otherSide = orderSide === local ? server : local;
	if (localOrder && serverOrder) {
		const shared = new Set([...inLocal.keys()].filter((id) => inServer.has(id)));
		const a = relativeOrder(local, shared);
		const b = relativeOrder(server, shared);
		if (a.some((id, index) => id !== b[index])) {
			notices.push('Your order was replaced by the one saved on another device');
		}
	}

	const rows = weave(orderSide.rows, otherSide.rows, kept).map((row) => {
		const mine = inLocal.get(row.id);
		const theirs = inServer.get(row.id);
		if (!mine || !theirs) return row;
		const tierFrom = orderSide === local ? mine : theirs;
		return mergeRow(inAncestor.get(row.id), mine, theirs, tierFrom, notices);
	});

	const over = rows.length - SHEET_LIMITS.rows;
	if (over > 0) {
		const left = rows.slice(SHEET_LIMITS.rows).map((row) => row.name);
		notices.push(
			`Your sheet holds at most ${String(SHEET_LIMITS.rows)} players, so ${left.join(', ')} were left off`
		);
	}

	const name = pick(ancestor.name, local.name, server.name, (a, b) => a === b);
	if (name.overruled) {
		notices.push(`Your sheet's name ${local.name} was replaced by the one saved on another device`);
	}
	return {
		sheet: {
			name: name.value,
			format: server.format,
			rows: repairTiers(rows.slice(0, SHEET_LIMITS.rows))
		},
		notices
	};
}

/** Whether two sheets would store the same rows, names and annotations alike. */
export function sameSheet(a: Sheet, b: Sheet): boolean {
	if (a.name !== b.name || a.format !== b.format || a.rows.length !== b.rows.length) return false;
	return a.rows.every((row, index) => {
		const twin = b.rows[index];
		return (
			twin?.id === row.id &&
			twin.tier === row.tier &&
			twin.note === row.note &&
			twin.headshot === row.headshot &&
			sameTags(twin.tags, row.tags)
		);
	});
}
