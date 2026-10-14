<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import {
		ApiError,
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
		/** A line under the chips, like what more leagues come with. */
		limit?: Snippet;
	}

	let { verb, onpick, typed = false, most = 1, followed = new Map(), limit }: Props = $props();

	type View = 'loading' | 'off' | 'signin' | 'again' | 'leagues' | 'unreachable';

	let number = $state('');

	let view = $state<View>('loading');
	let leagues = $state<HostLeague[]>([]);
	let picked = $state<readonly string[]>([]);
	let busy = $state(false);
	let problems = $state<readonly string[]>([]);
	let status = $state<string | null>(null);
	/** Why the sign-in is asked for again, in the API's own words. */
	let reason = $state('FFPC signed you out. Sign in again to keep reading your leagues.');

	const many = $derived(most > 1);
	/** The leagues still to follow, in the list's order. */
	const open = $derived(leagues.filter((l) => !followed.has(l.league_id)));
	/** What is chosen now: a league followed since it was tapped drops out. */
	const chosen = $derived(open.filter((l) => picked.includes(l.league_id)));

	/** A 409 asks for the sign-in again with the API's sentence as the reason. */
	function signInAgain(error: unknown): void {
		if (error instanceof ApiError) reason = error.message;
		view = 'again';
	}

	onMount(() => {
		hostsApi
			.connections()
			.then((hosts) => {
				if (!ffpcOpen(hosts)) {
					view = 'off';
					return;
				}
				// FFPC is the one host connected this way, so the list holds it or nothing.
				const ffpc = hosts.connections.at(0);
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
				if (needsSignIn(error)) signInAgain(error);
				else view = notConnected(error) ? 'signin' : 'unreachable';
			});
	});

	/** FFPC writes a record "2 - 3": the page writes it "2-3". */
	function recordWords(record: string): string {
		return record.replace(/\s*-\s*/g, '-');
	}

	/** A league's chip: its name and the member's record in it, so two alike names part. */
	function chipWords(league: HostLeague): string {
		return league.record ? `${league.name}, ${recordWords(league.record)}` : league.name;
	}

	/** Who starts chosen: every league to follow, up to the most, when several can be; the one
	 * league when there is exactly one; nobody otherwise. */
	function firstPick(list: readonly HostLeague[]): string[] {
		const ids = list.filter((l) => !followed.has(l.league_id)).map((l) => l.league_id);
		if (many) return ids.slice(0, most);
		return most === 1 && ids.length === 1 ? ids : [];
	}

	function connected(list: HostLeague[]): void {
		leagues = list;
		picked = firstPick(list);
		view = 'leagues';
	}

	function tap(id: string): void {
		if (!many) {
			picked = [id];
			return;
		}
		if (picked.includes(id)) picked = picked.filter((p) => p !== id);
		else if (chosen.length < most) picked = [...picked, id];
	}

	const LEAGUE_NUMBER = /^[0-9]{1,12}$/;

	function toFollow(): HostLeague[] {
		const n = number.trim();
		if (typed && LEAGUE_NUMBER.test(n)) {
			return [{ league_id: n, name: `FFPC league ${n}`, team_name: '', record: '' }];
		}
		return chosen;
	}

	async function go(): Promise<void> {
		const list = toFollow();
		if (list.length === 0 || busy) return;
		busy = true;
		problems = [];
		status = null;
		try {
			const answer = await onpick(list);
			if (answer !== null) {
				status = answer.status;
				problems = answer.problems;
			}
		} catch (error) {
			if (needsSignIn(error)) {
				signInAgain(error);
			} else {
				problems = [
					error instanceof ApiError ? error.message : 'That did not go through. Try again.'
				];
			}
		} finally {
			busy = false;
		}
	}

	const count = $derived(toFollow().length);
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
	<ChipGroup
		label={many ? 'Your FFPC leagues' : 'Your FFPC league'}
		variant="loose"
		choose={many ? 'many' : 'one'}
	>
		{#each leagues as league (league.league_id)}
			{@const page = followed.get(league.league_id)}
			{#if page}
				<Chip
					href={page}
					label={`${league.name}, as ${league.team_name}, ${recordWords(league.record)}, following`}
					>{chipWords(league)}, following</Chip
				>
			{:else}
				<Chip
					pressed={chosen.some((l) => l.league_id === league.league_id)}
					disabled={most === 0}
					onclick={() => tap(league.league_id)}
					label={`${league.name}, as ${league.team_name}, ${recordWords(league.record)}`}
					>{chipWords(league)}</Chip
				>
			{/if}
		{/each}
	</ChipGroup>
	{#if limit && open.length > most}{@render limit()}{/if}
	{#if typed}
		<Field
			label="Or your FFPC league number"
			bind:value={number}
			maxlength={12}
			onenter={() => void go()}
		/>
	{/if}
	{#if open.length > 0 || typed}
		<ActionBar alert={problems.length > 0 || status ? alert : undefined}>
			<Verb disabled={count === 0 || busy} onclick={() => void go()}>{verb(count)}</Verb>
		</ActionBar>
	{/if}
{/if}

{#snippet alert()}
	{#if status}<p class="line" role="status">{status}</p>{/if}
	{#each problems as problem, i (i)}<ProblemLine>{problem}</ProblemLine>{/each}
{/snippet}

<style>
	.line {
		margin: 0;
		color: var(--ink-2);
	}
</style>
