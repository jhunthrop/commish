<script lang="ts">
	import { untrack } from 'svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { SHEET_LIMITS } from './limits.ts';
	import type { SheetRow } from './model.ts';
	import type { TagToggle } from './store.svelte.ts';
	import { FIXED_TAGS, canonicalTag, hasTag, tagLabel, tagProblem } from './tags.ts';

	interface Props {
		row: SheetRow;
		/** Your own tags anywhere on the sheet, offered here too. */
		ownTags: readonly string[];
		canStartTier: boolean;
		startsTier: boolean;
		/** Every keystroke of his note, so the sheet holds it before anything else is tapped. */
		onnote: (note: string) => void;
		/** A tap on a tag, applied to his row as the sheet holds it then. */
		ontag: (tag: string) => TagToggle;
		onstarttier: () => void;
		onremove: () => void;
	}

	let { row, ownTags, canStartTier, startsTier, onnote, ontag, onstarttier, onremove }: Props =
		$props();

	// The field starts from his note when the row opens and writes every keystroke back.
	let note = $state(untrack(() => row.note ?? ''));
	let newTag = $state('');
	let tagError = $state<string | null>(null);

	const full = $derived(row.tags.length >= SHEET_LIMITS.tags);
	const has = (tag: string): boolean => hasTag(row.tags, tag);
	const FULL = `Keep it to ${String(SHEET_LIMITS.tags)} tags`;

	function toggle(tag: string): void {
		tagError = ontag(tag) === 'full' ? FULL : null;
	}

	function addOwn(): void {
		const tag = canonicalTag(newTag);
		if (tag === '') return;
		tagError = tagProblem(tag);
		if (tagError) return;
		if (!has(tag)) toggle(tag);
		if (tagError === null) newTag = '';
	}

	function onTagKey(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		addOwn();
	}
</script>

<div class="editor">
	<Field
		label="Your note on {row.name}"
		hideLabel
		multiline
		rows={2}
		maxlength={SHEET_LIMITS.note}
		placeholder="Your note"
		bind:value={note}
		oninput={onnote}
		autofocus
	/>
	<div class="tags">
		<ChipGroup label="Tags on {row.name}" variant="loose">
			{#each FIXED_TAGS as { tag, label } (tag)}
				<Chip size="sm" pressed={has(tag)} onclick={() => toggle(tag)}>{label}</Chip>
			{/each}
			{#each ownTags as tag (tag)}
				<Chip size="sm" pressed={has(tag)} onclick={() => toggle(tag)}>{tagLabel(tag)}</Chip>
			{/each}
		</ChipGroup>
		{#if !full}
			<div class="own">
				<Field
					label="Your own tag"
					hideLabel
					placeholder="Your own tag"
					maxlength={SHEET_LIMITS.tagLength}
					bind:value={newTag}
					onkeydown={onTagKey}
				/>
				<Quiet size="sm" onclick={addOwn}>Add tag</Quiet>
			</div>
		{/if}
		{#if tagError}<p class="error" role="alert">{tagError}</p>{/if}
	</div>
	<div class="actions">
		{#if canStartTier && !startsTier}
			<Quiet size="sm" onclick={onstarttier}>Start a tier here</Quiet>
		{/if}
		<Quiet size="sm" onclick={onremove}>Take off my sheet</Quiet>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		max-width: 720px;
	}

	.tags {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.own {
		display: flex;
		gap: var(--s-2);
		align-items: center;
		max-width: 360px;
	}

	.error {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--loss-ink);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}
</style>
