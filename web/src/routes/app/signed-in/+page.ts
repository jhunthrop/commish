/** One HTML for every visit, built before any sign-in, with no script: nothing on it can read or
 * print the pairing code the API sends with the app's sign-in. */
export const prerender = true;
export const csr = false;
