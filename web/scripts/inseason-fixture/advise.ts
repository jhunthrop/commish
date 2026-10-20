// The fixture's stand-in for the API's lineup engine (engine.go Lineup), shared by project.ts, which
// writes the recorded week's Lineup, and sunday.ts, which advises the same roster on its Sunday with
// the kicked-off players locked (Lane 79 fix round 2 N1).
import type { LineupAdvice, LineupSlot, PlayerLine } from '../../src/lib/league/inseason/api.ts';
import { accepts, better, printedProj, tierOf } from './week.ts';

/** The fixture's injured reserve player, held apart from the lineup. */
export const IN_RESERVE = 'Tank Bigsby';

/** A player whose game has kicked off: ESPN and the engine hold him where the host has him. */
export type Locked = (line: PlayerLine) => boolean;

/** A change's sentence as the API words it (sentences.go): the bye that forces it, else the Proj. */
function changeWords(ours: PlayerLine, host: PlayerLine | null): string {
	const last = (l: PlayerLine): string => l.player.name.trim().split(/\s+/).at(-1) ?? l.player.name;
	if (host === null) return `This spot is empty in your lineup, so ${last(ours)} takes it.`;
	if (host.facts.bye) return `${host.player.name} is on bye this week, so ${last(ours)} starts.`;
	const a = printedProj(ours);
	const b = printedProj(host);
	if (a !== null && b !== null && a > b) {
		return `${last(ours)} has ${a.toFixed(1)} Proj this week against ${last(host)}'s ${b.toFixed(1)}.`;
	}
	return `${last(ours)} is ahead of ${last(host)} in our rest-of-season order.`;
}

/** The lineup advised by the week's order (engine.go Lineup): a host starter whose game has kicked
 * off stays in his spot and a benched one stays benched (`locked`); every other spot takes a player
 * from the active roster who can play (the position's own slots first, then the flex), each host
 * starter kept in his own spot, a change paired with the host's starter it sits in that spot or of
 * his position, and a spot no one who can play fills keeps the member's player, marked. */
export function advise(advice: LineupAdvice, locked: Locked = () => false): LineupAdvice {
	const hostAt = advice.slots.map((s) => s.host);
	const seen = new Set<string>();
	const pool = [
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench
	]
		.filter((l) => {
			if (seen.has(l.player.host_id)) return false;
			seen.add(l.player.host_id);
			return true;
		})
		.filter((l) => l.player.name !== IN_RESERVE);
	const order = [...pool].sort(better);
	const kinds = advice.slots.map((s) => s.slot);
	// A host starter whose game has kicked off holds his spot (engine.go: ours = host, not open).
	const held = hostAt.map((h) => (h !== null && locked(h) ? h : null));
	const chosen = new Set(held.flatMap((h) => (h ? [h.player.host_id] : [])));
	const open = kinds.filter((_, i) => held[i] === null);
	const pick = (slot: LineupSlot['slot']): void => {
		// A player who cannot play this week never starts, nor a benched one whose game has kicked off
		// (the API's rule, engine.go).
		const best = order.find(
			(l) =>
				tierOf(l) === 0 &&
				!locked(l) &&
				!chosen.has(l.player.host_id) &&
				accepts(slot, l.player.position)
		);
		if (best) chosen.add(best.player.host_id);
	};
	open.filter((k) => k !== 'FLEX').forEach(pick);
	open.filter((k) => k === 'FLEX').forEach(pick);
	const placed: (PlayerLine | null)[] = kinds.map((kind, i) => {
		const h = hostAt[i];
		if (held[i]) return held[i];
		return h && chosen.has(h.player.host_id) && accepts(kind, h.player.position) ? h : null;
	});
	const hostIds = new Set(hostAt.flatMap((h) => (h ? [h.player.host_id] : [])));
	const fresh = order.filter((l) => chosen.has(l.player.host_id) && !hostIds.has(l.player.host_id));
	const keptIds = new Set(placed.flatMap((l) => (l ? [l.player.host_id] : [])));
	const stray = order.filter(
		(l) =>
			chosen.has(l.player.host_id) &&
			hostIds.has(l.player.host_id) &&
			!keptIds.has(l.player.host_id)
	);
	for (const l of [...fresh, ...stray]) {
		const at = placed.findIndex(
			(p, i) => p === null && accepts(kinds[i] ?? 'FLEX', l.player.position)
		);
		if (at >= 0) placed[at] = l;
	}
	// A spot no one who can play fills keeps the member's player there, marked (keepWhereNoOneCanPlay),
	// unless a player who can play this week would take it but has kicked off: the spot is held, no
	// mark (advice.go heldNotIdle, Lane 99 fix round 1).
	const idle = new Set<string>();
	const lockedOut = (kind: LineupSlot['slot']): boolean =>
		pool.some(
			(l) =>
				tierOf(l) === 0 &&
				locked(l) &&
				!chosen.has(l.player.host_id) &&
				!hostAt.some((h) => h?.player.host_id === l.player.host_id) &&
				accepts(kind, l.player.position)
		);
	placed.forEach((p, i) => {
		const h = hostAt[i];
		if (p === null && h && !chosen.has(h.player.host_id)) {
			placed[i] = h;
			chosen.add(h.player.host_id);
			if (!lockedOut(kinds[i] ?? 'FLEX')) idle.add(h.player.host_id);
		}
	});
	// Then any member's starter left over, into any empty spot that takes him (review N1).
	placed.forEach((p, i) => {
		if (p !== null) return;
		const h = hostAt.find(
			(l) => l && !chosen.has(l.player.host_id) && accepts(kinds[i] ?? 'FLEX', l.player.position)
		);
		if (h) {
			placed[i] = h;
			chosen.add(h.player.host_id);
			idle.add(h.player.host_id);
		}
	});
	const sat = hostAt.filter((h): h is PlayerLine => h !== null && !chosen.has(h.player.host_id));
	const slots = advice.slots.flatMap((slot, i): LineupSlot[] => {
		const ours = placed[i];
		if (!ours) return [];
		if (hostIds.has(ours.player.host_id)) {
			return [
				{
					slot: slot.slot,
					ours,
					host: ours,
					changed: false,
					no_one_can_play: idle.has(ours.player.host_id),
					sentence: null
				}
			];
		}
		const own = hostAt[i];
		const host =
			own && sat.includes(own)
				? own
				: (sat.find((l) => l.player.position === ours.player.position) ?? sat[0] ?? null);
		if (host) sat.splice(sat.indexOf(host), 1);
		return [
			{
				slot: slot.slot,
				ours,
				host,
				changed: true,
				no_one_can_play: false,
				sentence: changeWords(ours, host)
			}
		];
	});
	const starting = new Set(slots.map((s) => s.ours.player.host_id));
	const reserved = [...advice.reserve, ...advice.bench, ...pool]
		.filter((l) => l.player.name === IN_RESERVE)
		.slice(0, 1)
		.map((l) => ({ ...l, player: { ...l.player, injured_reserve: true } }));
	return {
		...advice,
		set: slots.every((s) => !s.changed),
		slots,
		bench: pool.filter((l) => !starting.has(l.player.host_id)).sort(better),
		reserve: reserved
	};
}
