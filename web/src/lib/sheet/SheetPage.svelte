<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { plural } from '#lib/format/number.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Label from '#lib/ui/Label.svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { RAIL } from '#lib/ui/nav.ts';
	import { POSITIONS, type Position } from '#lib/types/player.ts';
	import { fileDirectory } from './directory.ts';
	import { downloadCsv } from './files.ts';
	import { FORMAT_LABELS } from './format.ts';
	import ImportPanel from './ImportPanel.svelte';
	import { SHEET_LIMITS } from './limits.ts';
	import { rowFor, ranksOf, type SheetRow } from './model.ts';
	import SheetList from './SheetList.svelte';
	import SheetPicker from './SheetPicker.svelte';
	import { sheetStore as store, type SyncStatus } from './store.svelte.ts';
	import { FIXED_TAGS, ownTags, sameTag, tagLabel } from './tags.ts';

	const directory = fileDirectory();
	/** The mock draft section, whose route another lane builds. */
	const mockHref = RAIL.find((item) => item.section === 'mock')?.href;
	const NOTES = 'notes';
	const UNDO_KEY = 'z';
	/** The undo key as this machine's keyboard prints it. */
	const undoKey =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
			? '⌘Z'
			: 'Ctrl Z';

	let query = $state('');
	let position = $state<Position | null>(null);
	let tagFilter = $state<string | null>(null);
	let panel = $state<'import' | 'sheets' | null>(null);
	let renaming = $state(false);
	let announcement = $state('');
	let ourRanks = $state.raw<ReadonlyMap<string, number> | null>(null);
	let starting = $state(false);
	let boardProblem = $state<string | null>(null);

	const sheet = $derived(store.sheet);
	const rows = $derived(sheet.rows);
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

	const STATUS_WORDS: Record<SyncStatus, string> = {
		local: 'Saved in this browser',
		checking: 'Saved in this browser',
		saving: 'Saving to your account',
		saved: 'Saved to your account',
		offline: 'Offline, saved in this browser',
		failed: 'Not saved to your account',
		'storage-blocked': 'This browser is not keeping it'
	};
	const statusWords = $derived(
		store.status === 'failed' && store.problem ? store.problem : STATUS_WORDS[store.status]
	);

	async function loadOurRanks(): Promise<void> {
		try {
			const board = await directory.board(sheet.format);
			ourRanks = board ? new Map(board.map((player) => [player.id, player.rank])) : null;
		} catch {
			ourRanks = null;
		}
	}

	async function startFromBoard(): Promise<void> {
		starting = true;
		boardProblem = null;
		try {
			const board = await directory.board(sheet.format);
			if (!board) {
				boardProblem = `We have no ${FORMAT_LABELS[sheet.format]} board yet`;
				return;
			}
			store.replace(board.slice(0, SHEET_LIMITS.rows).map(rowFor));
		} catch {
			boardProblem = 'Our board did not load. Try again in a moment';
		} finally {
			starting = false;
		}
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
		announcement = 'Undone';
	}

	function pickTag(value: string): void {
		tagFilter = tagFilter === value ? null : value;
	}

	onMount(() => {
		store.load();
		void loadOurRanks();
	});
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>Your cheat sheet · Commish</title>
</svelte:head>

<Shell title="Cheat sheet" active="sheet">
	{#snippet search()}
		<Search
			placeholder="Search your {plural(rows.length, 'player')}"
			label="Search your sheet"
			bind:value={query}
		/>
	{/snippet}
	{#snippet tail()}
		{#if rows.length > 0}
			<Verb href={mockHref}>Start a mock draft</Verb>
		{/if}
	{/snippet}

	<main class="sheet">
		<div class="lead">
			<div class="title">
				{#if renaming}
					<Field
						label="Sheet name"
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
					{FORMAT_LABELS[sheet.format]} · {plural(rows.length, 'player')} ·
					<span aria-live="polite">{statusWords}</span>
				</p>
			</div>
			<div class="tools">
				{#if store.canUndo}<Quiet size="sm" key={undoKey} onclick={() => store.undo()}>Undo</Quiet
					>{/if}
				<Quiet size="sm" onclick={() => (panel = panel === 'import' ? null : 'import')}
					>Import</Quiet
				>
				{#if rows.length > 0}
					<Quiet size="sm" onclick={() => downloadCsv(sheet)}>Export CSV</Quiet>
					<Quiet size="sm" href={resolve('/sheet/print')}>Print</Quiet>
				{/if}
				{#if store.signedIn}
					<Quiet size="sm" onclick={() => (panel = panel === 'sheets' ? null : 'sheets')}
						>Your sheets</Quiet
					>
				{:else if store.loaded}
					<Quiet size="sm" href={store.signInUrl(resolve('/sheet'))}>Save it to your account</Quiet>
				{/if}
			</div>
		</div>

		{#if panel === 'import'}
			<ImportPanel {store} {directory} onclose={() => (panel = null)} />
		{:else if panel === 'sheets'}
			<SheetPicker {store} onclose={() => (panel = null)} />
		{/if}

		{#if store.loaded && rows.length === 0 && panel === null}
			<Panel as="section" label="Start your sheet">
				<div class="start">
					<Verb size="lg" disabled={starting} onclick={() => void startFromBoard()}
						>Start from our board</Verb
					>
					<Quiet size="lg" onclick={() => (panel = 'import')}>Import a sheet</Quiet>
					{#if boardProblem}<p class="problem" role="alert">{boardProblem}</p>{/if}
				</div>
			</Panel>
		{/if}

		{#if rows.length > 0}
			<div class="filters">
				<ChipGroup label="Position">
					<Chip pressed={position === null} onclick={() => (position = null)}>All</Chip>
					{#each positionsHere as p (p)}
						<Chip pressed={position === p} onclick={() => (position = p)}>{p}</Chip>
					{/each}
				</ChipGroup>
				{#if tagsHere.length > 0 || hasNotes}
					<ChipGroup label="Tags" variant="loose">
						{#each tagsHere as tag (tag)}
							<Chip size="sm" pressed={tagFilter === tag} onclick={() => pickTag(tag)}
								>{tagLabel(tag)}</Chip
							>
						{/each}
						{#if hasNotes}
							<Chip size="sm" pressed={tagFilter === NOTES} onclick={() => pickTag(NOTES)}
								>Notes</Chip
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
				{ourRanks}
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
		max-width: 1180px;
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
	}

	.start {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
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
			padding: var(--s-4) var(--s-3);
		}

		h2 button {
			font-size: 34px;
		}
	}
</style>
