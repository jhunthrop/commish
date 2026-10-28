<script lang="ts">
	import { onMount } from 'svelte';
	import { contextLine } from '#lib/context/context-format.ts';
	import { links } from '#lib/site/links.ts';
	import Capsule from '#lib/ui/Capsule.svelte';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Shelf from '#lib/ui/Shelf.svelte';
	import StatusPill from '#lib/ui/StatusPill.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { clubMark } from '#lib/ui/club-mark.ts';
	import { isFreeAgent } from '#lib/format/free-agent.ts';
	import { builtTiles, cardSource, type CardData } from './card-source.ts';
	import { CARD, unreadBasis } from './card.ts';
	import CardNext from './CardNext.svelte';
	import CardTiles from './CardTiles.svelte';
	import { readCard } from './live.ts';
	import {
		gameTiles,
		rankedTiles,
		rowNext,
		rowSource,
		rowTiles,
		SHELF,
		shelfHead,
		shelfSource,
		shelfVerb
	} from './shelf.ts';
	import type { ShelfHost } from './shelf-state.ts';
	import { noReadWords, shownWeekRead } from './week-read.ts';
	import type { LiveCard } from './week-words.ts';

	/** The player shelf (Lane 113): the top of his page over the screen the member is deciding on, his
	 * name, club, position and designation, the week ahead, the week's tiles and the one-paragraph
	 * read, with the screen's one verb at the foot and his full page at the top. It opens on the row's
	 * own cells, then his page's build (its top as a prerendered file, nothing new), then the week's
	 * read from the same endpoint his page reads. */
	interface Props {
		slug: string;
		host: ShelfHost;
	}

	let { slug, host }: Props = $props();

	const tap = $derived(host.tap(slug));
	const row = $derived(tap?.row ?? null);
	const league = $derived(host.options.league());
	/** His page's build once read, null before or when it cannot be. */
	let built = $state<CardData | null>(null);
	let live = $state<LiveCard | null>(null);
	let failed = $state(false);

	const lead = $derived(built === null ? null : (contextLine(built.lines) ?? built));
	const name = $derived(built?.name ?? row?.name ?? '');
	/** The row's game state at the screen's clock, the one rule the verb and the week tile follow. */
	const game = $derived(row?.state ?? null);
	const tiles = $derived.by(() => {
		const base = built !== null && lead !== null ? builtTiles(built, lead) : null;
		const cells = live?.tiles ?? (row === null ? base : rowTiles(row, base));
		if (cells === null) return [];
		const ranked = rankedTiles(cells, shown.position, lead?.numbers.positionRank, shown.rank);
		return gameTiles(ranked, game, row?.pts ?? null);
	});
	const head = $derived(live?.head ?? built?.card.next ?? null);
	/** His card's head: the row's own facts, the build's only where the row carries none (HIGH-1). */
	const shown = $derived(
		shelfHead(
			tap,
			built === null || lead === null
				? null
				: {
						position: built.position,
						rank: lead.numbers.positionRank,
						status: built.status?.words.view ?? null
					}
		)
	);
	/** The row's Game cell says why he has no game (an IR bench row's words): the shelf says it too. */
	const cell = $derived(
		shown.note !== null ? null : (live?.cell ?? (row === null ? null : rowNext(row)))
	);
	/** His game's state for the read: the row's, the rule the verb and the week tile follow, else the
	 * card's own at the same clock where the shelf opened on no row (Lane 158). */
	const readState = $derived(row === null ? (live?.projection.state ?? null) : game);
	const read = $derived(
		built?.weekRead
			? shownWeekRead(
					built.weekRead,
					live === null ? null : { ...live.projection, state: readState }
				)
			: null
	);
	const basis = $derived(
		live?.basis ?? [
			unreadBasis(
				failed,
				tiles.find((t) => t.key === 'proj')?.label ?? CARD.proj,
				shown.status?.rank ?? null
			)
		]
	);
	const verb = $derived(shelfVerb(host.options.screen, game, row && host.options.offer(row)));
	/** His page's build, null when it cannot be read: the row's cells and the week read still stand. */
	async function readBuild(): Promise<CardData | null> {
		try {
			const response = await fetch(links.playerCard(slug));
			if (!response.ok) throw new Error(`His card answered ${String(response.status)}.`);
			return await response.json<CardData>();
		} catch (error: unknown) {
			// eslint-disable-next-line no-console -- the card draws from the row instead
			console.warn('player shelf: his card', error);
			return null;
		}
	}

	onMount(async () => {
		const page = await readBuild();
		built = page;
		const source =
			page === null
				? row === null
					? null
					: rowSource(row)
				: shelfSource(cardSource(page, contextLine(page.lines) ?? page, null), row);
		try {
			if (source === null) throw new Error('Neither his card nor his row is held.');
			// The screen's clock: the card's week is drawn at the instant the screen's rows are.
			live = await readCard(source, league, null, host.options.now);
		} catch (error: unknown) {
			// eslint-disable-next-line no-console -- the basis line says the figures could not be read
			console.warn('player shelf: the week', error);
			failed = true;
		}
	});

	/** The verb on the screen: what it does there (its run), else where it goes, the shelf closing
	 * either way. */
	function act(): void {
		if (verb?.kind !== 'act') return;
		if (verb.run !== null) {
			verb.run();
			host.close(verb.focus);
		} else if (verb.href !== null) host.leave(verb.href);
	}
