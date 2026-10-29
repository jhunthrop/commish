<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { rowsFromDraft, type FinishedDraft } from './draft.ts';
	import { emptySheet, renameSheet, replaceRows, type BoardFormat } from './model.ts';
	import { sheetStore } from './store.svelte.ts';
	import { SHEET, SHEET_STATUS } from './words.ts';

	/**
	 * The report's "Save this draft as a sheet". It never replaces the sheet you have: it waits
	 * until the store knows whether you are signed in, then saves the draft as a new sheet on your
	 * account, or, signed out or offline, beside your sheet in this browser, from where the next
	 * sync puts it on your account. Mount it on the mock report with the room's picks and board.
	 */
	interface Props {
		draft: FinishedDraft;
		format: BoardFormat;
		/** The name the new sheet takes: "Mock, pick 5". */
		name: string;
	}

	let { draft, format, name }: Props = $props();

	let saved = $state<'account' | 'browser' | null>(null);
	let saving = $state(false);

	onMount(() => sheetStore.load());

	async function save(): Promise<void> {
		saving = true;
		const sheet = renameSheet(replaceRows(emptySheet(format), rowsFromDraft(draft)), name);
		saved = await sheetStore.saveAsNew(sheet);
		saving = false;
	}
</script>

<span aria-live="polite">
	{#if saved === 'account'}
		<Quiet href={resolve('/sheet')}>{SHEET.savedToSheets}</Quiet>
	{:else if saved === 'browser'}
		<Quiet href={resolve('/sheet')}>{SHEET_STATUS.inBrowser}</Quiet>
	{:else if !sheetStore.resolved}
		<Quiet disabled>{SHEET.checkingAccount}</Quiet>
	{:else}
		<Quiet disabled={saving} onclick={() => void save()}>{SHEET.saveDraft}</Quiet>
	{/if}
</span>
