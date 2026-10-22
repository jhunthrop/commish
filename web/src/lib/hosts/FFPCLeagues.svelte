<script lang="ts">
	import { onMount } from 'svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import LeagueChoice from './LeagueChoice.svelte';
	import {
		ApiError,
		connectionTo,
		ffpcOpen,
		hostsApi,
		needsSignIn,
		notConnected,
		type HostLeague,
		type PickAnswer
	} from './api.ts';

	/** FFPC as a way in: sign in once on our form, then tap your leagues and the verb. A connection
	 * FFPC has signed out asks for the sign-in again. Used by the league and companion pages. */
	interface Props {
		/** The verb under the list for a count of chosen leagues: "Follow my leagues". */
		verb: (count: number) => string;
		/** The chosen leagues, in the list's order. */
		onpick: (leagues: HostLeague[]) => Promise<PickAnswer | null>;
		/** Offer a league number typed by hand too: a draft still running may not be on FFPC's list of
		 * finished drafts. */
		typed?: boolean;
		/** How many leagues can be chosen at once: 1 is a single choice, more is the many-choice group
		 * with every league starting chosen, 0 is none (each chip shown, none to take). */
		most?: number;
		/** Leagues already followed, by FFPC league id, to our league's page: shown as such, never
		 * chosen again. */
		followed?: ReadonlyMap<string, string>;
	}

	let { verb, onpick, typed = false, most = 1, followed = new Map() }: Props = $props();

	type View = 'loading' | 'off' | 'signin' | 'again' | 'leagues' | 'unreachable';

	let view = $state<View>('loading');
	let leagues = $state<HostLeague[]>([]);
	/** Why the sign-in is asked for again, in the API's own words. */
	let reason = $state('FFPC signed you out. Sign in again to keep reading your leagues.');

	/** A 409 asks for the sign-in again with the API's sentence as the reason; true when it did. */
	function signInAgain(error: unknown): boolean {
		if (!needsSignIn(error)) return false;
		if (error instanceof ApiError) reason = error.message;
		view = 'again';
		return true;
	}

	onMount(() => {
		hostsApi
			.connections()
			.then((hosts) => {
				if (!ffpcOpen(hosts)) {
					view = 'off';
					return;
				}
				const ffpc = connectionTo(hosts, 'ffpc');
				if (!ffpc) {
					view = 'signin';
					return;
				}
				if (ffpc.status !== 'connected') {
					view = 'again';
					return;
				}
				return hostsApi.ffpcLeagues().then((answer) => connected(answer));
			})
			.catch((error: unknown) => {
				if (!signInAgain(error)) view = notConnected(error) ? 'signin' : 'unreachable';
			});
	});

	function connected(list: HostLeague[]): void {
		leagues = list;
		view = 'leagues';
	}

	const LEAGUE_NUMBER = /^[0-9]{1,12}$/;

	/** A league number typed by hand, as a league to follow. */
	const byHand = {
		label: 'Or your FFPC league number',
		league: (n: string): HostLeague | null =>
			LEAGUE_NUMBER.test(n)
				? { league_id: n, name: `FFPC league ${n}`, team_name: '', record: '' }
				: null
	};
</script>

{#if view === 'loading'}
	<p class="line" role="status">Checking your FFPC connection.</p>
{:else if view === 'signin'}
	<FFPCSignIn onconnected={connected} />
{:else if view === 'again'}
	<FFPCSignIn {reason} onconnected={connected} />
{:else if view === 'off'}
	<p class="line">FFPC leagues are not open here right now.</p>
{:else if view === 'unreachable'}
	<p class="line">FFPC can't be read right now. Try again in a moment.</p>
{:else if leagues.length === 0 && !typed}
	<p class="line">Your FFPC account has no league with a finished draft yet.</p>
{:else}
	<LeagueChoice
		host="FFPC"
		{leagues}
		{verb}
		{onpick}
		{most}
		{followed}
		typed={typed ? byHand : undefined}
		onfailure={signInAgain}
	/>
{/if}

<style>
	.line {
		margin: 0;
		color: var(--ink-2);
	}
</style>