</script>

<Shelf label={name} closeLabel={SHELF.close} onclose={() => host.close()}>
	{#snippet top()}<a class="full" href={links.player(slug)}>{SHELF.fullPage}</a>{/snippet}
	<div class="card">
		<div class="hd">
			<Face src={built?.headshot ?? row?.face.src ?? null} {name} size={64} loading="eager" />
			<div class="id">
				<h2>{name}</h2>
				<div class="sub">
					{#if built && isFreeAgent(built.team)}<span class="club">{built.team}</span>
					{:else if built}
						<a class="club" href={links.club(built.team)}
							><img src={clubMark(built.team)} alt="" width="18" height="18" />{built.clubName}</a
						>
					{:else if row}<span class="club">{row.club}</span>{/if}
					{#if shown.position}<StatusPill
							position={shown.position}
							positionRank={shown.rank ?? undefined}
							status={shown.status}
						/>{/if}
				</div>
			</div>
		</div>
		{#if shown.note !== null}
			<p class="next note">{shown.note}</p>
		{:else if head !== null || cell !== null}
			<div class="next">
				<CardNext week={head?.week ?? null} opponent={head?.opponent ?? null} {cell} folded />
			</div>
		{/if}
		{#if tiles.length > 0}<div class="tiles"><CardTiles {tiles} folded /></div>{/if}
		{#if built}
			<section class="read">
				<h3><Label>{CARD.ourRead}</Label></h3>
				{#if read && !read.withheld}
					<Capsule body={read.body} byline={read.caption} week pulls={[]} />
				{:else}
					<p class="unwritten">{read?.words ?? noReadWords(readState, built.weekReadsDue)}</p>
				{/if}
			</section>
		{/if}
		<div class="basis">
			{#each basis as line (line)}<p>{line}</p>{/each}
		</div>
	</div>
	{#snippet foot()}
		{#if verb?.kind === 'act'}
			<Verb size="lg" fill onclick={act}>{verb.label}</Verb>
			{#if verb.line}<p class="line">{verb.line}</p>{/if}
		{:else if verb?.kind === 'held'}
			<p class="held">{verb.words}</p>
		{/if}
	{/snippet}
</Shelf>

<style>
	.full {
		padding: var(--s-2) 0;
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
		text-underline-offset: 3px;
	}

	.full:hover {
		color: var(--ink);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.hd {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: var(--s-3);
	}

	.id {
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 0.95;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	.sub {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-2);
		margin-top: var(--s-2);
	}

	.club {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
		text-decoration: none;
	}

	.next {
		padding-top: var(--s-2);
		border-top: 1px solid var(--line);
	}

	.note {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* The tiles as the card draws them, boxed on their own in the shelf. */
	.tiles {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	.tiles :global(.tiles:first-child) {
		border-top: 0;
	}

	.read h3 {
		margin: 0 0 var(--s-1);
	}

	.unwritten {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-md);
	}

	.basis p {
		margin: 0;
		font-size: var(--t-xs);
		line-height: 1.5;
		color: var(--ink-3);
	}

	.line,
	.held {
		margin: var(--s-2) 0 0;
		font-size: var(--t-xs);
		line-height: 1.4;
		color: var(--ink-3);
		text-align: center;
	}

	.held {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
