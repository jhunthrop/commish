/** The words of /app/signed-in (Lane 172), where an app's sign-in comes back with its pairing code.
 * The app takes the link and the page is never seen; when it shows, the app did not open. The apps
 * read the same two lines, so they are a contract: change them here and in the apps together. */

/** The page's one verb, its heading. */
export const OPEN_APP = 'Open Commish';

/** What to do when the app did not take the link. */
export const NO_APP =
	'The app did not open. Install Commish from the App Store or Google Play, then sign in again.';

/** The address the API sends an app's sign-in back to (api/internal/auth/handler.go appSignedIn). */
export const APP_SIGNED_IN_PATH = '/app/signed-in';
