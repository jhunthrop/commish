<script lang="ts">
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { MockRoom } from './api.ts';
	import { MOCK, runSharedWords, sharedAt, sharedTitle } from './mock-words.ts';
	import { formatLine } from './words.ts';

	interface Props {
		room: MockRoom;
		/** Starting the reader's own mock from this one is in flight. */
		starting: boolean;
		onrun: () => void;
	}

	let { room, starting, onrun }: Props = $props();

	const at = $derived(sharedAt(room.status === 'complete', room.pick_number, room.teams));
</script>

<!-- A shared draft is a reader's page: whose it is in the third person, where it stands, and one verb
     that runs it as the reader's own. -->
<header class="head">
	<div>
		<DisplayTitle size="page">{sharedTitle(room.shared_by, room.slot)}</DisplayTitle>
		<p>{formatLine(room.settings)} · {at}</p>
	</div>
	<div class="act">
		<Verb onclick={onrun} disabled={starting}>{runSharedWords(room.slot)}</Verb>
		<p class="note">{MOCK.sharedNote}</p>
	</div>
</header>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--s-3) var(--s-5);
		padding-bottom: var(--s-4);
		border-bottom: 1px solid var(--line);
	}

	p {
		margin: var(--s-2) 0 0;
		color: var(--ink-2);
	}

	.act {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		max-width: 44ch;
	}

	.note {
		font-size: var(--t-sm);
		color: var(--ink-3);
	}
</style>
