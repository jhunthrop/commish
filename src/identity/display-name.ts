/**
 * The code point ranges a display name may never contain. Every one of them is INVISIBLE or
 * reorders what is around it, which is the whole problem: a display name renders as
 * `authorName` on the unauthenticated `/reviews` page, so a name is a trust surface even though
 * React escapes it and there is no XSS anywhere here.
 *
 *  - U+0000-001F, U+007F-009F — the C0/C1 controls, including newline and NUL.
 *  - U+200B-200F — zero-width space, non-joiner, joiner, and the LTR/RTL marks.
 *  - U+202A-202E, U+2066-2069 — the bidi embedding, override and isolate set, which can make a
 *    name render as something other than the characters it is made of.
 *  - U+2060-2064, U+FEFF — word joiner and friends, invisible by definition.
 *
 * Written as a `RegExp` built from an escaped string rather than a literal, so the source file
 * itself contains no invisible characters — a rule about unreadable text should not be written
 * in unreadable text.
 *
 * Deliberately NOT an allowlist of scripts: this product's managers can be named in any
 * language, and an allowlist would be a bug report from the first person whose real name it
 * refused. This bans what cannot be SEEN, not what cannot be read.
 *
 * It is also not an impersonation defense on its own: nothing stops a signed-in account from
 * being called "Commish Support" in plain visible letters. That is a policy question this plan
 * did not receive an answer to, and the hidden-character half is the part that is unambiguously
 * a defect, so it is the part that gets fixed.
 */
const HIDDEN_CHARACTER_CLASS = "[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]";
const HIDDEN_CHARACTERS = new RegExp(HIDDEN_CHARACTER_CLASS);

/** Whether a display name is made only of characters a reader can actually see. */
export function isPrintableDisplayName(value: string): boolean {
  return !HIDDEN_CHARACTERS.test(value);
}

/**
 * The same rule as a filter rather than a verdict, for the two places refusing the input is not
 * an option.
 *
 * A BOUNDARY should refuse — `isPrintableDisplayName` above, wired to every schema where a person
 * types a name — because refusing is honest and the person can fix it. Two places cannot refuse:
 *
 *  - a name that arrives from the identity provider at sign-up, where the alternative to
 *    accepting it is refusing somebody a sign-in over a character they may not know is there;
 *  - the composition of a notice, which interpolates names read back OUT of Postgres. Rows
 *    written before the boundary guards existed are still there, and ruling 12 freezes the
 *    rendered copy forever, so a bidi override that reaches `member_notices.body` reverses the
 *    platform's own sentence in somebody's inbox for the life of the row. There is no later fix:
 *    repairing stored copy is exactly what ruling 12 forbids.
 *
 * Stripping, not replacing: every character in the class is invisible or a reordering directive,
 * so removing one changes nothing a reader could see, which makes this the rare sanitizer that
 * cannot corrupt what it cleans.
 */
export function stripHiddenCharacters(value: string): string {
  return value.replace(new RegExp(HIDDEN_CHARACTER_CLASS, "gu"), "");
}
