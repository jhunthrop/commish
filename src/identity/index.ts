// Barrel surface for `@/identity`: pure, I/O-free code with no server module behind it (see
// eslint.config.mjs's browser-safe exempt note), so both server code (`identity-service`) and
// client room code may value-import it directly.
export { AVATAR_PRESETS, avatarRefValue, avatarTone, parseAvatarRef, presetByKey } from "./avatars";
export type { AvatarPreset, AvatarPresetKey, AvatarRef, AvatarTone } from "./avatars";
export { EXPERIENCE_TIER_LABEL, HELP_LEVEL_LABEL, IDENTITY_CONFIG, LEAGUE_EXPERIENCE_TIER_HINT, LEAGUE_EXPERIENCE_TIER_LABEL } from "./config";
export { isPrintableDisplayName } from "./display-name";
export { defaultPreferences, isDraftTourDismissed } from "./preferences";
export type { HelpLevel, PreferenceState } from "./preferences";
export { NOTIFICATION_CATALOG, channelStatus, deliverableChannels } from "./notifications";
export type { NotificationChannel, NotificationTopic } from "./notifications";
