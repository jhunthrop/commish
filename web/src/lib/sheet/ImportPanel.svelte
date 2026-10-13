<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { plural } from '#lib/format/number.ts';
	import { CsvHeaderError, decodeCsv, type CsvRead } from './csv.ts';
	import type { PlayerDirectory } from './directory.ts';
	import { readCsvFile } from './files.ts';
	import type { SheetRow } from './model.ts';
	import { nameIndex, readPaste, type NameIndex } from './paste.ts';
	import type { SheetStore } from './store.svelte.ts';

	interface Props {
		store: SheetStore;
		directory: PlayerDirectory;
		onclose: () => void;
	}

	let { store, directory, onclose }: Props = $props();

	/** How many skipped lines the preview names before it counts the rest. */
	const SKIPS_SHOWN = 12;
	const PASTE_EXAMPLE = "1. Puka Nacua\n2. Ja'Marr Chase, WR";

	let mode = $state<'file' | 'paste'>('file');
	let pasted = $state('');
	let read = $state.raw<CsvRead | null>(null);
	let problem = $state<string | null>(null);
	let index = $state.raw<NameIndex | null>(null);
	let faces = $state.raw<ReadonlyMap<string, string>>(new Map());

	async function loadBoard(): Promise<void> {
		if (index !== null) return;
		try {
			const board = (await directory.board(store.sheet.format)) ?? [];
			index = nameIndex(board);
			faces = new Map(
				board.flatMap((player) => (player.headshot ? [[player.id, player.headshot]] : []))
			);
		} catch {
			problem = 'Our board did not load, so a list of names cannot be read yet';
		}
	}

	function withFaces(rows: readonly SheetRow[]): readonly SheetRow[] {
		return rows.map((row) => ({ ...row, headshot: row.headshot ?? faces.get(row.id) ?? null }));
	}

	function settle(run: () => CsvRead | 'needs-board'): void {
		problem = null;
		try {
			const result = run();
			if (result === 'needs-board') {
				problem = 'Our board is still loading';
				return;
			}
			read = { ...result, rows: withFaces(result.rows) };
		} catch (error) {
			read = null;
			problem = error instanceof CsvHeaderError ? error.message : 'That file does not read as CSV';
		}
	}

	async function onFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const text = await readCsvFile(file);
			await loadBoard();
			settle(() => decodeCsv(text));
		} catch (error) {
			problem = error instanceof Error ? error.message : 'That file did not open';
		}
	}

	async function onPaste(text: string): Promise<void> {
		if (text.trim() === '') {
			read = null;
			return;
		}
		await loadBoard();
		settle(() => readPaste(text, index));
	}

	function use(): void {
		if (!read || read.rows.length === 0) return;
		store.replace(read.rows);
		onclose();
	}

	const verb = $derived(store.sheet.rows.length > 0 ? 'Replace my sheet' : 'Use this sheet');
</script>

<Panel as="section" label="Import">
	<div class="import">
		<ChipGroup label="Import from">
			<Chip pressed={mode === 'file'} onclick={() => (mode = 'file')}>A CSV file</Chip>
			<Chip pressed={mode === 'paste'} onclick={() => (mode = 'paste')}>Paste</Chip>
		</ChipGroup>
		{#if mode === 'file'}
			<label class="file">
				<span>Choose a CSV</span>
				<input type="file" accept=".csv,text/csv" onchange={onFile} />
			</label>
		{:else}
			<Field
				label="A CSV or a list of names, one per line"
				multiline
				mono
				rows={8}
				bind:value={pasted}
				oninput={(text: string) => void onPaste(text)}
				placeholder={PASTE_EXAMPLE}
			/>
		{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		{#if read}
			<div class="result" aria-live="polite">
				<b>{plural(read.rows.length, 'player')} read</b>
				{#if read.skipped.length > 0}
					<Label>{plural(read.skipped.length, 'line')} skipped</Label>
					<ul>
						{#each read.skipped.slice(0, SKIPS_SHOWN) as skip (skip.line)}
							<li>Line {skip.line}: {skip.reason}</li>
						{/each}
						{#if read.skipped.length > SKIPS_SHOWN}
							<li>And {read.skipped.length - SKIPS_SHOWN} more</li>
						{/if}
					</ul>
				{/if}
			</div>
		{/if}
		<div class="actions">
			<Verb onclick={use} disabled={!read || read.rows.length === 0}>{verb}</Verb>
			<Quiet onclick={onclose}>Cancel</Quiet>
		</div>
	</div>
</Panel>

<style>
	.import {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		align-items: flex-start;
	}

	.import > :global(label) {
		width: 100%;
	}

	.file {
		display: inline-flex;
		align-items: center;
		gap: var(--s-3);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		font-size: var(--t-sm);
	}

	ul {
		margin: 0;
		padding-left: var(--s-4);
		color: var(--ink-2);
	}

	.actions {
		display: flex;
		gap: var(--s-2);
	}
</style>
