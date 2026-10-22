<script lang="ts">
	import { untrack } from 'svelte';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Field from '#lib/ui/Field.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, type HostLeague, type PickAnswer } from './api.ts';
	import { chipLabel, chipWords } from './league-words.ts';

	/** A member's leagues on one host as chips, and one verb under them: the shape every host read as
	 * the member shares (FFPC, Yahoo). A league already followed links to its page and is never chosen
	 * again. */
	interface Props {
		/** The host as a sentence names it: "FFPC", "Yahoo". */
		host: string;
		leagues: HostLeague[];
		/** The verb under the list for a count of chosen leagues: "Follow my leagues". */
		verb: (count: number) => string;
		/** The chosen leagues, in the list's order. */
		onpick: (leagues: HostLeague[]) => Promise<PickAnswer | null>;
		/** How many leagues can be chosen at once: 1 is a single choice, more is the many-choice group
		 * with every league starting chosen, 0 is none (each chip shown, none to take). */
		most?: number;
		/** Leagues already followed, by the host's league id, to our league's page. */
		followed?: ReadonlyMap<string, string>;
		/** A league number typed by hand too, labelled so, read into a league by typedLeague. */
		typed?: { readonly label: string; readonly league: (number: string) => HostLeague | null };
		/** A failure the caller answers itself (a host that asks for a sign-in again), true when it did. */
		onfailure?: (error: unknown) => boolean;
	}

	let {
		host,
		leagues,
		verb,
		onpick,
		most = 1,
		followed = new Map(),
		typed,
		onfailure
	}: Props = $props();

	let number = $state('');
	let busy = $state(false);
	let problems = $state<readonly string[]>([]);
	let status = $state<string | null>(null);

	const many = $derived(most > 1);
	/** The leagues still to follow, in the list's order. */
	const open = $derived(leagues.filter((l) => !followed.has(l.league_id)));

	/** Who starts chosen: every league to follow, up to the most, when several can be; the one
	 * league when there is exactly one; nobody otherwise. */
	function firstPick(): string[] {
		const ids = open.map((l) => l.league_id);
		if (many) return ids.slice(0, most);
		return most === 1 && ids.length === 1 ? ids : [];
	}

	/** The first pick is taken from the list as it first arrives, then the member's taps rule. */
	let picked = $state<readonly string[]>(untrack(firstPick));

	/** What is chosen now: a league followed since it was tapped drops out. */
	const chosen = $derived(open.filter((l) => picked.includes(l.league_id)));

	function tap(id: string): void {
		if (!many) {
			picked = [id];
			return;
		}
		if (picked.includes(id)) picked = picked.filter((p) => p !== id);
		else if (chosen.length < most) picked = [...picked, id];
	}

	function toFollow(): HostLeague[] {
		const byHand = typed?.league(number.trim()) ?? null;
		return byHand ? [byHand] : chosen;
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
			if (!onfailure?.(error)) {
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

<ChipGroup
	label={many ? `Your ${host} leagues` : `Your ${host} league`}
	variant="loose"
	choose={many ? 'many' : 'one'}
>
	{#each leagues as league (league.league_id)}
		{@const page = followed.get(league.league_id)}
		{#if page}
			<Chip href={page} label={`${chipLabel(league)}, following`}
				>{chipWords(league)}, following</Chip
			>
		{:else}
			<Chip
				pressed={chosen.some((l) => l.league_id === league.league_id)}
				disabled={most === 0}
				onclick={() => tap(league.league_id)}
				label={chipLabel(league)}>{chipWords(league)}</Chip
			>
		{/if}
	{/each}
</ChipGroup>
{#if typed}
	<Field label={typed.label} bind:value={number} maxlength={12} onenter={() => void go()} />
{/if}
{#if open.length > 0 || typed}
	<ActionBar alert={problems.length > 0 || status ? alert : undefined}>
		<Verb disabled={count === 0 || busy} onclick={() => void go()}>{verb(count)}</Verb>
	</ActionBar>
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
