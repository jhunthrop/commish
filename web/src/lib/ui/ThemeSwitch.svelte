<script lang="ts">
	import { onMount } from 'svelte';
	import {
		THEME_LABELS,
		THEME_MODES,
		applyTheme,
		browserStorage,
		readSavedTheme,
		saveTheme,
		type ThemeMode
	} from './theme.ts';

	// The server renders Auto pressed. The boot script has already applied a saved theme
	// before paint, and mounting brings the pressed button in line with it.
	let mode = $state<ThemeMode>('auto');

	onMount(() => {
		mode = readSavedTheme(browserStorage);
	});

	function choose(next: ThemeMode): void {
		mode = next;
		applyTheme(document.documentElement, next);
		saveTheme(browserStorage, next);
	}
</script>

<div class="theme" role="group" aria-label="Theme">
	{#each THEME_MODES as option (option)}
		<button type="button" aria-pressed={mode === option} onclick={() => choose(option)}>
			{THEME_LABELS[option]}
		</button>
	{/each}
</div>

<style>
	.theme {
		display: flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	button {
		height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-sm);
		background: transparent;
		cursor: pointer;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
	}

	button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--bg);
	}

	@media (max-width: 760px) {
		button {
			height: 26px;
			padding: 0 7px;
			font-size: var(--t-xs);
		}
	}
</style>
