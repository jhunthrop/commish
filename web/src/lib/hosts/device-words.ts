/** The Paired devices list's words (Lane 198): the account page's and the apps' Account screens', each
 * device's line built here so all three say it alike. Dates on the site's clock (format/date.ts). */
import { dayLabel } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import type { Device } from './api.ts';

export const DEVICES = {
	title: 'Paired devices',
	unpair: 'Unpair',
	unpairing: 'Unpairing',
	paired: 'Paired',
	lastUsed: 'last used',
	notUsed: 'not used yet',
	pair: 'Pair a device',
	codeNote: 'Type these six words where the device asks. They work once, for ten minutes.',
	/** The apps mark the phone they run on in the list. */
	thisPhone: 'This phone'
} as const;

/** "Paired Oct 12, last used Oct 17", "Paired Oct 12, not used yet". */
export function deviceLine(device: Pick<Device, 'created_at' | 'last_used_at'>): string {
	const used = device.last_used_at
		? `${DEVICES.lastUsed} ${dayLabel(device.last_used_at)}`
		: DEVICES.notUsed;
	return `${DEVICES.paired} ${dayLabel(device.created_at)}, ${used}`;
}

/** The list head's count: "2 devices". */
export function deviceCount(count: number): string {
	return plural(count, 'device');
}
