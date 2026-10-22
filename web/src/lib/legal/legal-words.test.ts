// The legal pages' words, the site footer's and the account foot's (Lane 151): every sentence passes
// the one copy guard, each page names the operator, the contact and the draft note, the Privacy Policy
// carries each platform's consent word for word, and no sub-processor or projection source is named.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import { ESPN_CONSENT, FFPC_CONSENT, MFL_CONSENT } from '#lib/hosts/connection-words.ts';
import { creditSentence } from '#lib/site/credit.ts';
import { ACCOUNT_FOOT } from '#lib/account/foot-words.ts';
import { SUPPORT_EMAIL, SUPPORT_HREF } from './contact.ts';
import { FOOT } from './foot-words.ts';
import { DRAFT_NOTE, docText, paragraphText, type LegalDoc } from './legal-doc.ts';
import { PRIVACY } from './privacy-words.ts';
import { TERMS } from './terms-words.ts';

const DOCS: readonly LegalDoc[] = [TERMS, PRIVACY];

/** Gambling words the pages never print, past the guard's betting list (the brief's rule). */
const GAMBLING = /\b(gambl\w*|wager\w*|casino|stakes?|payouts?|winnings|sweepstakes|lottery)\b/i;

/** Who handles the data for us is said by role (sign-in, cloud, database, edge), never by name. */
const NAMED_VENDORS =
	/\b(WorkOS|AuthKit|Google|GCP|Cloud Run|Cloud SQL|Cloudflare|R2|Neon|Vercel|Stripe|Resend|Tank01|RapidAPI)\b/;

void test('every sentence on both pages passes the copy guard and names no vendor', () => {
	for (const doc of DOCS) {
		for (const sentence of docText(doc)) {
			assert.equal(bannedIn(sentence), null, `${doc.title}: ${sentence}`);
			assert.doesNotMatch(sentence, GAMBLING, `${doc.title}: ${sentence}`);
			assert.doesNotMatch(sentence, NAMED_VENDORS, `${doc.title}: ${sentence}`);
		}
	}
});

void test('each page opens with the draft note and names the operator, the law and the contact', () => {
	for (const doc of DOCS) {
		const text = docText(doc).join(' ');
		assert.equal(doc.draftNote, DRAFT_NOTE);
		assert.equal(DRAFT_NOTE, 'Draft for review.');
		assert.match(text, /Commish LLC, an Arkansas limited liability company/);
		assert.match(text, /governed by the laws of the State of Arkansas/);
		assert.ok(text.includes(SUPPORT_EMAIL), doc.title);
		assert.match(text, /18 (or|and) older/);
		assert.match(text, /free for the 2026 season/);
	}
});

void test('the contact is the support mailbox on the domain', () => {
	assert.equal(SUPPORT_EMAIL, 'support@trycommish.app');
	assert.equal(SUPPORT_HREF, 'mailto:support@trycommish.app');
});

void test('the Privacy Policy says each platform in the consent its member agreed to', () => {
	const paragraphs = PRIVACY.sections.flatMap((s) => s.paragraphs.map(paragraphText));
	assert.ok(paragraphs.includes(`ESPN. ${ESPN_CONSENT}`));
	assert.ok(paragraphs.includes(`FFPC. ${FFPC_CONSENT}`));
	assert.ok(paragraphs.includes(`MyFantasyLeague. ${MFL_CONSENT}`));
	assert.ok(paragraphs.some((p) => p.startsWith('Yahoo. ') && p.includes('Disconnect deletes')));
	assert.ok(paragraphs.some((p) => p.includes('Sleeper') && p.includes('needs no sign-in')));
});

void test('the Privacy Policy states the cookies, the browser, no analytics and the deletion path', () => {
	const text = docText(PRIVACY).join(' ');
	for (const fact of [
		'one session cookie',
		'30 days',
		'ten minutes',
		'90 days',
		'Your theme and a copy of your cheat sheet are kept in your browser',
		'We run no analytics and no ad scripts',
		'A sign-in service',
		'A cloud runs our servers and the database',
		'An edge network',
		'we delete your account'
	]) {
		assert.ok(text.includes(fact), fact);
	}
});

void test('the Terms print the data licence sentence the player page prints', () => {
	const paragraphs = TERMS.sections.flatMap((s) => s.paragraphs.map(paragraphText));
	assert.ok(paragraphs.includes(creditSentence()));
});

void test('each link names a place the page resolves', () => {
	for (const doc of DOCS) {
		for (const part of doc.sections.flatMap((s) => s.paragraphs.flat())) {
			if (typeof part === 'string') continue;
			assert.ok(['support', 'terms', 'privacy', 'licence'].includes(part.to), part.text);
			if (part.to === 'support') assert.equal(part.text, SUPPORT_EMAIL);
		}
	}
});

void test('the site footer and the account foot pass the copy guard', () => {
	for (const words of [...Object.values(FOOT), ...Object.values(ACCOUNT_FOOT)]) {
		assert.equal(bannedIn(words), null, words);
	}
});
