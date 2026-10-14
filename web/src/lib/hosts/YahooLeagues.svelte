<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import LeagueChoice from './LeagueChoice.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import {
		ApiError,
		connectionTo,
		hostsApi,
		needsSignIn,
		notConnected,
		yahooOpen,
		type HostLeague,
		type PickAnswer
	} from './api.ts';

	/** Yahoo as a way in: connect once through Yahoo's own sign-in, then tap your leagues and the verb.
	 * A connection Yahoo has refused asks to connect again. */
	interface Props {
		/** The verb under the list for a count of chosen leagues: "Follow my leagues". */
		verb: (count: number) => string;
		/** The chosen leagues, in the list's order. */
		onpick: (leagues: HostLeague[]) => Promise<PickAnswer | null>;
		/** How many leagues can be chosen at once (LeagueChoice). */
		most?: number;
		/** Leagues already followed, by Yahoo league id, to our league's page. */
		followed?: ReadonlyMap<string, string>;
		/** A line under the chips, like what more leagues come with. */
		limit?: Snippet;
	}

	let { verb, onpick, most = 1, followed = new Map(), limit }: Props = $props();

	type View = 'loading' | 'off' | 'connect' | 'again' | 'leagues' | 'unreachable';

	let view = $state<View>('loading');
	let leagues = $state<HostLeague[]>([]);
	/** Why a connection is asked for again, in the API's own words. */
	let reason = $state('Yahoo asks you to connect again to keep reading your leagues.');

	/** A 409 asks to connect again with the API's sentence as the reason; true when it did. */
	function connectAgain(error: unknown): boolean {
		if (!needsSignIn(error)) return false;
		if (error instanceof ApiError) reason = error.message;
		view = 'again';
		return true;
	}

	onMount(() => {
		hostsApi
			.connections()
			.then((hosts) => {
				if (!yahooOpen(hosts)) {
					view = 'off';
					return;
				}
				const yahoo = connectionTo(hosts, 'yahoo');
				if (!yahoo) {
					view = 'connect';
					return;
				}
				if (yahoo.status !== 'connected') {
					view = 'again';
					return;
				}
				return hostsApi.yahooLeagues().then((list) => {
					leagues = list;
					view = 'leagues';
				});
			})
			.catch((error: unknown) => {
				if (!connectAgain(error)) view = notConnected(error) ? 'connect' : 'unreachable';
			});
	});
</script>

{#if view === 'loading'}
	<p class="line" role="status">Checking your Yahoo connection.</p>
{:else if view === 'connect'}
	<YahooConnect />
{:else if view === 'again'}
	<YahooConnect {reason} label="Connect Yahoo again" />
{:else if view === 'off'}
	<p class="line">Yahoo leagues are not open here right now.</p>
{:else if view === 'unreachable'}
	<p class="line">Yahoo can't be read right now. Try again in a moment.</p>
{:else if leagues.length === 0}
	<p class="line">Your Yahoo account has no football league this season.</p>
{:else}
	<LeagueChoice
		host="Yahoo"
		{leagues}
		{verb}
		{onpick}
		{most}
		{followed}
		{limit}
		onfailure={connectAgain}
	/>
{/if}

<style>
	.line {
		margin: 0;
		color: var(--ink-2);
	}
</style>
