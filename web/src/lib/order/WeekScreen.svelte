<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import type { LeagueHost } from '#lib/league/api.ts';
	import type { BasisPart } from '#lib/run/board-basis.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import StatusLine from '#lib/ui/StatusLine.svelte';
	import { weekOrderApi, type WeekOrderAdvice } from './api.ts';
	import { ORDER, type RosterView } from './order.ts';
	import {
		landed,
		weekBasis,
		weekRosterFilter,
		weekSections,
		weekStatus,
		weekView,
		WEEK_TAB
	} from './week.ts';
	import WeekTable from './WeekTable.svelte';
	import { weekHeading, type WeekPosition } from './week-head.ts';
	import { WEEK } from './words.ts';

	/** The kickers' or defenses' tab in season (Lane 66w), read from the API: for the selected league
	 * with its rosters and adds, for a visitor in the board's scoring. The page draws the head and the
	 * basis this read gives it (onread), so they sit under the title as on every board page. */
	interface Props {
		position: WeekPosition;
		league?: { id: string; host: LeagueHost } | null;
		/** The tab's head and basis once the week is read. */
		onread?: (said: { heading: string; basis: BasisPart[] }) => void;
	}

	let { position, league = null, onread }: Props = $props();

	let advice = $state<WeekOrderAdvice | null>(null);
	let problem = $state<string | null>(null);
	let roster = $state<RosterView>('everyone');

	const views = $derived(advice?.rows.map((row) => weekView(row)) ?? []);
	const shown = $derived(views.filter(weekRosterFilter(roster)));
	const sections = $derived(advice === null ? [] : weekSections(shown, advice.week));
	const status = $derived(advice === null ? null : weekStatus(advice));
	const tableLeague = $derived(
		league === null || advice === null ? null : { ...league, moves: advice.moves }
	);

	onMount(() => {
		void weekOrderApi
			.read(league?.id ?? null, position)
			.then((answer) => {
				advice = answer;
				problem = null;
				onread?.({
					heading: weekHeading(answer.position, answer.week),
					basis: weekBasis(answer, league)
				});
			})
			.catch((error: unknown) => {
				problem = error instanceof ApiError ? error.message : WEEK_TAB.unread;
			});
	});
</script>

<div class="week-screen">
	{#if league !== null && advice !== null}
		<ChipGroup label={ORDER.roster}>
			{#each [['everyone', ORDER.everyone], ['free', ORDER.free], ['yours', ORDER.yours]] as const as [view, words] (view)}
				<Chip pressed={roster === view} onclick={() => (roster = view)}>{words}</Chip>
			{/each}
		</ChipGroup>
	{/if}
	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{:else if advice === null}
		<p class="reading" aria-live="polite">{WEEK.reading}</p>
	{:else}
		{#if status}<StatusLine lead={status.lead} rest={status.rest} />{/if}
		<WeekTable
			label={weekHeading(advice.position, advice.week)}
			{sections}
			proj={landed(advice)}
			league={tableLeague}
		/>
	{/if}
</div>

<style>
	.week-screen {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		min-width: 0;
	}

	.reading,
	.problem {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.problem {
		color: var(--loss-ink);
	}
</style>
