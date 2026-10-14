<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { contextLine } from '#lib/context/context-format.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed } from '#lib/format/number.ts';
	import type { IndexEntry, PlayerFormat } from '#lib/run/schema.ts';
	import PlayerPicker from '#lib/site/PlayerPicker.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import { SAME_PLAYER, verdict as callBetween } from '#lib/site/verdict.ts';
	import { fetchPlayer, type PlayerData } from '#lib/site/player-data.ts';
	import { SEARCH_INDEX_URL, searchable, type SearchablePlayer } from '#lib/site/search.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Face from '#lib/ui/Face.svelte';
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
	import Verb from '#lib/ui/Verb.svelte';
	import Verdict from '#lib/ui/Verdict.svelte';
	import { vorCell } from '#lib/ui/heat.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SLOTS = ['a', 'b'] as const;
	type Slot = (typeof SLOTS)[number];
	const SLOT_LABELS: Record<Slot, string> = { a: 'First player', b: 'Second player' };
	/** The face leads each card, larger than any number on it. */
	const CARD_FACE = 72;

	interface Chosen {
		player: PlayerData;
		numbers: PlayerFormat;
	}

	let players = $state<SearchablePlayer[]>([]);
	let chosen = $state<Record<Slot, PlayerData | null>>({ a: null, b: null });
	/** A slug from the link that names nobody on our board, per side. */
	let missing = $state<Record<Slot, string | null>>({ a: null, b: null });
	let failed = $state(false);

	/** The context's format when the run carries it, else the run's default. */
	const format = $derived.by(() => {
		const formats = data.formats.map((candidate) => ({ format: candidate }));
		const lead = contextLine(formats)?.format;
		if (!lead) throw new Error('The run lists no formats.');
		return lead;
	});
	const figures = $derived(apiFormatOf(format));
	const note = $derived(siteContext.notes?.lineFor(figures, 'These figures are') ?? null);

	function pickOf(slot: Slot): Chosen | null {
		const player = chosen[slot];
		const numbers = player?.formats[format.id];
		return player && numbers ? { player, numbers } : null;
	}

	const picks = $derived(SLOTS.map(pickOf));
	const both = $derived(picks.filter((pick): pick is Chosen => pick !== null));
	/** The two ranges' shared scale; in season the rows carry none, and the cards draw no range. */
	const scale = $derived.by(() => {
		const floors = both.flatMap(({ numbers }) => (numbers.floor === null ? [] : [numbers.floor]));
		const ceilings = both.flatMap(({ numbers }) =>
			numbers.ceiling === null ? [] : [numbers.ceiling]
		);
		return floors.length === 0 || ceilings.length === 0
			? undefined
			: { lo: Math.min(...floors), hi: Math.max(...ceilings) };
	});

	/** Our board's call between the two: the one it ranks higher, by how much, and the other. */
	/** Our call between the two, once both are in. */
	const verdict = $derived.by(() => {
		const [first, second] = both;
		if (!first || !second) return null;
		const contender = ({ player, numbers }: Chosen) => ({
			id: player.id,
			name: player.name,
			ourRank: numbers.ourRank,
			vor: numbers.vor,
			player
		});
		return callBetween(contender(first), contender(second), format.label);
	});

	function syncUrl(): void {
		void goto(links.compare(chosen.a?.slug, chosen.b?.slug), { replace: true, shallow: true });
	}

	async function choose(slot: Slot, entry: Pick<IndexEntry, 'id'>): Promise<void> {
		try {
			// Fetched before the spread, so a second pick landing first is never overwritten.
			const loaded = await fetchPlayer(entry.id);
			chosen = { ...chosen, [slot]: loaded };
			missing = { ...missing, [slot]: null };
			syncUrl();
		} catch {
			failed = true;
		}
	}

	function clear(slot: Slot): void {
		chosen = { ...chosen, [slot]: null };
		missing = { ...missing, [slot]: null };
		syncUrl();
	}

	onMount(async () => {
		void lazySheet.load();
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
				const slug = query.get(slot);
				if (slug === null || slug === '') return Promise.resolve();
				const entry = players.find((player) => player.slug === slug);
				if (!entry) {
					missing = { ...missing, [slot]: slug };
					return Promise.resolve();
				}
				return choose(slot, entry);
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
				: `Our ${format.label} board · ${String(data.run.season)} season`}
		/>
		<ContextNote note={note?.text ?? null} link={note?.link ?? null} />

		{#if verdict?.kind === 'same'}
			<EmptyState level={2} title="Pick two different players" line={SAME_PLAYER} />
		{:else if verdict}
			{@const leader = verdict.leader.player}
			{@const other = verdict.other.player}
			<Verdict sentence={verdict.sentence}>
				{#snippet actions()}
					{#if lazySheet.has(leader.id)}
						<Quiet href={links.sheet()}>{verdict.leaderName} is on your sheet</Quiet>
					{:else}
						<Verb onclick={() => lazySheet.add(leader)}>Add {verdict.leaderName} to my sheet</Verb>
					{/if}
					{#if !lazySheet.has(other.id)}
						<Quiet onclick={() => lazySheet.add(other)}>Add {verdict.otherName} instead</Quiet>
					{/if}
				{/snippet}
			</Verdict>
		{/if}

		{#if picks.every((pick) => pick === null) && SLOTS.every((slot) => missing[slot] === null)}
			<p class="ask">Pick two players and we'll say which one we'd take, and why.</p>
		{/if}

		<div class="pair">
			{#each SLOTS as slot, i (slot)}
				{@const pick = picks[i]}
				<Panel as="section" label={pick?.player.name ?? SLOT_LABELS[slot]}>
					{#if pick}
						{@const { player, numbers } = pick}
						<div class="card">
							<div class="who">
								<Face src={player.headshot} size={CARD_FACE} loading="eager" />
								<PlayerLine
									name={player.name}
									position={player.position}
									positionRank={numbers.positionRank}
									team={player.team}
									href={links.player(player.slug)}
									heads
								>
									{#snippet trailing()}<TierChip tier={numbers.tier} long />{/snippet}
								</PlayerLine>
							</div>
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
									{#if format.rosFromWeek === undefined}<GapChip
											gap={draftersGap(numbers.adp, numbers.ourRank)}
										/>{/if}
									{#if numbers.adp !== null}<Label>ADP {fixed(numbers.adp)}</Label>{/if}
								</dd>
							</dl>
							{#if numbers.floor !== null && numbers.median !== null && numbers.ceiling !== null}
								<div class="range">
									<Label>Floor, median, ceiling</Label>
									<OutcomeBar
										floor={numbers.floor}
										median={numbers.median}
										ceiling={numbers.ceiling}
										{scale}
									/>
								</div>
							{/if}
							<Quiet size="sm" onclick={() => clear(slot)}>Pick someone else</Quiet>
						</div>
					{:else}
						<div class="card">
							{#if missing[slot] !== null}
								<EmptyState
									level={3}
									title="We couldn't find that player"
									line="Nobody here goes by that name."
								/>
							{/if}
							<PlayerPicker
								label={SLOT_LABELS[slot]}
								{players}
								onpick={(entry: SearchablePlayer) => void choose(slot, entry)}
							/>
						</div>
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

	.ask {
		margin: 0;
		font-size: var(--t-lg);
		color: var(--ink-2);
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

	.who {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-width: 0;
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
