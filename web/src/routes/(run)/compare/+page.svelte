<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed } from '#lib/format/number.ts';
	import type { IndexEntry } from '#lib/run/schema.ts';
	import PlayerPicker from '#lib/site/PlayerPicker.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import { fetchPlayer, type PlayerData } from '#lib/site/player-data.ts';
	import { SEARCH_INDEX_URL, searchable, type SearchablePlayer } from '#lib/site/search.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import Label from '#lib/ui/Label.svelte';
	import OutcomeBar from '#lib/ui/OutcomeBar.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import TierChip from '#lib/ui/TierChip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import { vorCell } from '#lib/ui/heat.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SLOTS = ['a', 'b'] as const;
	type Slot = (typeof SLOTS)[number];
	const SLOT_LABELS: Record<Slot, string> = { a: 'First player', b: 'Second player' };

	let players = $state<SearchablePlayer[]>([]);
	let chosen = $state<Record<Slot, PlayerData | null>>({ a: null, b: null });
	let failed = $state(false);

	const format = $derived(data.format);
	const both = $derived(
		SLOTS.flatMap((slot) => {
			const player = chosen[slot];
			const numbers = format ? player?.formats[format.id] : undefined;
			return numbers ? [numbers] : [];
		})
	);
	const scale = $derived(
		both.length === 0
			? undefined
			: {
					lo: Math.min(...both.map((numbers) => numbers.floor)),
					hi: Math.max(...both.map((numbers) => numbers.ceiling))
				}
	);

	function syncUrl(): void {
		void goto(links.compare(chosen.a?.slug, chosen.b?.slug), { replace: true, shallow: true });
	}

	async function choose(slot: Slot, entry: Pick<IndexEntry, 'id'>): Promise<void> {
		try {
			// Fetched before the spread, so a second pick landing first is never overwritten.
			const loaded = await fetchPlayer(entry.id);
			chosen = { ...chosen, [slot]: loaded };
			syncUrl();
		} catch {
			failed = true;
		}
	}

	function clear(slot: Slot): void {
		chosen = { ...chosen, [slot]: null };
		syncUrl();
	}

	onMount(async () => {
		try {
			const response = await fetch(SEARCH_INDEX_URL);
			if (!response.ok) throw new Error(`The index answered ${String(response.status)}.`);
			players = searchable(await response.json<IndexEntry[]>());
		} catch {
			failed = true;
			return;
		}
		const query = new URLSearchParams(window.location.search);
		await Promise.all(
			SLOTS.map((slot) => {
				const entry = players.find((player) => player.slug === query.get(slot));
				return entry ? choose(slot, entry) : Promise.resolve();
			})
		);
	});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<SiteShell title="Compare" run={data.run}>
	<main class="compare">
		<PageHead
			title="Compare"
			lead={failed
				? 'The players are not loading. Try again in a moment.'
				: `Our ${format?.label ?? ''} board · ${String(data.run.season)} season`}
		/>
		<div class="pair">
			{#each SLOTS as slot (slot)}
				{@const player = chosen[slot]}
				{@const numbers = format ? player?.formats[format.id] : undefined}
				<Panel as="section" label={player?.name ?? SLOT_LABELS[slot]}>
					{#if player && numbers && format}
						<div class="card">
							<PlayerLine
								name={player.name}
								position={player.position}
								positionRank={numbers.positionRank}
								team={player.team}
								headshot={player.headshot}
								href={links.player(player.slug)}
								size={40}
							>
								{#snippet trailing()}<TierChip tier={numbers.tier} long />{/snippet}
							</PlayerLine>
							<Figure
								value={fixed(numbers.projected)}
								size="lg"
								caption="projected {format.label} points, over {fixed(
									numbers.expectedGames
								)} expected games"
							/>
							<dl>
								<dt><Label>Our rank</Label></dt>
								<dd><Figure value={String(numbers.ourRank)} size="sm" /></dd>
								<dt><Label>Over replacement</Label></dt>
								<dd><ValueCell {...vorCell(numbers.vor, numbers.vorRound)} /></dd>
								<dt><Label>Drafters</Label></dt>
								<dd>
									<GapChip gap={draftersGap(numbers.adp, numbers.ourRank)} />
									<Label>{numbers.adp === null ? 'Not in ADP' : `ADP ${fixed(numbers.adp)}`}</Label>
								</dd>
							</dl>
							<div class="range">
								<Label>Floor, median, ceiling</Label>
								<OutcomeBar
									floor={numbers.floor}
									median={numbers.median}
									ceiling={numbers.ceiling}
									{scale}
								/>
							</div>
							<Quiet size="sm" onclick={() => clear(slot)}>Pick someone else</Quiet>
						</div>
					{:else}
						<PlayerPicker
							label={SLOT_LABELS[slot]}
							{players}
							onpick={(entry: SearchablePlayer) => void choose(slot, entry)}
						/>
					{/if}
				</Panel>
			{/each}
		</div>
	</main>
</SiteShell>

<style>
	.compare {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		max-width: 1180px;
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-4);
		align-items: start;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: var(--s-2) var(--s-4);
		margin: 0;
	}

	dd {
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--s-2);
	}

	.range {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	@media (max-width: 760px) {
		.compare {
			padding: var(--s-4);
		}

		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
