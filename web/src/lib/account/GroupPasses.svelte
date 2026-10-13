<script lang="ts">
	import { COPIED_MS } from '#lib/room/actions.ts';
	import { Flash } from '#lib/room/flash.svelte.ts';
	import LineList from '#lib/ui/LineList.svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { AccountGroupPass } from './account-api.ts';
	import { groupPassLine, seatLines } from './words.ts';

	/** The group passes this account bought: each league's claim link to copy and share, and every
	 * seat, claimed by whom and when, or still open. */
	interface Props {
		passes: readonly AccountGroupPass[];
	}

	let { passes }: Props = $props();

	const copied = new Flash(COPIED_MS);
	let copiedId = $state<string | null>(null);

	async function copy(pass: AccountGroupPass): Promise<void> {
		await navigator.clipboard.writeText(pass.claim_url);
		copiedId = pass.id;
		copied.show();
	}
</script>

<section class="passes" aria-label="Your group passes">
	<PanelHead title="Your group passes" aside={String(passes.length)} level={2} />
	{#each passes as pass (pass.id)}
		<Panel as="section" label={pass.league_name}>
			<div class="pass">
				<PanelHead title={pass.league_name} aside="{pass.claimed} of {pass.seats} claimed" />
				<p class="line">{groupPassLine(pass)}</p>
				{#if pass.status === 'active'}
					<div class="link">
						<span class="url">{pass.claim_url}</span>
						<Quiet size="sm" onclick={() => void copy(pass)}>
							{copied.on && copiedId === pass.id ? 'Link copied' : 'Copy the claim link'}
						</Quiet>
					</div>
					<LineList label="Seats on {pass.league_name}" lines={seatLines(pass)} />
				{/if}
			</div>
		</Panel>
	{/each}
	<LiveRegion words={copied.on ? 'Link copied' : ''} />
</section>

<style>
	.passes,
	.pass {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.line,
	.url {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.url {
		overflow-wrap: anywhere;
		min-width: 0;
	}

	.link {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
	}
</style>
