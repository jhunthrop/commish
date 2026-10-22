<script lang="ts">
	import { onMount } from 'svelte';
	import { hostWords } from '#lib/league/names.ts';
	import ESPNConnect from './ESPNConnect.svelte';
	import LeagueChoice from './LeagueChoice.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import {
		ApiError,
		connectionTo,
		espnOpen,
		hostsApi,
		needsSignIn,
		notConnected,
		yahooOpen,
		type HostConnected,
		type HostConnections,
		type HostLeague,
		type PickAnswer
	} from './api.ts';

	/** Yahoo or ESPN as a way in: connect once (Yahoo's own sign-in, or Disney's for ESPN), then tap
	 * your leagues and the verb. A connection the host has dropped asks to connect again. */
	interface Props {
		host: 'yahoo' | 'espn';
		/** The verb under the list for a count of chosen leagues: "Follow my leagues". */
		verb: (count: number) => string;
		/** The chosen leagues, in the list's order. */
		onpick: (leagues: HostLeague[]) => Promise<PickAnswer | null>;
		/** How many leagues can be chosen at once (LeagueChoice). */
		most?: number;
		/** Leagues already followed, by the host's league id, to our league's page. */
		followed?: ReadonlyMap<string, string>;
	}

	let { host, verb, onpick, most = 1, followed = new Map() }: Props = $props();

	type View = 'loading' | 'off' | 'connect' | 'again' | 'leagues' | 'unreachable';

	const name = $derived(hostWords(host));
	let view = $state<View>('loading');
	let leagues = $state<HostLeague[]>([]);
	/** Why a connection is asked for again, in the API's own words. */
	let reason = $state<string | undefined>(undefined);
	/** Said once just connected with a session kept not yet proven (ESPN), in the API's words. */
	let note = $state<string | undefined>(undefined);

	/** A 409 asks to connect again with the API's sentence as the reason; true when it did. */
	function connectAgain(error: unknown): boolean {
		if (!needsSignIn(error)) return false;
		if (error instanceof ApiError) reason = error.message;
		view = 'again';
		return true;
	}

	function isOpen(hosts: HostConnections): boolean {
		return host === 'yahoo' ? yahooOpen(hosts) : espnOpen(hosts);
	}

	function connected(list: HostLeague[]): void {
		leagues = list;
		view = 'leagues';
	}

	function connectedNow(answer: HostConnected): void {
		note = answer.note;
		connected(answer.leagues);
	}

	onMount(() => {
		hostsApi
			.connections()
			.then((hosts) => {
				if (!isOpen(hosts)) {
					view = 'off';
					return;
				}
				const mine = connectionTo(hosts, host);
				if (!mine) {
					view = 'connect';
					return;
				}
				if (mine.status !== 'connected') {
					view = 'again';
					return;
				}
				const read = host === 'yahoo' ? hostsApi.yahooLeagues() : hostsApi.espnLeagues();
				return read.then(connected);
			})
			.catch((error: unknown) => {
				if (!connectAgain(error)) view = notConnected(error) ? 'connect' : 'unreachable';
			});
	});
</script>

{#if view === 'loading'}
	<p class="line" role="status">Checking your {name} connection.</p>
{:else if view === 'connect' || view === 'again'}
	{@const again = view === 'again'}
	{#if host === 'yahoo'}
		<YahooConnect {reason} bar label={again ? 'Connect Yahoo again' : 'Connect Yahoo'} />
	{:else}
		<ESPNConnect
			{reason}
			bar
			label={again ? 'Connect ESPN again' : 'Connect ESPN'}
			onconnected={connectedNow}
		/>
	{/if}
{:else if view === 'off'}
	<p class="line">{name} leagues are not open here right now.</p>
{:else if view === 'unreachable'}
	<p class="line">{name} can't be read right now. Try again in a moment.</p>
{:else if leagues.length === 0}
	<p class="line" role={note ? 'status' : undefined}>
		{note ?? `Your ${name} account has no football league this season.`}
	</p>
{:else}
	{#if note}<p class="line note" role="status">{note}</p>{/if}
	<LeagueChoice host={name} {leagues} {verb} {onpick} {most} {followed} onfailure={connectAgain} />
{/if}

<style>
	.line {
		margin: 0;
		color: var(--ink-2);
	}

	.note {
		margin-bottom: var(--s-3);
		max-width: 60ch;
		font-size: var(--t-sm);
	}
</style>
