<script lang="ts">
	import { onMount } from 'svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import LineList from '#lib/ui/LineList.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';

	/** Your cheat sheet beside the call (synced_sheet), each player struck the moment Sleeper reports
	 * him taken. The sheet is the one open on your account, read through the sheet's own store. */
	interface Props {
		/** Every player the draft has taken, on our board's ids. */
		taken: ReadonlySet<string>;
	}

	let { taken }: Props = $props();

	/** The rows shown before Show all: the top of a sheet is what a pick decides between. */
	const FIRST_ROWS = 30;
	let all = $state(false);

	onMount(() => {
		void lazySheet.load();
	});

	const rows = $derived(lazySheet.parts?.store.sheet.rows ?? []);
	const left = $derived(rows.filter((r) => !taken.has(r.id)).length);
	const lines = $derived(
		(all ? rows : rows.slice(0, FIRST_ROWS)).map((r, i) => ({
			key: r.id,
			lead: `${String(i + 1)}. ${r.name}`,
			text: [r.position, r.team].filter(Boolean).join(' · '),
			struck: taken.has(r.id)
		}))
	);
</script>

<Panel as="section" label="Your sheet">
	<div class="sheet">
		<PanelHead
			title="Your sheet"
			aside={rows.length > 0 ? `${String(left)} of ${String(rows.length)} left` : undefined}
		/>
		{#if rows.length === 0}
			<p class="none">Your sheet is empty. Rank players on it and they line up here.</p>
			<Quiet href={links.sheet()} size="sm">Open your cheat sheet</Quiet>
		{:else}
			<LineList label="Your sheet, taken players struck" {lines} />
			{#if !all && rows.length > FIRST_ROWS}
				<Quiet size="sm" onclick={() => (all = true)}>Show all {rows.length}</Quiet>
			{/if}
		{/if}
	</div>
</Panel>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.none {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
