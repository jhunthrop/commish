/** The pass page's words: what each feature does in a drafter's terms, a figure in dollars with
 * its basis, and which hosts the live draft works with today. Pure, so the page, the account page
 * and the claim page say a product the same way. */
import { dayLabel } from '#lib/format/date.ts';
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type Feature = Schemas['Feature'];
export type Price = Schemas['Price'];
export type PlanCatalog = Schemas['PlanCatalog'];

export interface FeatureWords {
	lead: string;
	text: string;
}

/** Each feature as the drafter meets it. The keys are the contract's, so a feature added there
 * fails the build here until it has words. */
export const FEATURE_WORDS: Readonly<Record<Feature, FeatureWords>> = {
	live_draft_advisor: {
		lead: 'Our call in your real draft',
		text: 'paste your draft link and get our pick at every one of your turns, against the picks your league actually makes'
	},
	custom_scoring: {
		lead: "Your league's exact scoring",
		text: 'the board rebuilt from your own points per stat, imported from your league or entered by hand'
	},
	full_reasoning: {
		lead: 'The why on every player',
		text: 'our reasoning on each player we would take next, not only the first'
	},
	range_of_outcomes: {
		lead: 'Floor, median and ceiling everywhere',
		text: 'the range of outcomes on every player we would take next'
	},
	synced_sheet: {
		lead: 'Your sheet beside your real draft',
		text: 'your cheat sheet next to our call, each player struck as your league takes him'
	},
	early_run: {
		lead: 'The nightly board an hour early',
		text: "each night's run an hour before the public board"
	}
};

/** The feature lines a product's list prints, in the contract's order. */
export function featureLines(features: readonly Feature[]): FeatureWords[] {
	return features.map((feature) => FEATURE_WORDS[feature]);
}

/** The features the Membership adds over the pass, for the line that says "everything in the pass,
 * plus". */
export function addedFeatures(base: readonly Feature[], more: readonly Feature[]): Feature[] {
	const has = new Set(base);
	return more.filter((feature) => !has.has(feature));
}

const CENTS = 100;

/** "$39", "$14.99": whole dollars print without cents. */
export function money(cents: number, currency: string): string {
	const whole = cents % CENTS === 0;
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currency.toUpperCase(),
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2
	}).format(cents / CENTS);
}

/** A Membership price's basis: "a year", "a month". */
export function perInterval(price: Price): string {
	return price.interval === 'month' ? 'a month' : 'a year';
}

/** "Good through Mar 1, 2027": when a pass bought now ends. */
export function passEnds(catalog: Pick<PlanCatalog, 'pass_ends_at'>): string {
	return dayLabel(catalog.pass_ends_at);
}

/** A host's live draft, said as a mechanism by the host's own name. ready is today. */
export interface Host {
	name: string;
	ready: boolean;
	line: string;
}

/** Which hosts the live draft and the scoring import work with, today and later (spec §2.7). */
export const HOSTS: readonly Host[] = [
	{
		name: 'Sleeper',
		ready: true,
		line: 'Works with a Sleeper draft today: paste the draft link, no sign-in to Sleeper needed. Scoring imports from the league.'
	},
	{
		name: 'ESPN',
		ready: false,
		line: 'An ESPN draft needs your own ESPN session, so it comes with a browser extension after launch. Scoring imports from a league anyone can view.'
	},
	{
		name: 'Yahoo',
		ready: false,
		line: "A Yahoo draft comes with the same extension. Enter a Yahoo league's scoring by hand."
	}
];

/** What is free, said plainly: the pass never gates any of it. */
export const ALWAYS_FREE: readonly FeatureWords[] = [
	{ lead: 'The board', text: 'in every format, with tiers and the drop to the next one' },
	{ lead: 'Every player', text: 'his projection, its basis, and the writing on him' },
	{ lead: 'ADP and our record', text: 'where drafters take him, and how our board has done' },
	{
		lead: 'Mock drafts',
		text: 'against bots or people, with our call at every pick and the report'
	},
	{ lead: 'Your cheat sheet', text: 'ranks, tiers, tags and notes, on every device' }
];
