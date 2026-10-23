import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { MOCK_SETUP } from '#lib/ui/nav.ts';

/** The section's door (Lane 166, D18): the lobby list lives on the mock setup page the rail links,
 * so the bare address goes there, never to the 404 page. */
export function load(): never {
	redirect(307, resolve(MOCK_SETUP));
}
