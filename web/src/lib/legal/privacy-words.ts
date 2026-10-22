/** The Privacy Policy as the page prints it (Lane 151, launch audit C1): a draft in the site's plain
 * voice for counsel to review, stating only what the code does. What is kept per platform is the
 * consent the member agreed to, word for word (hosts/connection-words.ts); Yahoo's is its own page,
 * so its sentence is here. The cookies are api/internal/auth's (session.go, handler.go, anon.go), the
 * browser's keeping is ui/theme.ts and sheet/storage.ts. Sub-processors are named by role only. */
import { ESPN_CONSENT, FFPC_CONSENT, MFL_CONSENT } from '#lib/hosts/connection-words.ts';
import { SUPPORT_EMAIL } from './contact.ts';
import { DRAFT_NOTE, LEGAL_CHANGED, type LegalDoc } from './legal-doc.ts';

const support = { text: SUPPORT_EMAIL, to: 'support' } as const;

/** What Yahoo's connection keeps: Yahoo asks for the consent on its own page (consent version 1). */
const YAHOO_KEPT =
	"We keep the access Yahoo gives us once you approve it on Yahoo's own page, and the token that renews it, encrypted, to read your Yahoo leagues. We never see your Yahoo password. Disconnect deletes them at once.";

/** A league followed by its link: Sleeper, a public MyFantasyLeague league, a public ESPN league. */
const LINK_KEPT =
	'A league you follow by its link, a Sleeper league or a public MyFantasyLeague or ESPN league, needs no sign-in. We keep the league and the team you say is yours.';

export const PRIVACY: LegalDoc = {
	title: 'Privacy Policy',
	draftNote: DRAFT_NOTE,
	changed: LEGAL_CHANGED,
	lead: 'What Commish keeps about you, why, and how to have it deleted.',
	sections: [
		{
			head: 'Who we are',
			paragraphs: [
				[
					'Commish is run by Commish LLC, an Arkansas limited liability company. Commish is free for the 2026 season. Write to ',
					support,
					' with any question about your information.'
				]
			]
		},
		{
			head: 'Your account',
			paragraphs: [
				[
					'When you sign in we keep your email, the name your sign-in gives us, the handle you choose, and the day you joined. We keep what you make here: your cheat sheets, your mock drafts and their reports, the leagues you follow, and any browser you pair with your account. For each place you are signed in, we keep which browser it is.'
				]
			]
		},
		{
			head: 'Your platform connections',
			paragraphs: [
				[
					'Each connection is encrypted with a key of its own, and only the part of Commish that reads your league or makes a move you confirm opens it. In the words you agreed to when you connected:'
				],
				[`ESPN. ${ESPN_CONSENT}`],
				[`Yahoo. ${YAHOO_KEPT}`],
				[`FFPC. ${FFPC_CONSENT}`],
				[`MyFantasyLeague. ${MFL_CONSENT}`],
				[LINK_KEPT],
				[
					'We keep a record of each move you confirm and what the platform answered. Disconnect is on your account page. The leagues you followed keep their last read until you remove them.'
				]
			]
		},
		{
			head: 'Cookies and your browser',
			paragraphs: [
				[
					'When you sign in we set one session cookie, with a second that guards your requests against forgery. Both last 30 days or until you sign out. While you sign in, a cookie holds your place for ten minutes. A mock draft you start without signing in is kept yours by a cookie for up to 90 days, and moves to your account when you sign in.'
				],
				[
					'Your theme and a copy of your cheat sheet are kept in your browser, not with us. Signed in, your sheet is kept with your account too.'
				],
				[
					'We run no analytics and no ad scripts. We never give or rent your information to anyone for advertising.'
				]
			]
		},
		{
			head: 'Who handles it for us',
			paragraphs: [
				[
					'A sign-in service checks your email and password. A cloud runs our servers and the database that keeps your account. An edge network serves the site, its pages and the files you export. Each handles your information only to run Commish for us.'
				],
				[
					'Our servers log each request, with the address it came from, to keep the site running and safe.'
				]
			]
		},
		{
			head: 'How long we keep it',
			paragraphs: [
				[
					'Your account and what you make here are kept while your account is open. A mock draft started without an account and never claimed is deleted 90 days after its last change, or after a day if nobody drafted in it. A cheat sheet you export is kept as a file for seven days.'
				]
			]
		},
		{
			head: 'Deleting your account',
			paragraphs: [
				[
					'Write to ',
					support,
					' from the email you sign in with, and we delete your account and everything kept with it, your platform connections first, and write back when it is done. A verb to do it yourself on the account page is coming.'
				]
			]
		},
		{
			head: 'Age',
			paragraphs: [
				[
					'Commish is for people 18 and older. If you think someone younger has an account, write to us and we delete it.'
				]
			]
		},
		{
			head: 'Changes',
			paragraphs: [
				[
					'We may change this policy. The date at the top says when it last changed. For a change that matters, we tell you on the site or by email before it applies. The ',
					{ text: 'Terms of Service', to: 'terms' },
					' cover the rest.'
				]
			]
		},
		{
			head: 'The law',
			paragraphs: [['This policy is governed by the laws of the State of Arkansas.']]
		}
	]
};
