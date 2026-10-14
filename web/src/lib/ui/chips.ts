import { getContext, setContext } from 'svelte';

const CHIP_GROUP = Symbol('chip-group');

/** What a ChipGroup tells its chips. joined: they sit on its track, so they drop their own outline
 * (a loose group says so too, so a loose group nested in a joined one resets it). many: the group
 * holds any number of choices, so a chip marks itself chosen with a check, not by fill alone. */
export interface ChipGroupMark {
	joined: boolean;
	many: boolean;
}

export function markChipGroup(mark: ChipGroupMark): void {
	setContext(CHIP_GROUP, mark);
}

function chipGroup(): ChipGroupMark | undefined {
	return getContext<ChipGroupMark | undefined>(CHIP_GROUP);
}

export function inChipGroup(): boolean {
	return chipGroup()?.joined === true;
}

export function inManyChipGroup(): boolean {
	return chipGroup()?.many === true;
}
