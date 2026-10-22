/** The Terms of Service as the page prints them (Lane 151, launch audit C1): a draft in the site's
 * plain voice for counsel to review, stating only what the code does. What the draft could not say
 * for certain is a question in the lane's report, never a guess here. */
import { CREDIT } from '#lib/site/credit.ts';
import { SUPPORT_EMAIL } from './contact.ts';
import { DRAFT_NOTE, LEGAL_CHANGED, type LegalDoc } from './legal-doc.ts';

const support = { text: SUPPORT_EMAIL, to: 'support' } as const;

export const TERMS: LegalDoc = {
	title: 'Terms of Service',
	draftNote: DRAFT_NOTE,
	changed: LEGAL_CHANGED,
	lead: 'The rules for using Commish, in plain words.',
	sections: [
		{
			head: 'Who we are',
			paragraphs: [
				[
					'Commish is run by Commish LLC, an Arkansas limited liability company. In these terms "we" and "us" are Commish LLC, and "you" are the person using the site at trycommish.app. Using the site means you agree to these terms.'
				]
			]
		},
		{
			head: 'What Commish is',
			paragraphs: [
				[
					'Commish is draft prep and in-season research for fantasy football: our rankings and projections, a page for every player, mock drafts, a cheat sheet, and the weekly tools for the leagues you follow. Our rankings, projections and reads are our own estimates, worked out to help you decide. The other figures are named for what they are: the published projection for the week, ADP, and the stats the season records. None of it is a promise of how a player or a team will do.'
				]
			]
		},
		{
			head: 'Free this season',
			paragraphs: [
				[
					'Commish is free for the 2026 season. We may offer paid plans later. If we do, we will say what each one costs and what it includes before you pay anything, and nothing you use free today starts charging you without your say.'
				]
			]
		},
		{
			head: 'Your account',
			paragraphs: [
				[
					'You must be 18 or older to make an account. Keep your sign-in to yourself. You are responsible for what is done with your account, so tell us at once if you think someone else is using it.'
				]
			]
		},
		{
			head: 'Your leagues on other platforms',
			paragraphs: [
				[
					'When you connect ESPN, Yahoo, MyFantasyLeague or FFPC, or follow a Sleeper league, you ask us to read your league there for you, and, on a platform where Commish makes moves, to make each move you confirm on our screen. Connect only an account you are allowed to use. Each platform has its own terms, and you agree to keep to them. We are not part of any platform and none of them endorses us. A platform can change or stop what we read at any time, so a league may stop updating.'
				]
			]
		},
		{
			head: 'Fair use',
			paragraphs: [
				[
					'Use Commish for your own leagues and your own prep. Do not copy its pages or figures in bulk, scrape them, charge others for them, get around a limit we set, try to reach an account or data that is not yours, or use the site to break the law or the rules of another site.'
				]
			]
		},
		{
			head: 'Our figures and the data behind them',
			paragraphs: [
				[
					'The site and our rankings, our projections and our written reads are ours. You may share a link or quote a figure with credit to Commish.'
				],
				[CREDIT.before, { text: CREDIT.licenceWords, to: 'licence' }, CREDIT.after]
			]
		},
		{
			head: 'No guarantee',
			paragraphs: [
				[
					'We work to keep Commish accurate and running, but we give it as it is. We do not promise that a figure is right, that a league is up to date, that a move reaches a platform, or that the site is always up. As far as the law allows, Commish LLC is not liable for a loss that comes from using the site, a lost matchup or a move made or not made included.'
				]
			]
		},
		{
			head: 'Ending',
			paragraphs: [
				[
					'You can stop using Commish at any time and ask us to delete your account, as the ',
					{ text: 'Privacy Policy', to: 'privacy' },
					' says. We may pause or close an account that breaks these terms.'
				]
			]
		},
		{
			head: 'Changes',
			paragraphs: [
				[
					'We may change these terms. The date at the top says when they last changed. For a change that matters, we tell you on the site or by email before it applies.'
				]
			]
		},
		{
			head: 'The law',
			paragraphs: [['These terms are governed by the laws of the State of Arkansas.']]
		},
		{
			head: 'Questions',
			paragraphs: [['Write to ', support, '.']]
		}
	]
};
