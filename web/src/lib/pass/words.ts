/** The pass page's words: what each feature does in a drafter's terms, a figure in dollars with
 * its basis, and which hosts the live draft works with today. Pure, so the page, the account page
 * and the claim page say a product the same way. */
import { dateLabel } from '#lib/format/date.ts';
import { listWords } from '#lib/format/list.ts';
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
		text: 'every player scored by your own points per stat, brought in from your Sleeper, ESPN or MyFantasyLeague league, or entered by hand for Yahoo'
	},
	full_reasoning: {
		lead: 'The why on each player we would take next',
		text: 'what taking him instead of our call gives up or gains, beside your real draft'
	},
	range_of_outcomes: {
		lead: 'Floor, median and ceiling in your draft',
		text: 'on every player we would take next, beside your real draft'
	},
	synced_sheet: {
		lead: 'Your sheet beside your real draft',
		text: 'your cheat sheet next to our call, each player struck as your league takes him'
	},
	early_run: {
		lead: 'The nightly board an hour early',
		text: "each night's run an hour before the public board"
	},
	start_sit: {
		lead: 'Who to start this week',
		text: 'your lineup from your own roster, scored on our weekly numbers, with how sure we are on each call'
	},
	waiver_ranks: {
		lead: 'Your waiver pickups, ranked',
		text: 'the players no one in your league holds, ranked by what each adds to your own roster'
	},
	trade_finder: {
		lead: 'Trades that help both teams',
		text: 'two rosters side by side, with the players who make each team better'
	},
	many_leagues: {
		lead: 'Follow every league you play in',
		text: "each one kept up to date: your roster, this week's matchup and the players nobody holds"
	}
};

/** Features a product grants that are not built yet, kept off every screen until they ship, so
 * the page never sells what is not there: the early run with the nightly's early-access build, and
 * the three in-season tools with Lane 13. */
const NOT_BUILT: ReadonlySet<Feature> = new Set<Feature>([
	'early_run',
	'start_sit',
	'waiver_ranks',
	'trade_finder'
]);

/** The feature lines a product's list prints, in the contract's order, built ones only. */
export function featureLines(features: readonly Feature[]): FeatureWords[] {
	return features.filter((f) => !NOT_BUILT.has(f)).map((feature) => FEATURE_WORDS[feature]);
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
	return dateLabel(catalog.pass_ends_at);
}

/** A host's live draft, said as a mechanism by the host's own name. ready is today. */
export interface Host {
	name: string;
	ready: boolean;
	line: string;
}

/** Which hosts the live draft works with today, by the host's own name (spec §2.7). Only what is
 * built is said: the other hosts are named as not followed yet, with no date. */
export const HOSTS: readonly Host[] = [
	{
		name: 'Sleeper',
		ready: true,
		line: 'Works with a Sleeper draft today: paste the draft link, no sign-in to Sleeper needed.'
	},
	{
		name: 'ESPN and Yahoo',
		ready: false,
		line: 'Drafts on ESPN and Yahoo are not followed yet.'
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
	{
		lead: 'Your cheat sheet',
		text: 'ranks, tiers, tags and notes, on every device you sign in on'
	},
	{
		lead: 'One league',
		text: "yours, kept up to date: your roster, this week's matchup, the players nobody holds and every move"
	}
];

/** What stays free in one sentence, from the same list the pass page prints: "The board, every
 * player, ADP and our record, mock drafts and your cheat sheet stay free." */
export function freeLine(): string {
	const [first = '', ...rest] = ALWAYS_FREE.map((line) => line.lead);
	// An acronym keeps its capitals ("ADP"), a word drops its own ("Every player" to "every player").
	const lower = (lead: string): string =>
		/^[A-Z][a-z]/.test(lead) ? lead.charAt(0).toLowerCase() + lead.slice(1) : lead;
	const names = [first, ...rest.map(lower)];
	return `${listWords(names)} stay free.`;
}
