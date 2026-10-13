/**
 * Tags: the fixed set the API names, plus the drafter's own words. The rules match
 * api/internal/sheets/tags.go: a tag is trimmed with its inner spaces closed up, a word that spells
 * a fixed tag in any case is that fixed tag, no tag appears twice in any case, and a row holds at
 * most SHEET_LIMITS.tags.
 */
import type { components } from '#lib/api/types.ts';
import { SHEET_LIMITS } from './limits.ts';

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
	const length = [...tag].length;
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

/** Canonical, valid, each once, at most SHEET_LIMITS.tags, first ones kept. */
export function normalizeTags(raw: readonly string[]): readonly string[] {
	const out: string[] = [];
	for (const candidate of raw) {
		const tag = canonicalTag(candidate);
		if (tagProblem(tag) !== null) continue;
		if (out.some((kept) => sameTag(kept, tag))) continue;
		if (out.length === SHEET_LIMITS.tags) break;
		out.push(tag);
	}
	return out;
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
