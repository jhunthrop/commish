/** Every link the account page makes. The mock room's pages (Lane 6) are /mock/<id> and its report
 * /mock/<id>/report. Those routes are not on this branch yet, so resolve() cannot type them; they
 * are spelled here, the one place, and move to resolve() once the room's routes merge. */
import { resolve } from '$app/paths';
import type { AccountMock } from './account-api.ts';

export const accountLinks = {
	account: (): string => resolve('/account'),
	sheet: (): string => resolve('/sheet'),
	/** A finished mock opens on its report, one in progress on its room. */
	mock: (mock: AccountMock): string =>
		`/mock/${encodeURIComponent(mock.id)}${mock.status === 'complete' ? '/report' : ''}`
} as const;
