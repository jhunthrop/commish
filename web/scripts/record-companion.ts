// Records the live-draft companion's answers for the apps' companion screen (Lane 210): the recorded
// Sleeper draft (api/internal/companion/replay) replayed from slot 5 by a development API run with
// COMPANION_REPLAY=true, read as the web's page reads it (CompanionPage.svelte: the first read with
// since 0 carries the board, every later read names the pick count it holds), at five moments: while
// others pick before the drafter's first turn, between turns, at the drafter's second turn, just after
// that pick lands, and once the draft is over; then the report and the account's followed drafts. Each
// file is the API's envelope as it answered, unchanged.
//
//   API=http://localhost:18210 TOKEN_FILE=<a device token's file> node scripts/record-companion.ts
//
// The replay drafts a pick a second and holds 12 seconds before each of the drafter's picks: picks 1 to
// 4 land in the first 4 seconds, pick 5 at 17, picks 6 to 19 by 31, pick 20 at 44, and the draft's 240
// picks by 480. The moments sit inside those windows.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const api = process.env.API ?? 'http://localhost:18210';
const tokenFile = process.env.TOKEN_FILE;
if (!tokenFile) throw new Error('TOKEN_FILE is required: a file holding a device token');
const token = (await readFile(tokenFile, 'utf8')).trim();

const OUT = new URL('../../shared/fixtures/companion/', import.meta.url);
/** The drafter's slot in the replay. */
const SLOT = 5;
/** The moments, by name, in seconds after the companion is made. */
const MOMENTS = [
	{ name: 'waiting', at: 2.5 },
	{ name: 'between', at: 24 },
	{ name: 'turn', at: 37 },
	{ name: 'taken', at: 47 },
	{ name: 'complete', at: 492 }
] as const;

interface Envelope {
	ok: boolean;
	data: { id: string; pick_count: number; status: string } | null;
	error: { message: string } | null;
}

async function call(
	path: string,
	init: RequestInit = {}
): Promise<{ text: string; body: Envelope }> {
	const response = await fetch(`${api}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
	});
	const text = await response.text();
	const body = JSON.parse(text) as Envelope;
	if (!body.ok) throw new Error(`${path}: ${body.error?.message ?? String(response.status)}`);
	return { text, body };
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

await mkdir(OUT, { recursive: true });
const made = await call('/companions', {
	method: 'POST',
	body: JSON.stringify({ host: 'sleeper', draft: 'replay', seat: { slot: SLOT }, replay: true })
});
const started = Date.now();
const id = made.body.data?.id ?? '';
let since = 0;
for (const moment of MOMENTS) {
	await pause(Math.max(0, started + moment.at * 1000 - Date.now()));
	const read = await call(`/companions/${id}?since=${String(since)}`);
	await writeFile(new URL(`companion-${moment.name}.json`, OUT), read.text);
	process.stdout.write(
		`${moment.name} since ${String(since)}: ${String(read.body.data?.pick_count)} picks, ${String(read.body.data?.status)}\n`
	);
	since = read.body.data?.pick_count ?? since;
}
await writeFile(new URL('report.json', OUT), (await call(`/companions/${id}/report`)).text);
await writeFile(new URL('companions.json', OUT), (await call('/companions')).text);
process.stdout.write(`recorded ${id}\n`);
