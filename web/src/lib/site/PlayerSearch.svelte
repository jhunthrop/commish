<script lang="ts">
	import { goto } from '$app/navigation';
	import Search from '#lib/ui/Search.svelte';
	import { SHELL } from '#lib/ui/shell-words.ts';
	import type SearchMenuType from '#lib/ui/SearchMenu.svelte';
	import type { SearchSession } from './search-session.svelte.ts';

	interface Props {
		/** "Search 619 ranked players": the run's count of players with a page, in words. */
		placeholder: string;
	}

	let { placeholder }: Props = $props();

	const MENU_ID = 'player-search-menu';
	let query = $state('');
	let session = $state<SearchSession | null>(null);
	let Menu = $state<typeof SearchMenuType | null>(null);

	/** The search's logic and its menu load on the first focus, so a page only read never pays for them. */
	async function start(): Promise<void> {
		const [{ SearchSession: Session }, menu] = await Promise.all([
			import('./search-session.svelte.ts'),
			import('#lib/ui/SearchMenu.svelte')
		]);
		const next = new Session();
		next.typed(query);
		next.open = query.trim() !== '';
		session = next;
		Menu = menu.default;
		await next.load();
	}

	function onKeydown(event: KeyboardEvent): void {
		const hit = session?.key(event);
		if (hit) void goto(hit.href);
	}

	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		const inside = next instanceof Node && (event.currentTarget as HTMLElement).contains(next);
		if (!inside && session) session.open = false;
	}

	function onFocusIn(): void {
		if (session) session.open = true;
	}
</script>

<div class="find" onfocusout={onFocusOut} onfocusin={onFocusIn}>
	<Search
		bind:value={query}
		{placeholder}
		label={SHELL.searchPlayers}
		onfirstfocus={() => void start()}
		oninput={(value: string) => session?.typed(value)}
		controls={MENU_ID}
		expanded={session?.showing ?? false}
		activeOption={session?.showing && session.active >= 0
			? `${MENU_ID}-${String(session.active)}`
			: undefined}
		onkeydown={onKeydown}
	/>
	{#if Menu && session?.showing}
		<Menu id={MENU_ID} hits={session.hits} active={session.active} empty={session.empty} />
	{/if}
</div>

<style>
	.find {
		position: relative;
		flex: 1;
		display: flex;
		min-width: 0;
	}
</style>
