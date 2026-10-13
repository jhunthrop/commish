/** Every link the account page makes, each built with resolve(). */
import { resolve } from '$app/paths';
import { links } from '#lib/site/links.ts';
import type { AccountMock } from './account-api.ts';

export const accountLinks = {
	account: (): string => resolve('/account'),
	pass: (): string => resolve('/pass'),
	/** The live draft companion's start. */
	companion: (): string => resolve('/companion/new'),
	sheet: links.sheet,
	/** A finished mock opens on its report, one in progress on its room. */
	mock: (mock: AccountMock): string =>
		mock.status === 'complete'
			? resolve('/mock/[id]/report', { id: mock.id })
			: resolve('/mock/[id]', { id: mock.id })
} as const;
