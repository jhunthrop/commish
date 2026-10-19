<script lang="ts">
	import { listWords } from '#lib/format/list.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Field from '#lib/ui/Field.svelte';
	import NumberField from '#lib/ui/NumberField.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { ApiError, rooms } from '../api.ts';
	import {
		IMPORT_HOSTS,
		RULE_GROUPS,
		droppedGroups,
		hostOfLink,
		importLine,
		pointsWords,
		ruleLabel,
		type ImportHost,
		type RuleGroup,
		type RuleKey,
		type ScoringImport,
		type ScoringRules
	} from './rules.ts';

	/** A league's own scoring: bring the rules in from the league's host, or enter them by hand, all
	 * 21 on one form. What the host scores that we do not is named, never silently left out. */
	interface Props {
		rules: ScoringRules;
		onchange: (rules: ScoringRules) => void;
	}

	let { rules, onchange }: Props = $props();

	let host = $state<ImportHost>('sleeper');
	let link = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let result = $state<ScoringImport | null>(null);
	const hint = $derived(IMPORT_HOSTS.find((h) => h.host === host)?.hint ?? '');

	async function bringIn(): Promise<void> {
		if (busy || link.trim() === '') return;
		busy = true;
		problem = null;
		try {
			const got = await rooms.importScoring(host, link.trim());
			result = got;
			onchange(got.rules);
		} catch (e) {
			result = null;
			problem =
				e instanceof ApiError
					? (e.fields.link ?? e.message)
					: "Your league's rules did not come in. Try again.";
		} finally {
			busy = false;
		}
	}

	function setRule(key: RuleKey, value: number): void {
		onchange({ ...rules, [key]: value });
	}
</script>

<div class="custom">
	<div class="bring">
		<div class="link">
			<Field
				label="League link"
				bind:value={link}
				placeholder={hint}
				maxlength={300}
				onenter={bringIn}
				oninput={(text: string) => (host = hostOfLink(text) ?? host)}
			/>
			<Quiet disabled={busy || link.trim() === ''} onclick={bringIn}>Bring in your rules</Quiet>
		</div>
		<!-- The link names its host; the chips confirm it, and say which host a bare league id is on. -->
		<div class="host">
			<span class="note">On</span>
			<ChipGroup label="Your league's platform">
				{#each IMPORT_HOSTS as h (h.host)}
					<Chip size="sm" pressed={host === h.host} onclick={() => (host = h.host)}>{h.label}</Chip>
				{/each}
			</ChipGroup>
		</div>
		{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		{#if result}
			<p class="took">{importLine(result)}</p>
			{#if result.dropped.length > 0}
				<p class="note">Your league also scores these. Our board leaves them out.</p>
				<div class="left">
					{#each droppedGroups(result.dropped) as group (group.label)}
						<h4>{group.label}</h4>
						<dl>
							{#each group.rules as d, i (i)}
								<dt>{d.rule}</dt>
								<dd>{d.points === null ? '' : pointsWords(d.points)}</dd>
							{/each}
						</dl>
					{/each}
				</div>
			{/if}
			{#if result.defaulted.length > 0}
				<p class="note">
					Your league does not set these, so they score the standard way: {listWords(
						result.defaulted.map((d) => ruleLabel(d).toLowerCase())
					)}.
				</p>
			{/if}
		{/if}
		{#if !result}<p class="note">On Yahoo, enter your league's rules below.</p>{/if}
	</div>
	<div class="groups">
		{#each RULE_GROUPS.filter((g) => !g.boardless) as group (group.label)}
			{@render fields(group)}
		{/each}
	</div>
	<section class="record" aria-label="Kickers and defenses">
		<h3>Kickers and defenses</h3>
		<p class="note">
			Kickers and defenses rank in draft order, so these change nothing on the board. They stay with
			your league's record.
		</p>
		<div class="groups">
			{#each RULE_GROUPS.filter((g) => g.boardless) as group (group.label)}
				{@render fields(group)}
			{/each}
		</div>
	</section>
</div>

{#snippet fields(group: RuleGroup)}
	<fieldset>
		<legend>{group.label}, points</legend>
		{#each group.rules as r (r.key)}
			<NumberField
				label={r.label}
				value={rules[r.key]}
				step={r.step}
				onchange={(v: number) => setRule(r.key, v)}
			/>
		{/each}
	</fieldset>
{/snippet}

<style>
	.custom {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		min-width: 0;
	}

	.bring {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		max-width: 640px;
	}

	.link {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--s-2);
		align-items: end;
	}

	.host {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}

	.took {
		margin: 0;
		font-size: var(--t-sm);
		font-weight: 600;
	}

	.note {
		margin: 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.record {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding-top: var(--s-3);
		border-top: 1px solid var(--line);
	}

	h3 {
		margin: 0;
		font-size: var(--t-sm);
		font-weight: 600;
	}

	.left {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		max-width: 420px;
	}

	h4 {
		margin: var(--s-1) 0 0;
		font-size: var(--t-xs);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		font-weight: 500;
		color: var(--ink-3);
	}

	dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px var(--s-3);
		margin: 0;
		font-size: var(--t-sm);
	}

	dt {
		color: var(--ink-2);
	}

	dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: var(--s-3) var(--s-5);
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}

	legend {
		padding: 0 0 var(--s-1);
		font-size: var(--t-xs);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		font-weight: 500;
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.link {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
