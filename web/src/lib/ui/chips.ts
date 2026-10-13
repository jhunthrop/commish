import { getContext, setContext } from 'svelte';

const CHIP_GROUP = Symbol('chip-group');

/** A joined ChipGroup tells its chips they sit on its track, so they drop their own outline.
 * A loose group says so too, so a loose group nested in a joined one resets it. */
export function markChipGroup(joined: boolean): void {
	setContext(CHIP_GROUP, joined);
}

export function inChipGroup(): boolean {
	return getContext<boolean | undefined>(CHIP_GROUP) === true;
}
