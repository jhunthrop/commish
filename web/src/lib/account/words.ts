/** The account in the words its page prints: your name, your plan, a sheet and a mock as lines. */
import { dayLabel } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import type { Account, AccountMock, AccountSheet } from './account-api.ts';

/** The name we greet you by: your name, else your handle, else your email. */
export function displayName(account: Account): string {
	const full = [account.first_name, account.last_name].filter(Boolean).join(' ').trim();
	if (full !== '') return full;
	return account.handle ?? account.email;
}

/** What the plan panel can offer: cancel at period end, take the cancel back, or neither. */
export type PlanAction = 'cancel' | 'resume' | null;

export interface PlanWords {
	title: string;
	line: string;
	action: PlanAction;
}

const PASS_SOURCES = {
	purchase: 'Yours',
	group_pass: 'From a group pass',
	grant: 'Given to you'
} as const;

const ACTIVE_MEMBERSHIP = new Set(['active', 'trialing', 'past_due']);

/** Membership first, since it includes the pass; then the pass; then free. */
export function planWords(account: Account): PlanWords {
	const { membership, draft_pass: pass } = account;
	if (membership && ACTIVE_MEMBERSHIP.has(membership.status)) {
		const interval = membership.interval === 'month' ? 'Monthly' : 'Yearly';
		const end = membership.current_period_end ? dayLabel(membership.current_period_end) : null;
		if (membership.cancel_at_period_end) {
			return {
				title: 'Membership',
				line: end ? `Cancelled. It runs to ${end} and does not renew.` : 'Cancelled.',
				action: 'resume'
			};
		}
		return {
			title: 'Membership',
			line: end ? `${interval}, renews ${end}.` : `${interval}.`,
			action: 'cancel'
		};
	}
	if (pass) {
		return {
			title: `${String(pass.season)} Draft Pass`,
			line: `${PASS_SOURCES[pass.source]}, good through ${dayLabel(pass.ends_at)}.`,
			action: null
		};
	}
	return { title: 'Free', line: 'The board, every player and the record, on us.', action: null };
}

/** "PPR · 42 players · changed Oct 12". */
export function sheetLine(sheet: AccountSheet): string {
	return `${FORMAT_LABELS[sheet.format]} · ${plural(sheet.row_count, 'player')} · changed ${dayLabel(sheet.updated_at)}`;
}

/** "12 teams · PPR · slot 5 · finished Oct 12". */
export function mockLine(mock: AccountMock): string {
	const { settings } = mock;
	const scoring = settings.scoring.preset
		? FORMAT_LABELS[settings.scoring.preset]
		: 'Custom scoring';
	const slot = settings.slot === null ? 'random slot' : `slot ${String(settings.slot)}`;
	const state =
		mock.status === 'complete' && mock.completed_at
			? `finished ${dayLabel(mock.completed_at)}`
			: `started ${dayLabel(mock.created_at)}`;
	return `${String(settings.teams)} teams · ${scoring} · ${slot} · ${state}`;
}
