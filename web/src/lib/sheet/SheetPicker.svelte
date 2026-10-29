<script lang="ts">
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { plural } from '#lib/format/number.ts';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { FORMAT_LABELS } from './format.ts';
	import type { SheetStore } from './store.svelte.ts';
	import { SHEET } from './words.ts';

	/** Your sheets: the account's (open, start, delete) and any saved in this browser that are not
	 * on the account yet (open, signed out). */
	interface Props {
		store: SheetStore;
		onclose: () => void;
	}

	let { store, onclose }: Props = $props();

	let confirming = $state<string | null>(null);
	const current = $derived(store.stored.sync?.sheetId ?? null);

	async function open(id: string): Promise<void> {
		await store.open(id);
		onclose();
	}

	async function startNew(): Promise<void> {
		await store.startNew(siteContext.format ?? store.sheet.format);
		onclose();
	}
</script>

<Panel as="section" label={SHEET.yourSheets}>
	<ul>
		{#each store.sheets as sheet (sheet.id)}
			<li class:current={sheet.id === current}>
				<span class="who">
					<b>{sheet.name}</b>
					<Label>{FORMAT_LABELS[sheet.format]} · {plural(sheet.rowCount, 'player')}</Label>
				</span>
				<span class="tools">
					{#if sheet.id !== current}
						<Quiet size="sm" onclick={() => void open(sheet.id)}>{SHEET.openSheet}</Quiet>
					{/if}
					{#if confirming === sheet.id}
						<Quiet size="sm" onclick={() => void store.deleteSheet(sheet.id)}
							>{SHEET.deleteIt}</Quiet
						>
						<Quiet size="sm" onclick={() => (confirming = null)}>{SHEET.keepIt}</Quiet>
					{:else}
						<Quiet size="sm" onclick={() => (confirming = sheet.id)}>{SHEET.deleteSheet}</Quiet>
					{/if}
				</span>
			</li>
		{/each}
		{#each store.stored.shelf as sheet, index (index)}
			<li>
				<span class="who">
					<b>{sheet.name}</b>
					<Label
						>{FORMAT_LABELS[sheet.format]} · {plural(sheet.rows.length, 'player')} · in this browser</Label
					>
				</span>
				{#if !store.signedIn}
					<span class="tools">
						<Quiet
							size="sm"
							onclick={() => {
								store.openShelved(index);
								onclose();
							}}>{SHEET.openSheet}</Quiet
						>
					</span>
				{/if}
			</li>
		{/each}
	</ul>
	<div class="foot">
		{#if store.signedIn}
			<Quiet size="sm" onclick={() => void startNew()}>{SHEET.newSheet}</Quiet>
		{/if}
		<Quiet size="sm" onclick={onclose}>{SHEET.done}</Quiet>
	</div>
</Panel>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		padding: var(--s-2) var(--s-2);
		border-bottom: 1px solid var(--line);
	}

	.current {
		background: var(--accent-wash);
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.tools,
	.foot {
		display: flex;
		gap: var(--s-2);
	}

	.foot {
		margin-top: var(--s-3);
	}
</style>
