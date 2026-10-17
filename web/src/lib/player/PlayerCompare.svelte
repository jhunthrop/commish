<script lang="ts">
	import { onMount } from 'svelte';
	import { fixed } from '#lib/format/number.ts';
	import type { IndexEntry } from '#lib/run/schema.ts';
	import {
		SEARCH_INDEX_URL,
		searchPlayers,
		searchable,
		type SearchablePlayer
	} from '#lib/site/search.ts';
	import { fetchPlayer } from '#lib/site/player-data.ts';
	import Face from '#lib/ui/Face.svelte';
	import { CARD, NONE, type CardTile, type TileKey } from './card.ts';
	import { liveCard, readWeek, screenHrefFor } from './live.ts';
	import type { CardLeague } from './week-words.ts';

	/** Compare (Lane 66h): one other player beside him in the card's columns, his own row first, so
	 * the start or sit question is answered by the same numbers. Loaded only when opened. */
	interface Props {
		/** His row: the card's tiles as they stand. */
		self: { id: string; name: string; team: string; headshot: string; tiles: readonly CardTile[] };
		league: CardLeague | null;
		/** The format the card's rest of season is in. */
		format: string;
	}

	let { self, league, format }: Props = $props();

	interface Row {
		id: string;
		name: string;
		team: string;
		headshot: string;
		tiles: readonly CardTile[];
	}

	const COLUMNS: readonly { key: TileKey; label: string }[] = [
		{ key: 'proj', label: CARD.proj },
		{ key: 'rest', label: CARD.rest },
		{ key: 'opp', label: CARD.opp },
		{ key: 'avg', label: CARD.avg },
		{ key: 'last', label: CARD.last },
		{ key: 'delta', label: CARD.delta }
	];
	/** The columns where more is better, which the higher row's number marks. */
	const MORE_IS_BETTER: ReadonlySet<TileKey> = new Set(['proj', 'rest', 'avg', 'last']);

	let players = $state<SearchablePlayer[]>([]);
	let query = $state('');
	let other = $state<Row | null>(null);
	let failed = $state(false);
	const hits = $derived(searchPlayers(players, query).filter((player) => player.id !== self.id));

	onMount(() => {
		void fetch(SEARCH_INDEX_URL)
			.then((response) => response.json<IndexEntry[]>())
			.then((entries) => (players = searchable(entries)));
	});

	async function pick(player: SearchablePlayer): Promise<void> {
		query = '';
		failed = false;
		try {
			const [data, week] = await Promise.all([
				fetchPlayer(player.id),
				readWeek(
					{ id: player.id, name: player.name, team: player.team, position: player.position },
					league
				)
			]);
			const projected = data.formats[format]?.projected;
			const base: CardTile[] = COLUMNS.map(({ key, label }) => ({
				key,
				label,
				value: key === 'rest' && projected !== undefined ? fixed(projected) : NONE,
				caption: '',
				tone: null
			}));
			const card = liveCard({
				week,
				player: { id: player.id, name: player.name, team: player.team, position: player.position },
				league,
				tiles: base,
				opponents: {},
				games: player.season.games,
				screenHref: screenHrefFor(league)
			});
			other = {
				id: player.id,
				name: player.name,
				team: player.team,
				headshot: player.headshot,
				tiles: card.tiles
			};
		} catch (error: unknown) {
			// eslint-disable-next-line no-console -- the line below the picker says so
			console.warn('compare', error);
			failed = true;
		}
	}

	function valueOf(row: Row, key: TileKey): CardTile | undefined {
		return row.tiles.find((tile) => tile.key === key);
	}

	/** Whether a row's number beats the other's in a column where more is better. */
	function wins(row: Row, against: Row | null, key: TileKey): boolean {
		if (against === null || !MORE_IS_BETTER.has(key)) return false;
		const mine = Number(valueOf(row, key)?.value);
		const theirs = Number(valueOf(against, key)?.value);
		return Number.isFinite(mine) && Number.isFinite(theirs) && mine > theirs;
	}

	const rows = $derived<Row[]>(other === null ? [self] : [self, other]);
	/** "Nacua by 6.7 Proj this week", when both have a Proj. */
	const say = $derived.by(() => {
		if (other === null) return null;
		const a = Number(valueOf(self, 'proj')?.value);
		const b = Number(valueOf(other, 'proj')?.value);
		if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
		const [ahead, by] = a > b ? [self.name, a - b] : [other.name, b - a];
		return `${ahead} by ${fixed(by)} ${CARD.proj} this week`;
	});
</script>

<section class="cmp" id="compare" aria-label={CARD.compare}>
	<div class="head">
		<label class="pick">
			<span class="lb">{CARD.compare}</span>
			<input
				type="search"
				placeholder="Add a player"
				autocomplete="off"
				bind:value={query}
				aria-controls="compare-hits"
			/>
		</label>
		{#if say}<p class="say">{say}</p>{/if}
		{#if failed}<p class="say">That player's figures could not be read just now.</p>{/if}
	</div>
	{#if hits.length > 0}
		<ul class="hits" id="compare-hits">
			{#each hits as hit (hit.id)}
				<li>
					<button type="button" onclick={() => void pick(hit)}
						><Face src={hit.headshot} size={24} />{hit.name}<small>{hit.team} {hit.position}</small
						></button
					>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="frame">
		<table>
			<thead>
				<tr>
					<th scope="col" class="who">Player</th>
					{#each COLUMNS as column (column.key)}<th scope="col" class:wide={column.key === 'delta'}
							>{column.label}</th
						>{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row" class="who"
							><span class="pl"
								><Face src={row.headshot} size={28} />{row.name}<small>{row.team}</small></span
							></th
						>
						{#each COLUMNS as column (column.key)}
							{@const tile = valueOf(row, column.key)}
							<td
								class="{tile?.tone ?? ''} {column.key}"
								class:win={wins(row, rows.find((r) => r.id !== row.id) ?? null, column.key)}
								class:wide={column.key === 'delta'}
								><span class="fig">{tile?.value ?? NONE}</span></td
							>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.cmp {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--s-4);
		flex-wrap: wrap;
	}

	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-3);
	}

	.lb {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	input {
		width: 240px;
		height: 36px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
	}

	.say {
		margin: 0 0 0 auto;
		font-size: var(--t-sm);
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.hits {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.hits button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 var(--s-3) 0 4px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
		font-weight: 600;
		cursor: pointer;
	}

	small {
		margin-left: 4px;
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--ink-3);
	}

	.frame {
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
	}

	th,
	td {
		height: 48px;
		padding: 0 var(--s-3);
		border-bottom: 1px solid var(--line);
		text-align: end;
		white-space: nowrap;
	}

	tbody tr:last-child > * {
		border-bottom: 0;
	}

	thead th {
		height: 30px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
	}

	.who {
		text-align: start;
	}

	.pl {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-md);
		font-weight: 600;
	}

	td {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	td.win {
		color: var(--accent-text);
		font-weight: 700;
	}

	.easy .fig,
	.hard .fig {
		padding: 0 6px;
		border-radius: var(--r-sm);
	}

	.easy .fig {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.hard .fig {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	@media (max-width: 760px) {
		input {
			width: 100%;
		}

		.pick {
			flex: 1;
		}

		.say {
			margin: 0;
			flex-basis: 100%;
			font-size: var(--t-xs);
		}

		th,
		td {
			padding: 0 6px;
		}

		.wide,
		small,
		.pl :global(.face) {
			display: none;
		}

		thead th {
			white-space: normal;
			line-height: 1.1;
		}

		.pl {
			font-size: var(--t-sm);
		}
	}
</style>
