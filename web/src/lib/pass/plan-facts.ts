/** The pass page's plans as facts in cells (Lane 66o): each price as the API gives it, the season and
 * the dates. Apart from words.ts, which the account and claim pages read too, so they never carry the
 * pass page's cells. */
import type { components } from '#lib/api/types.ts';
import type { FactCell } from '#lib/ui/facts.ts';
import { money, passEnds, type PlanCatalog, type Price } from './words.ts';

type GroupPassPrice = components['schemas']['GroupPassPrice'];

/** Said in the price cell while checkout has no price to give. */
const NOT_OPEN = 'Not open yet';

/** The days before a renewal the Membership's reminder email goes out. */
export const RENEWAL_NOTICE_DAYS = 7;

function priceCell(price: Price | null | undefined, label: string): FactCell {
	return price
		? { label, value: money(price.amount_cents, price.currency) }
		: { label, value: NOT_OPEN, word: true };
}

/** The Draft Pass as facts: its price once, its season, when it ends, that it never renews. */
export function draftPassFacts(
	catalog: Pick<PlanCatalog, 'season' | 'pass_ends_at' | 'draft_pass'>
): FactCell[] {
	return [
		priceCell(catalog.draft_pass, 'Once'),
		{ label: 'Season', value: String(catalog.season) },
		{ label: 'Ends', value: passEnds(catalog), word: true },
		{ label: 'Renews', value: 'Never', word: true }
	];
}

/** The Membership as facts: its price for the billing chosen, how it renews, the reminder before a
 * renewal, and how it is cancelled. */
export function membershipFacts(price: Price | null): FactCell[] {
	const monthly = price?.interval === 'month';
	return [
		priceCell(price, monthly ? 'A month' : 'A year'),
		{ label: 'Renews', value: monthly ? 'Monthly' : 'Yearly', word: true },
		{ label: 'Reminder', value: `${String(RENEWAL_NOTICE_DAYS)} days before`, word: true },
		{ label: 'Cancel', value: 'One click', word: true }
	];
}

/** The Group Draft Pass as facts: the total for the teams chosen, the price a team, how the drafters
 * claim theirs. */
export function groupFacts(group: GroupPassPrice | null, seats: number): FactCell[] {
	if (!group) return [priceCell(null, `${String(seats)} teams`)];
	const each = group.per_seat;
	return [
		{ label: `${String(seats)} teams`, value: money(each.amount_cents * seats, each.currency) },
		{ label: 'A team', value: money(each.amount_cents, each.currency) },
		{ label: 'Claims', value: 'One link', word: true }
	];
}
