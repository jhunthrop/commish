import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { MOCK_SETUP } from '#lib/ui/nav.ts';

/** The section's door: a mock starts at setup. */
export function load(): never {
	redirect(307, resolve(MOCK_SETUP));
}
