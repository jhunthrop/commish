<script lang="ts">
	import { pickLabel } from '#lib/format/draft.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { MockRoom } from './api.ts';
	import { formatLine } from './words.ts';

	interface Props {
		room: MockRoom;
		/** Starting the reader's own mock from this one is in flight. */
		starting: boolean;
		onrun: () => void;
	}

	let { room, starting, onrun }: Props = $props();

	const whose = $derived(room.shared_by ? `${room.shared_by}'s mock` : 'A shared mock');
	const at = $derived(
		room.status === 'complete' ? 'finished' : `at pick ${pickLabel(room.pick_number, room.teams)}`
	);
</script>

<!-- A shared draft is a reader's page: whose it is in the third person, where it stands, and one verb
     that runs it as the reader's own. -->
<header class="head">
	<div>
		<DisplayTitle size="page">{whose} from slot {room.slot}</DisplayTitle>
		<p>{formatLine(room.settings)} · {at} · seed {room.seed}</p>
	</div>
	<div class="act">
		<Verb onclick={onrun} disabled={starting}>Run this draft from slot {room.slot}</Verb>
		<p class="note">
			The same settings and seed, so the bots draft the same way until a pick of yours changes the
			board.
		</p>
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
