/** The push switches' words (Lane 198, live from Lane 288; spec 2026-10-24-native-mobile-apps-design
 * §5.3): one switch per kind (the Thursday read, a starter's status, waivers clearing) and quiet hours,
 * printed by the apps' Account screens. The account carries the switches (GET and PATCH /me
 * `notifications`), so every phone the member signs in on follows them. The site sends no push, so no
 * page prints these; they live with the account's other words so the web, iOS and Android say the same. */
export const PUSH = {
	title: 'Notifications',
	thursday: 'The Thursday read',
	thursdayLine: "When the week's rankings are out",
	status: "A starter's status",
	statusLine: 'When a player in your lineup is ruled out, doubtful or cleared to play',
	waivers: 'Waivers clearing',
	waiversLine: 'When your platform runs waivers and your claims go through or miss',
	quiet: 'Quiet hours',
	quietLine: "Nothing arrives between these times, on your phone's clock",
	from: 'From',
	to: 'To',
	/** Where the switches are kept. */
	kept: 'Kept with your account, for every phone you sign in on.',
	/** Before the phone has been asked: what turning a switch on does. */
	ask: 'Turn one on and your phone asks to let Commish send notifications.',
	/** The phone said no: where to change it. */
	blocked: "Notifications for Commish are off in your phone's settings. Turn them on there first.",
	/** The Android notification channel every push arrives on, and its line in the phone's settings. */
	channel: 'Your leagues',
	channelLine: "Your starters' status, the Thursday read and waivers clearing"
} as const;
