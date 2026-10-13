<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { rowsFromDraft, type FinishedDraft } from './draft.ts';
	import type { BoardFormat } from './model.ts';
	import { sheetStore } from './store.svelte.ts';

	/**
	 * The report's "Save this draft as a sheet". Signed in it becomes a new sheet on your account,
	 * so the sheet you had stays. Signed out it replaces this browser's sheet, and Undo on the sheet
	 * page brings the old one back. Mount it on the mock report with the room's picks and board.
	 */
	interface Props {
		draft: FinishedDraft;
		format: BoardFormat;
	}

	let { draft, format }: Props = $props();

	let saved = $state(false);

	onMount(() => sheetStore.load());

	async function save(): Promise<void> {
		const rows = rowsFromDraft(draft);
		if (sheetStore.signedIn) await sheetStore.startNew(format, rows);
		else sheetStore.replace(rows, format);
		saved = true;
	}
</script>

<span aria-live="polite">
	{#if saved}
		<Quiet href={resolve('/sheet')}>Open your sheet</Quiet>
	{:else}
		<Quiet onclick={() => void save()}>Save this draft as a sheet</Quiet>
	{/if}
</span>
