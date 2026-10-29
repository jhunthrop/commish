<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { plural } from '#lib/format/number.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Label from '#lib/ui/Label.svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import type { HeadMarkup } from '#lib/site/head.ts';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { MOCK_VERB, sectionHref } from '#lib/ui/nav.ts';
	import { POSITIONS, type Position } from '#lib/types/player.ts';
	import { fileDirectory } from './directory.ts';
	import EmptySheet from './EmptySheet.svelte';
	import { downloadCsv } from './files.ts';
	import { FORMAT_LABELS } from './format.ts';
	import ImportPanel from './ImportPanel.svelte';
	import { OurBoard } from './our-board.svelte.ts';
	import { SHEET_LIMITS } from './limits.ts';
	import { rowFor, ranksOf, type SheetRow } from './model.ts';
	import SheetList from './SheetList.svelte';
	import SheetPicker from './SheetPicker.svelte';
	import { statusWords } from './status.ts';
	import { sheetStore as store } from './store.svelte.ts';
	import { FIXED_TAGS, ownTags, sameTag, tagLabel } from './tags.ts';
	import { PRINT_WORDS } from './print-words.ts';
	import { SHEET } from './words.ts';

	interface Props {
		/** The rail's week item, named at build in season (server/build-week.ts, Lane 143, B126). */
		weekLabel?: string | undefined;
		/** The page's head but its title, built at prerender (Lane 169). */
		head: HeadMarkup;
	}

	let { weekLabel, head }: Props = $props();

	const directory = fileDirectory();
	/** The mock draft section, whose route another lane builds. */
	const mockHref = sectionHref('mock');
	const NOTES = 'notes';
	const UNDO_KEY = 'z';
	/** The undo key as this machine's keyboard prints it. */
	const undoKey =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
			? 'Cmd Z'
			: 'Ctrl Z';

	let query = $state('');
	let position = $state<Position | null>(null);
	let tagFilter = $state<string | null>(null);
	let panel = $state<'import' | 'sheets' | null>(null);
	let renaming = $state(false);
	let announcement = $state('');
	/** Our board for the sheet's format, followed when the format changes. */
	const ourBoard = new OurBoard(directory);
	let starting = $state(false);
	let boardProblem = $state<string | null>(null);

	const sheet = $derived(store.sheet);
	const rows = $derived(sheet.rows);
	/** The sheet's format. An empty sheet in this browser takes the context's (the selected league's),
	 * so starting from our board starts from the league's; a sheet with rows, or one on the account,
	 * keeps its own. */
	const format = $derived(
		rows.length === 0 && store.stored.sync === null
			? (siteContext.format ?? sheet.format)
			: sheet.format
	);
	const ranks = $derived(ranksOf(rows));
	const own = $derived(ownTags(rows.map((row) => row.tags)));
	const positionsHere = $derived(POSITIONS.filter((p) => rows.some((row) => row.position === p)));
	const tagsHere = $derived([
		...FIXED_TAGS.map((fixed) => fixed.tag).filter((tag) =>
			rows.some((row) => row.tags.includes(tag))
		),
		...own
	]);
	const hasNotes = $derived(rows.some((row) => row.note !== null));
	const hasSheetTools = $derived(
		store.signedIn || store.stored.shelf.length > 0 || rows.length > 0
	);
	const needle = $derived(query.trim().toLowerCase());

	function shows(row: SheetRow): boolean {
		if (position !== null && row.position !== position) return false;
		if (tagFilter === NOTES && row.note === null) return false;
		if (tagFilter !== null && tagFilter !== NOTES) {
			if (!row.tags.some((tag) => sameTag(tag, tagFilter ?? ''))) return false;
		}
		if (needle === '') return true;
		const haystack = [row.name, row.team ?? '', row.note ?? '', ...row.tags.map(tagLabel)]
			.join(' ')
			.toLowerCase();
		return haystack.includes(needle);
	}

	const visible = $derived(rows.filter(shows));
	const status = $derived(
		statusWords({
			status: store.status,
			problem: store.problem,
			changedAt: store.changedAt,
			answeredAt: store.answeredAt,
			players: rows.length
		})
	);

	async function startFromBoard(): Promise<void> {
		starting = true;
		boardProblem = null;
		try {
			const board = await directory.board(format);
			if (!board) {
				boardProblem = `We have no ${FORMAT_LABELS[format]} board yet`;
				return;
			}
			store.replace(board.slice(0, SHEET_LIMITS.rows).map(rowFor), format);
		} catch {
			boardProblem = SHEET.boardFailed;
		} finally {
			starting = false;
		}
	}

	function togglePanel(name: 'import' | 'sheets'): void {
		panel = panel === name ? null : name;
	}

	function isTyping(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
		);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== UNDO_KEY || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
		if (isTyping(event.target) || !store.canUndo) return;
		event.preventDefault();
		store.undo();
		announcement = SHEET.undone;
	}

	function pickTag(value: string): void {
		tagFilter = tagFilter === value ? null : value;
	}

	onMount(() => {
		store.load();
	});

	$effect(() => {
		if (store.loaded) void ourBoard.follow(format);
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sheetTools()}
	{#if store.signedIn || store.stored.shelf.length > 0}
		<Quiet size="sm" onclick={() => togglePanel('sheets')}>{SHEET.yourSheets}</Quiet>
	{/if}
	{#if rows.length > 0}
		<Quiet size="sm" onclick={() => togglePanel('import')}>{SHEET.importTool}</Quiet>
		<Quiet size="sm" onclick={() => downloadCsv(sheet)}>{SHEET.exportTool}</Quiet>
		<Quiet size="sm" href={resolve('/sheet/print')}>{PRINT_WORDS.print}</Quiet>
	{/if}
{/snippet}

<Shell
	head={{ title: SHEET.headTitle, markup: head }}
	title={SHEET.title}
	active="sheet"
	{weekLabel}
>
	{#snippet search()}
		<Search
			placeholder={rows.length > 0
				? `Search your ${plural(rows.length, 'player')}`
				: SHEET.searchSheet}
			label={SHEET.searchSheet}
			bind:value={query}
		/>
	{/snippet}
	{#snippet tail()}
		<!-- One solid verb per viewport: an open panel carries its own. -->
		{#if rows.length > 0 && panel === null}
			<Verb href={mockHref}>{MOCK_VERB}</Verb>
		{/if}
	{/snippet}

	<main class="sheet">
		<div class="lead">
			<div class="title">
				{#if renaming}
					<Field
						label={SHEET.sheetName}
						hideLabel
						value={sheet.name}
						maxlength={SHEET_LIMITS.sheetName}
						autofocus
						onchange={(name: string) => {
							store.rename(name);
							renaming = false;
						}}
					/>
				{:else}
					<h2><button type="button" onclick={() => (renaming = true)}>{sheet.name}</button></h2>
				{/if}
				<p>
					{FORMAT_LABELS[format]}
					{#if store.loaded}
						· {plural(rows.length, 'player')}<span aria-live="polite"
							>{status === null ? '' : ` · ${status}`}</span
						>
					{/if}
				</p>
			</div>
			<!-- The account's buttons come first: they are drawn on the first response, and the ones
				 that wait on your sheet are added after them, so nothing already drawn moves. On the
				 phone the sheet's own tools fold into More, so the bar is one line. -->
			<div class="tools">
				{#if !store.signedIn}
					<Quiet size="sm" href={store.signInUrl(resolve('/sheet'))}>{SHEET.saveToAccount}</Quiet>
				{/if}
				<span class="spread">{@render sheetTools()}</span>
				{#if store.canUndo}<Quiet size="sm" key={undoKey} onclick={() => store.undo()}
						>{SHEET.undo}</Quiet
					>{/if}
				{#if hasSheetTools}
					<span class="folded"
						><Menu label={SHEET.more} id="sheet-tools">{@render sheetTools()}</Menu></span
					>
				{/if}
			</div>
		</div>

		{#if store.notices.length > 0}
			<ul class="notices" aria-live="polite">
				{#each store.notices as notice, index (index)}
					<li>
						<span>{notice}</span>
						<Quiet size="sm" onclick={() => store.dismissNotice(index)}>{SHEET.gotIt}</Quiet>
					</li>
				{/each}
			</ul>
		{/if}

		{#if panel === 'import'}
			<ImportPanel {store} {directory} onclose={() => (panel = null)} />
		{:else if panel === 'sheets'}
			<SheetPicker {store} onclose={() => (panel = null)} />
		{/if}

		{#if store.loaded && rows.length === 0 && panel === null}
			<EmptySheet
				board={ourBoard.players}
				boardState={ourBoard.state}
				{format}
				{starting}
				problem={boardProblem}
				onstart={() => void startFromBoard()}
				onimport={() => (panel = 'import')}
			/>
		{/if}

		{#if rows.length > 0}
			<div class="filters">
				<ChipGroup label={SHEET.position}>
					<Chip pressed={position === null} onclick={() => (position = null)}>{SHEET.all}</Chip>
					{#each positionsHere as p (p)}
						<Chip pressed={position === p} onclick={() => (position = p)}>{p}</Chip>
					{/each}
				</ChipGroup>
				{#if tagsHere.length > 0 || hasNotes}
					<ChipGroup label={SHEET.tags} variant="loose">
						{#each tagsHere as tag (tag)}
							<Chip
								size="sm"
								label="Show {tagLabel(tag)}"
								pressed={tagFilter === tag}
								onclick={() => pickTag(tag)}>{tagLabel(tag)}</Chip
							>
						{/each}
						{#if hasNotes}
							<Chip
								size="sm"
								label={SHEET.showNotes}
								pressed={tagFilter === NOTES}
								onclick={() => pickTag(NOTES)}>{SHEET.notes}</Chip
							>
						{/if}
					</ChipGroup>
				{/if}
				{#if visible.length !== rows.length}
					<Label>{plural(visible.length, 'player')} shown</Label>
				{/if}
			</div>
			<SheetList
				{store}
				rows={visible}
				{position}
				{ranks}
				board={ourBoard.byId}
				movable={needle === ''}
				ownTags={own}
				onannounce={(words: string) => (announcement = words)}
			/>
		{/if}
		<LiveRegion words={announcement} />
	</main>
</Shell>

<style>
	.sheet {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.lead {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		justify-content: space-between;
		gap: var(--s-3);
	}

	.title {
		min-width: 0;
	}

	h2 {
		margin: 0;
	}

	h2 button {
		padding: 0;
		border: 0;
		background: transparent;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-2xl);
		line-height: 0.9;
		text-transform: uppercase;
		text-align: left;
		cursor: text;
	}

	.title p {
		margin: 6px 0 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		/* Its quiet buttons arrive with your sheet. The row is held open so nothing below moves. */
		min-height: 34px;
	}

	.spread {
		display: contents;
	}

	.folded {
		display: none;
	}

	.notices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.notices li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		padding: var(--s-2) var(--s-3);
		border-left: 4px solid var(--accent);
		background: var(--surface);
		font-size: var(--t-sm);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3);
	}

	@media (max-width: 760px) {
		.sheet {
			padding: var(--s-3) var(--s-4) var(--s-4);
			gap: var(--s-3);
		}

		.tools {
			flex-wrap: nowrap;
		}

		/* The filters stay one line a thumb slides, so the first rows are on the first screen. */
		.filters {
			flex-wrap: nowrap;
			overflow-x: auto;
			margin: 0 calc(-1 * var(--s-4));
			padding: 0 var(--s-4);
			scrollbar-width: none;
		}

		.filters > :global(*) {
			flex-shrink: 0;
		}

		.filters :global(.loose) {
			flex-wrap: nowrap;
		}

		.spread {
			display: none;
		}

		.folded {
			display: inline-flex;
		}

		/* The tools take their own line, so the status words growing beside the name never
		   wrap them down after the page has painted. */
		.lead {
			flex-direction: column;
			align-items: flex-start;
		}

		h2 button {
			font-size: 34px;
		}
	}
</style>
