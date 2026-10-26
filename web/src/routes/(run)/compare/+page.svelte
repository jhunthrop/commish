<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { contextLine } from '#lib/context/context-format.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
	import type { IndexEntry } from '#lib/run/schema.ts';
	import PlayerPicker from '#lib/site/PlayerPicker.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import { SAME_PLAYER, verdict as callBetween } from '#lib/site/verdict.ts';
	import { compareRows, sideRange, type Side } from '#lib/site/compare-rows.ts';
	import { COMPARE_FAILED, firstStep } from '#lib/site/compare-words.ts';
	import { EMPTY_FIGURE } from '#lib/format/empty.ts';
	import { fetchPlayer, type PlayerData } from '#lib/site/player-data.ts';
	import { SEARCH_INDEX_URL, searchable, type SearchablePlayer } from '#lib/site/search.ts';
	import BasisLine from '#lib/ui/BasisLine.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Face from '#lib/ui/Face.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import RangeBar from '#lib/ui/RangeBar.svelte';
	import StatusPill from '#lib/ui/StatusPill.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { COMPARE_PAGE, filled } from '#lib/site/reference-words.ts';
	import { basisAtClock, placedAt, placedPair, type LivePlace } from '#lib/run/live-order.ts';
	import { BUILD_ZONE, inSeasonStamp } from '#lib/front/live-board.ts';
	import type { BasisPart } from '#lib/run/board-basis.ts';
	import { memberZone } from '#lib/format/clock.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SLOTS = ['a', 'b'] as const;
	type Slot = (typeof SLOTS)[number];
	const SLOT_LABELS: Record<Slot, string> = {
		a: COMPARE_PAGE.firstPlayer,
		b: COMPARE_PAGE.secondPlayer
	};

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
	/** In season the pair at the order's clock, the one the Rankings read (Lane 220, B184): read for the
	 * board's own format, the public order's, once both players are in. */
	let atClock = $state<{ ids: string; places: Map<string, LivePlace>; lead: BasisPart } | null>(
		null
	);
	const board = $derived(data.formats[0]);
	$effect(() => {
		const picked = [chosen.a, chosen.b].filter((player) => player !== null);
		if (board?.rosFromWeek === undefined || picked.length < 2) return;
		const ids = picked.map((player) => player.id).join(',');
		if (atClock?.ids === ids) return;
		let stale = false;
		const ordered = { teams: board.teams, scoring: apiFormatOf(board) };
		void import('#lib/run/live-order-read.ts')
			.then(({ readOrder }) =>
				Promise.all(picked.map((player) => readOrder(player.name, ordered, memberZone(), Date.now)))
			)
			.then((reads) => {
				const last = reads.at(-1);
				if (stale || last === undefined) return;
				const places = new Map(reads.flatMap((read) => [...read.places]));
				atClock = { ids, places, lead: last.lead };
			})
			.catch(() => {
				if (!stale) atClock = null;
			});
		return () => {
			stale = true;
		};
	});
	/** The order's places for the pair when it places both in the compared format, else none: the
	 * table is the run's or the order's, never one side of each. */
	const placesShown = $derived(
		placedPair(
			[chosen.a?.id, chosen.b?.id].filter((id) => id !== undefined),
			atClock?.places ?? null,
			format.id,
			board?.id ?? null
		)
	);
	/** The member's zone once the page is live, the build's before (as the front door's stamp). */
	let zone = $state(BUILD_ZONE);
	onMount(() => {
		zone = memberZone();
	});
	/** The order's lead once the pair is the order's, else the run's basis with its stamp (review M1). */
	const basis = $derived(
		basisAtClock(
			data.basis[format.id] ?? [],
			placesShown === null ? null : (atClock?.lead ?? null),
			inSeasonStamp(format, zone)
		)
	);
	const note = $derived(siteContext.notes?.lineFor(figures, 'These figures are') ?? null);

	function sideOf(slot: Slot): Side | null {
		const player = chosen[slot];
		const run = player?.formats[format.id];
		if (!player || !run) return null;
		const place = placesShown?.get(player.id);
		const numbers = place === undefined ? run : placedAt(run, place, format.teams);
		return { player, numbers, bye: data.byes[player.team] ?? null };
	}

	const sides = $derived(SLOTS.map(sideOf));
	const both = $derived(sides.filter((side): side is Side => side !== null));

	/** Our call between the two, once both are in: the leader's column first. */
	const verdict = $derived.by(() => {
		const [first, second] = both;
		if (!first || !second) return null;
		const contender = (side: Side) => ({
			id: side.player.id,
			name: side.player.name,
			ourRank: side.numbers.ourRank,
			vor: side.numbers.vor,
			held: side.player.status?.seasonLong === true ? side.player.status.status : null,
			side
		});
		return callBetween(contender(first), contender(second), format.label);
	});
	const pair = $derived(
		verdict?.kind === 'call' ? ([verdict.leader.side, verdict.other.side] as const) : null
	);
	const rows = $derived(
		pair
			? compareRows(pair[0], pair[1], data.season, data.underway, format.rosFromWeek ?? null)
			: []
	);
	/** Each side's range where the run carries one, and the scale the carried ranges share. */
	const ranges = $derived(pair ? pair.map(sideRange) : []);
	const scale = $derived.by(() => {
		const carried = ranges.filter((range) => range !== null);
		return carried.length === 0
			? undefined
			: {
					lo: Math.min(...carried.map((range) => range.floor)),
					hi: Math.max(...carried.map((range) => range.ceiling))
				};
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

{#snippet theCall()}
	{#if verdict?.kind === 'call'}
		{@const leader = verdict.leader.side.player}
		<b class="call-words">{verdict.call}</b>
		{#if lazySheet.has(leader.id)}
			<Quiet href={links.sheet()} size="sm"
				>{filled(COMPARE_PAGE.onSheet, verdict.leaderName)}</Quiet
			>
		{:else}
			<Verb onclick={() => lazySheet.add(leader)}>{COMPARE_PAGE.addToSheet}</Verb>
		{/if}
	{/if}
{/snippet}

<SiteShell title={COMPARE_PAGE.title} head={data.head} run={data.run}>
	<main class="compare">
		<PageHead
			title={COMPARE_PAGE.title}
			lead={failed ? COMPARE_FAILED : (firstStep(both.length) ?? undefined)}
		/>
		<ContextNote note={note?.text ?? null} link={note?.link ?? null} />

		<div class="pickers">
			{#each SLOTS as slot, i (slot)}
				{@const side = sides[i]}
				{#if side}
					<div class="picked">
						<Face src={side.player.headshot} name={side.player.name} size={32} loading="eager" />
						<b>{side.player.name}</b>
						<Quiet size="sm" onclick={() => clear(slot)}>{COMPARE_PAGE.pickAnother}</Quiet>
					</div>
				{:else}
					<div class="picker">
						{#if missing[slot] !== null}
							<EmptyState
								level={3}
								title={COMPARE_PAGE.missingTitle}
								line={COMPARE_PAGE.missingLine}
							/>
						{/if}
						<PlayerPicker
							label={SLOT_LABELS[slot]}
							{players}
							onpick={(entry: SearchablePlayer) => void choose(slot, entry)}
						/>
					</div>
				{/if}
			{/each}
		</div>

		{#if verdict?.kind === 'same'}
			<EmptyState level={2} title={COMPARE_PAGE.sameTitle} line={SAME_PLAYER} />
		{:else if verdict?.kind === 'call' && pair}
			<div class="call-band">{@render theCall()}</div>
			<table class="cmp">
				<thead>
					<tr>
						<th class="call" scope="col"><div class="call-in">{@render theCall()}</div></th>
						{#each pair as side, i (side.player.id)}
							<th class="pick" class:lead={i === 0} scope="col">
								<span class="ph">
									<Face
										src={side.player.headshot}
										name={side.player.name}
										size={64}
										loading="eager"
									/>
									<a href={links.player(side.player.slug)}>{side.player.name}</a>
									<span class="sub"
										><StatusPill
											position={side.player.position}
											positionRank={side.numbers.positionRank}
											status={null}
										/>{side.player.team}</span
									>
								</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.label)}
						<tr data-row={row.label}>
							<th scope="row">{row.label}</th>
							{#each row.cells as cell, i (i)}
								{@const range = row.range ? ranges[i] : null}
								<td
									class:win={cell.wins === true}
									class:lose={cell.wins === false}
									class:gain={cell.tone === 'gain'}
									class:loss={cell.tone === 'loss'}
								>
									{#if range && scale}
										<RangeBar
											floor={range.floor}
											median={range.median}
											ceiling={range.ceiling}
											{scale}
											form="inline"
										/>
									{:else}
										<span class:none={cell.text === EMPTY_FIGURE}>{cell.text}</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="evidence">{verdict.evidence}</p>
			<!-- The Gap's sentence only beside a Gap row (re-review N1). -->
			<BasisLine
				parts={rows.some((row) => row.label === 'Gap')
					? basis
					: basis.filter((part) => part.topic !== 'gap')}
			/>
		{/if}
	</main>
</SiteShell>

<style>
	.compare {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		max-width: 960px;
	}

	.pickers {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-3);
		align-items: start;
	}

	.picked {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-height: 48px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.picked b {
		flex: 1;
		min-width: 0;
		font-weight: 600;
	}

	.cmp {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		table-layout: fixed;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	thead th {
		padding: var(--s-4) var(--s-3);
		vertical-align: bottom;
		background: var(--bg);
		border-bottom: 1px solid var(--line-strong);
	}

	.call {
		text-align: left;
		vertical-align: middle;
	}

	.call-band {
		display: none;
	}

	.call-words {
		display: block;
		margin-bottom: var(--s-3);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 1;
		text-transform: uppercase;
		color: var(--accent-text);
	}

	.pick {
		width: 34%;
	}

	.lead {
		box-shadow: inset 0 3px 0 var(--accent);
	}

	.ph {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		text-align: right;
	}

	.ph a {
		font-size: var(--t-lg);
		font-weight: 700;
		line-height: 1.15;
		text-decoration: none;
	}

	.sub {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--ink-3);
	}

	tbody th {
		padding: 0 var(--s-3);
		text-align: left;
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
	}

	tbody th,
	td {
		height: 48px;
		border-bottom: 1px solid var(--line);
	}

	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: 0;
	}

	td {
		padding: 0 var(--s-3);
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-size: var(--t-xl);
		font-weight: 600;
	}

	/* A signed gap in the board row's colours: green when drafters wait, rose when they reach. */
	.gain {
		color: var(--gain-ink);
	}

	.loss {
		color: var(--loss-ink);
	}

	/* The better figure of a row, where a row has one: a gain's wash, never the only channel (the
	   figures sit side by side). */
	.win {
		background: color-mix(in srgb, var(--gain-bg) 55%, var(--surface));
	}

	.lose {
		color: var(--ink-2);
	}

	.none {
		font-family: var(--font-ui);
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.evidence {
		margin: 0;
		font-size: var(--t-md);
		font-weight: 600;
	}

	@media (max-width: 760px) {
		.compare {
			padding: var(--s-4);
		}

		.pickers {
			grid-template-columns: minmax(0, 1fr);
		}

		/* The call leaves the head for a band above the table, where it has the width. */
		.call-in {
			display: none;
		}

		.call {
			width: 28%;
		}

		.call-band {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			padding: var(--s-4);
			border: 1px solid var(--line);
			border-top: 3px solid var(--accent);
			border-radius: var(--r-md);
			background: var(--surface);
		}

		.pick {
			width: 36%;
		}

		.ph a {
			font-size: var(--t-md);
		}

		td {
			font-size: var(--t-lg);
		}
	}
</style>
