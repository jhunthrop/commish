// Barrel surface for `@/identity`: pure, I/O-free code with no server module behind it (see
// eslint.config.mjs's browser-safe exempt note), so both server code (`identity-service`) and
// client room code may value-import it directly.
export { AVATAR_PRESETS, avatarRefValue, parseAvatarRef, presetByKey } from "./avatars";
export type { AvatarPreset, AvatarPresetKey, AvatarRef, AvatarTone } from "./avatars";
export { EXPERIENCE_TIER_LABEL, IDENTITY_CONFIG } from "./config";
export { defaultPreferences, isDraftTourDismissed } from "./preferences";
export type { HelpLevel, PreferenceState } from "./preferences";
export { firstRunPathOrder, firstRunPlan } from "./first-run";
export type { FirstRunPath, FirstRunPathKey, FirstRunPlan } from "./first-run";
export { NOTIFICATION_CATALOG, channelStatus, deliverableChannels } from "./notifications";
export type { NotificationChannel, NotificationTopic } from "./notifications";
