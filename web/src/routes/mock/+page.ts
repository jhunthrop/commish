import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

/** The section's door: a mock starts at setup. */
export function load(): never {
	redirect(307, resolve('/mock/new'));
}
