/** The push switches' words (Lane 198, spec 2026-10-24-native-mobile-apps-design §5.3): one switch per
 * kind (the Thursday read, a starter's status, waivers clearing) and quiet hours, printed by the apps'
 * Account screens. The site sends no push, so no page prints these yet; they live with the account's
 * other words so the web, iOS and Android say the same once it does. While the account does not carry
 * the switches (GET and PATCH /me), each app keeps them on the phone and says so. */
export const PUSH = {
	title: 'Notifications',
	thursday: 'The Thursday read',
	thursdayLine: "When the week's rankings are out",
	status: "A starter's status",
	statusLine: 'When a player in your lineup is ruled out or listed questionable',
	waivers: 'Waivers clearing',
	waiversLine: 'When your platform runs waivers and your claims go through or miss',
	quiet: 'Quiet hours',
	quietLine: "Nothing arrives between these times, on your phone's clock",
	from: 'From',
	to: 'To',
	/** Where the switches are kept until the account carries them. */
	savedHere: 'Saved on this phone',
	notYet: 'Nothing is sent yet. These take effect when notifications start.'
} as const;
