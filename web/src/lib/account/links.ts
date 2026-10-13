/** Every link the account page makes, each built with resolve(). */
import { resolve } from '$app/paths';
import type { AccountMock } from './account-api.ts';

export const accountLinks = {
	account: (): string => resolve('/account'),
	sheet: (): string => resolve('/sheet'),
	/** A finished mock opens on its report, one in progress on its room. */
	mock: (mock: AccountMock): string =>
		mock.status === 'complete'
			? resolve('/mock/[id]/report', { id: mock.id })
			: resolve('/mock/[id]', { id: mock.id })
} as const;
