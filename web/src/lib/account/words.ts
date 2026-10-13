/** The account in the words its page prints: your name, your plan, a sheet and a mock as lines. */
import { dayLabel } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import type { Account, AccountGroupPass, AccountMock, AccountSheet } from './account-api.ts';

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
/** Stripe is retrying the card: the Membership still works until the retries run out. */
const PAST_DUE = 'past_due';

/** Whether the account's Membership is live: paid, in trial, or retrying a card. */
export function hasLiveMembership(account: Pick<Account, 'membership'>): boolean {
	return account.membership !== null && ACTIVE_MEMBERSHIP.has(account.membership.status);
}

function membershipWords(membership: NonNullable<Account['membership']>): PlanWords {
	const interval = membership.interval === 'month' ? 'Monthly' : 'Yearly';
	const end = membership.current_period_end ? dayLabel(membership.current_period_end) : null;
	if (membership.cancel_at_period_end) {
		return {
			title: 'Membership',
			line: end ? `Canceled. It runs to ${end} and does not renew.` : 'Canceled.',
			action: 'resume'
		};
	}
	if (membership.status === PAST_DUE) {
		return {
			title: 'Membership',
			line: 'Your last payment did not go through. Update the card under Billing and receipts to keep it.',
			action: 'cancel'
		};
	}
	return {
		title: 'Membership',
		line: end ? `${interval}, renews ${end}. We email you seven days before.` : `${interval}.`,
		action: 'cancel'
	};
}

/** Membership first, since it includes the pass; then the pass; then free. */
export function planWords(account: Account): PlanWords {
	const { membership, draft_pass: pass } = account;
	if (membership && hasLiveMembership(account)) return membershipWords(membership);
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

/** One seat of a group pass as the buyer's panel lists it. */
export interface SeatLine {
	key: string;
	lead: string;
	text: string;
}

/** A group pass's seats: each claimed one by handle and day, then how many are open. */
export function seatLines(pass: AccountGroupPass): SeatLine[] {
	const claimed = pass.claims.map((claim, i) => ({
		key: `seat-${String(i + 1)}`,
		lead: claim.handle ? `@${claim.handle}` : 'A drafter with no handle yet',
		text: `claimed ${dayLabel(claim.claimed_at)}`
	}));
	const open = pass.seats - pass.claims.length;
	if (open <= 0) return claimed;
	return [
		...claimed,
		{
			key: 'open',
			lead: open === pass.seats ? `All ${String(open)} open` : `${String(open)} open`,
			text: 'waiting on the link'
		}
	];
}

const GROUP_PASS_ENDED: Readonly<Partial<Record<AccountGroupPass['status'], string>>> = {
	refunded: 'Refunded. The passes from it have ended.',
	disputed: 'The payment was disputed, so the passes from it are paused.'
};

/** "For the 2026 season" for a live pass, or why it no longer grants anything. */
export function groupPassLine(pass: AccountGroupPass): string {
	return (
		GROUP_PASS_ENDED[pass.status] ??
		`For the ${String(pass.season)} season, one pass per team. Send the link to your league.`
	);
}
