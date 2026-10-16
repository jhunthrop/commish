/** The clock a prerendered page says a capture's time on (Lane 63): the NFL's Eastern clock while the
 * page is drawn and hydrated, so the HTML and its first frame agree, then the member's own once it is
 * live. Call while a component is set up; the getter is the zone to say times in. */
import { onMount } from 'svelte';
import { memberZone } from './clock.ts';

const EASTERN = 'America/New_York';

export function memberClock(): () => string {
	let zone = $state(EASTERN);
	onMount(() => {
		zone = memberZone();
	});
	return () => zone;
}
