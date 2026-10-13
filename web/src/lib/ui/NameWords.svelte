<script lang="ts">
	/** A name that breaks only between its words, never at the hyphen inside one: "Amon-Ra St.
	 * Brown" may wrap before "St.", and "Jaxon Smith-Njigba" before "Smith-Njigba". */
	interface Props {
		name: string;
	}

	let { name }: Props = $props();

	const SPACE = ' ';
	const words = $derived(name.split(SPACE));
</script>

{#each words as word, i (i)}{#if i > 0}{SPACE}{/if}<span class="word">{word}</span>{/each}

<style>
	.word {
		white-space: nowrap;
	}
</style>
