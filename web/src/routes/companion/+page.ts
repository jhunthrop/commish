import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { COMPANION_START } from '#lib/ui/nav.ts';

/** The section's door (Lane 166, D18): the companion's front is its one page, the one the rail links. */
export function load(): never {
	redirect(307, resolve(COMPANION_START));
}
