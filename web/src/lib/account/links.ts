/** Every link the account page makes, each built with resolve(). */
import { resolve } from '$app/paths';
import { links } from '#lib/site/links.ts';
import type { AccountMock } from './account-api.ts';

export const accountLinks = {
	account: links.account,
	pass: links.pass,
	/** The live draft companion's start. */
	companion: links.companionNew,
	/** Where a league is attached. */
	leagueNew: links.leagueNew,
	sheet: links.sheet,
	/** A finished mock opens on its report, one in progress on its room. */
	mock: (mock: AccountMock): string =>
		mock.status === 'complete'
			? resolve('/mock/[id]/report', { id: mock.id })
			: resolve('/mock/[id]', { id: mock.id })
} as const;
