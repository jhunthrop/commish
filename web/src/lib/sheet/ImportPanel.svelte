<script lang="ts">
	import Field from '#lib/ui/Field.svelte';
	import FilePick from '#lib/ui/FilePick.svelte';
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
	import { SHEET_IMPORT } from './words.ts';

	interface Props {
		store: SheetStore;
		directory: PlayerDirectory;
		onclose: () => void;
	}

	let { store, directory, onclose }: Props = $props();

	/** How many skipped lines the preview names before it counts the rest. */
	const SKIPS_SHOWN = 12;

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
			problem = SHEET_IMPORT.boardNotLoaded;
		}
	}

	function withFaces(rows: readonly SheetRow[]): readonly SheetRow[] {
		return rows.map((row) => ({ ...row, headshot: row.headshot ?? faces.get(row.id) ?? null }));
	}

	/** True when the text read as a sheet. */
	function settle(run: () => CsvRead | 'needs-board'): boolean {
		problem = null;
		try {
			const result = run();
			if (result === 'needs-board') {
				problem = SHEET_IMPORT.boardLoading;
				return false;
			}
			read = { ...result, rows: withFaces(result.rows) };
			return true;
		} catch (error) {
			read = null;
			problem = error instanceof CsvHeaderError ? error.message : SHEET_IMPORT.unreadable;
			return false;
		}
	}

	async function onFile(file: File): Promise<boolean> {
		try {
			const text = await readCsvFile(file);
			await loadBoard();
			return settle(() => decodeCsv(text));
		} catch (error) {
			read = null;
			problem = error instanceof Error ? error.message : SHEET_IMPORT.didNotOpen;
			return false;
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

	const verb = $derived(store.sheet.rows.length > 0 ? SHEET_IMPORT.replace : SHEET_IMPORT.use);
</script>

<Panel as="section" label={SHEET_IMPORT.head}>
	<div class="import">
		<div class="sources">
			<div class="file">
				<Label>{SHEET_IMPORT.fileLabel}</Label>
				<FilePick
					label={SHEET_IMPORT.chooseFile}
					accept=".csv,text/csv"
					empty={SHEET_IMPORT.noFile}
					onpick={onFile}
				/>
			</div>
			<Field
				label={SHEET_IMPORT.pasteLabel}
				multiline
				mono
				rows={6}
				bind:value={pasted}
				oninput={(text: string) => void onPaste(text)}
				placeholder={SHEET_IMPORT.pasteExample}
			/>
		</div>
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
			<Quiet onclick={onclose}>{SHEET_IMPORT.cancel}</Quiet>
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

	/* The file and the paste box side by side, two ways in to one sheet. */
	.sources {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: var(--s-5);
		width: 100%;
		align-items: start;
	}

	.file {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	@media (max-width: 760px) {
		.sources {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-4);
		}
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
