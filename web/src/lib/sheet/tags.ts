/**
 * Tags: the fixed set the API names, plus the drafter's own words. The rules match
 * api/internal/sheets/tags.go: a tag is trimmed with its inner spaces closed up, a word that spells
 * a fixed tag in any case is that fixed tag, no tag appears twice in any case, and a row holds at
 * most SHEET_LIMITS.tags.
 */
import type { components } from '#lib/api/types.ts';
import type { TagMark, TagTone } from '#lib/ui/tag.ts';
import { SHEET_LIMITS, characterCount } from './limits.ts';

export type FixedTag = components['schemas']['SheetTag'];

/** The fixed tags in the order the sheet offers them, each with the word a chip prints. */
export const FIXED_TAGS: readonly { tag: FixedTag; label: string }[] = [
	{ tag: 'target', label: 'Target' },
	{ tag: 'sleeper', label: 'Sleeper' },
	{ tag: 'breakout', label: 'Breakout' },
	{ tag: 'avoid', label: 'Avoid' },
	{ tag: 'injury', label: 'Injury' },
	{ tag: 'handcuff', label: 'Handcuff' }
];

/** Tags that contradict each other: a row holds one of a pair, the one chosen last. */
const OPPOSITES: Readonly<Partial<Record<FixedTag, FixedTag>>> = {
	target: 'avoid',
	avoid: 'target'
};

/** How a tag is drawn: yours in your color, or the loss tone for a player you are steering
 * away from, so Avoid never reads as a pick. */
export function tagTone(tag: string): TagTone {
	return canonicalTag(tag) === 'avoid' ? 'loss' : 'you';
}

/** The tags as a row prints them. */
export function tagMarks(tags: readonly string[]): readonly TagMark[] {
	return tags.map((tag) => ({ label: tagLabel(tag), tone: tagTone(tag) }));
}

/** Letters, digits, spaces, apostrophes, periods and hyphens, starting with a letter or digit.
 * Commas, bars and semicolons separate tags in a CSV cell, so they are never part of one. */
const OWN_TAG = /^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u;
const TAG_SEPARATORS = /[,|;]/;

export function isFixedTag(tag: string): tag is FixedTag {
	return FIXED_TAGS.some((fixed) => fixed.tag === tag);
}

/** The tag in its stored spelling. */
export function canonicalTag(raw: string): string {
	const tag = raw.trim().split(/\s+/).join(' ');
	const fixed = FIXED_TAGS.find((entry) => entry.tag === tag.toLowerCase());
	return fixed ? fixed.tag : tag;
}

/** Why a tag cannot be used, or null when it can. */
export function tagProblem(tag: string): string | null {
	const length = characterCount(tag);
	if (length < 1 || length > SHEET_LIMITS.tagLength || !OWN_TAG.test(tag)) {
		return `A tag is 1 to ${SHEET_LIMITS.tagLength} letters or numbers`;
	}
	return null;
}

function tagKey(tag: string): string {
	return tag.toLowerCase();
}

export function sameTag(a: string, b: string): boolean {
	return tagKey(a) === tagKey(b);
}

function oppositeOf(tag: string): FixedTag | undefined {
	return isFixedTag(tag) ? OPPOSITES[tag] : undefined;
}

/** Canonical, valid, each once, never with its opposite, at most SHEET_LIMITS.tags, first ones
 * kept. */
export function normalizeTags(raw: readonly string[]): readonly string[] {
	const out: string[] = [];
	for (const candidate of raw) {
		const tag = canonicalTag(candidate);
		if (tagProblem(tag) !== null) continue;
		if (out.some((kept) => sameTag(kept, tag) || kept === oppositeOf(tag))) continue;
		if (out.length === SHEET_LIMITS.tags) break;
		out.push(tag);
	}
	return out;
}

export function hasTag(tags: readonly string[], tag: string): boolean {
	return tags.some((kept) => sameTag(kept, tag));
}

/** What a tap on a tag does to a row's tags: off when it is on, otherwise on in place of its
 * opposite. Null when the row is full and the tag cannot go on. */
export function toggledTags(tags: readonly string[], raw: string): readonly string[] | null {
	const tag = canonicalTag(raw);
	if (hasTag(tags, tag)) return tags.filter((kept) => !sameTag(kept, tag));
	const opposite = oppositeOf(tag);
	const rest = tags.filter((kept) => kept !== opposite);
	if (rest.length >= SHEET_LIMITS.tags) return null;
	return normalizeTags([...rest, tag]);
}

/** The word a chip prints for a tag. */
export function tagLabel(tag: string): string {
	return FIXED_TAGS.find((fixed) => fixed.tag === tag)?.label ?? tag;
}

/** A CSV tags cell read into tags, the way the API reads it. */
export function splitTagCell(cell: string): readonly string[] {
	return cell
		.split(TAG_SEPARATORS)
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

/** Tags written into one CSV cell, the way a person types them. */
export function joinTagCell(tags: readonly string[]): string {
	return tags.join(', ');
}

/** Every tag a sheet uses that is not a fixed one, in first-seen order: the drafter's own set. */
export function ownTags(tagLists: Iterable<readonly string[]>): readonly string[] {
	const out: string[] = [];
	for (const tags of tagLists) {
		for (const tag of tags) {
			if (!isFixedTag(tag) && !out.some((kept) => sameTag(kept, tag))) out.push(tag);
		}
	}
	return out;
}
