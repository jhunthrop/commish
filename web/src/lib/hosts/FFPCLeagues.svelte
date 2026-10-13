<script lang="ts">
	import { onMount } from 'svelte';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import { ApiError, hostsApi, needsSignIn, type HostLeague } from './api.ts';

	/** FFPC as a way in: sign in once on our form, then tap your league and the verb. A connection
	 * FFPC has signed out asks for the sign-in again. Used by the league and companion pages. */
	interface Props {
		/** The verb under the list: "Follow my league", "Follow my draft". */
		verb: string;
		onpick: (league: HostLeague) => Promise<void>;
	}

	let { verb, onpick }: Props = $props();

	type View = 'loading' | 'signin' | 'again' | 'leagues' | 'unreachable';

	let view = $state<View>('loading');
	let leagues = $state<HostLeague[]>([]);
	let picked = $state<string | null>(null);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	onMount(() => {
		hostsApi
			.connections()
			.then((list) => {
				// FFPC is the one host connected this way, so the list holds it or nothing.
				const ffpc = list.at(0);
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
			.catch((error: unknown) => (view = needsSignIn(error) ? 'again' : 'unreachable'));
	});

	function connected(list: HostLeague[]): void {
		leagues = list;
		picked = list.length === 1 ? (list[0]?.league_id ?? null) : null;
		view = 'leagues';
	}

	async function go(): Promise<void> {
		const league = leagues.find((l) => l.league_id === picked);
		if (!league || busy) return;
		busy = true;
		problem = null;
		try {
			await onpick(league);
		} catch (error) {
			if (needsSignIn(error)) {
				view = 'again';
			} else {
				problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
			}
		} finally {
			busy = false;
		}
	}
</script>

{#if view === 'loading'}
	<p class="line" role="status">Checking your FFPC connection.</p>
{:else if view === 'signin'}
	<FFPCSignIn onconnected={connected} />
{:else if view === 'again'}
	<FFPCSignIn
		reason="FFPC signed you out. Sign in again to keep reading your leagues."
		onconnected={connected}
	/>
{:else if view === 'unreachable'}
	<p class="line">FFPC can't be read right now. Try again in a moment.</p>
{:else if leagues.length === 0}
	<p class="line">Your FFPC account has no league with a finished draft yet.</p>
{:else}
	<ChipGroup label="Your FFPC league" variant="loose">
		{#each leagues as league (league.league_id)}
			<Chip
				pressed={picked === league.league_id}
				onclick={() => (picked = league.league_id)}
				label={`${league.name}, as ${league.team_name}, ${league.record}`}>{league.name}</Chip
			>
		{/each}
	</ChipGroup>
	<ActionBar alert={problem ? alert : undefined}>
		<Verb disabled={picked === null || busy} onclick={() => void go()}>{verb}</Verb>
	</ActionBar>
{/if}

{#snippet alert()}
	<ProblemLine>{problem}</ProblemLine>
{/snippet}

<style>
	.line {
		margin: 0;
		color: var(--ink-2);
	}
</style>
