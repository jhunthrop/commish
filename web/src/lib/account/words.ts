/** The account in the words its page prints: your name, your plan, a sheet and a mock as lines. */
import { dateLabel, dayLabel, dayYearLabel } from '#lib/format/date.ts';
import { freeLine } from '#lib/pass/words.ts';
import { plural } from '#lib/format/number.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import { railInSeason, railKey, railPhase } from '#lib/ui/nav.ts';
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
/** Stripe is retrying the card: the Membership still works until the retries run out. */
const PAST_DUE = 'past_due';

/** Whether the account's Membership is live: paid, in trial, or retrying a card. */
export function hasLiveMembership(account: Pick<Account, 'membership'>): boolean {
	return account.membership !== null && ACTIVE_MEMBERSHIP.has(account.membership.status);
}

type Membership = NonNullable<Account['membership']>;

/** A granted Membership: nothing was bought, so no billing and nothing to cancel. Its end is a real
 * instant read in UTC with its year, as the pass's end is. */
function grantWords(membership: Membership): PlanWords {
	return {
		title: 'Membership',
		line: membership.ends_at
			? `Granted, good through ${dateLabel(membership.ends_at)}.`
			: 'Granted.',
		action: null
	};
}

function subscriptionWords(membership: Membership): PlanWords {
	const interval = membership.interval === 'month' ? 'Monthly' : 'Yearly';
	// A real instant (Stripe's period end), read on the Eastern clock with its year.
	const end = membership.current_period_end ? dayYearLabel(membership.current_period_end) : null;
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

/** The Membership's card by how it came to be, as PASS_SOURCES words the pass's. */
const MEMBERSHIP_SOURCES: Readonly<Record<Membership['source'], (m: Membership) => PlanWords>> = {
	subscription: subscriptionWords,
	grant: grantWords
};

/** Whether the account bought its Membership, so it has receipts and a card on file. */
export function boughtMembership(account: Pick<Account, 'membership'>): boolean {
	return account.membership?.source === 'subscription';
}

/** The plan card in the free season (Lane 150): every tool is on every account. */
export const FREE_SEASON_PLAN: PlanWords = {
	title: 'Free this season',
	line: 'Every tool is on your account through the 2026 season.',
	action: null
};

/** The plan card's way to the free page, in the free season. */
export const FREE_SEE = "See what's free";

/** Whether the account paid for its plan, so its card keeps the billing it has and its receipts. */
export function boughtPlan(account: Pick<Account, 'membership' | 'draft_pass'>): boolean {
	return boughtMembership(account) || account.draft_pass?.source === 'purchase';
}

/** In the free season every account's card says so, but a plan paid for keeps its own (its cancel
 * and receipts); outside it, Membership first, since it includes the pass, then the pass, then free. */
export function planWords(account: Account, freeSeason: boolean): PlanWords {
	if (freeSeason && !boughtPlan(account)) return FREE_SEASON_PLAN;
	const { membership, draft_pass: pass } = account;
	if (membership && hasLiveMembership(account)) {
		return MEMBERSHIP_SOURCES[membership.source](membership);
	}
	if (pass) {
		return {
			title: `${String(pass.season)} Draft Pass`,
			line: `${PASS_SOURCES[pass.source]}. It ends ${dateLabel(pass.ends_at)}.`,
			action: null
		};
	}
	return { title: 'Free', line: freeLine(), action: null };
}

/** Whether the account's draft prep recedes to one line (B52): from the season's first kickoff to
 * its last game, the Super Bowl, by the rail's own rule (railInSeason) over the site season the API
 * reads at its own clock (/me's season), so it returns only at the offseason and the preseason. */
export function draftToolsRecede(season: Pick<Account['season'], 'phase'>): boolean {
	return railInSeason(railKey(railPhase(null, season.phase)));
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
