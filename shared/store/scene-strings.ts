/**
 * The store shots name no platform (Lane 310): each store run writes, beside its PNGs, one JSON list per
 * shot of every string the shot's screen draws from (scene-strings/<shot>.json: the Play set's
 * StoreStrings.kt, the App Store set's StoreStrings.swift). This check fails a shot whose strings carry a
 * platform's name, the names read from the platforms' own word table (shared/words/league-platform.json),
 * so a platform added there is checked here with no change.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLATFORM_WORDS = resolve(import.meta.dirname, '../words/league-platform.json');

/** The folder beside the PNGs that holds the scene strings. */
export const SCENE_STRINGS = 'scene-strings';

/** Every platform's name as the site and the apps say it: "Sleeper", "MyFantasyLeague", "ESPN". */
export function platformNames(file: string = PLATFORM_WORDS): string[] {
	const table: unknown = JSON.parse(readFileSync(file, 'utf8'));
	if (typeof table !== 'object' || table === null) throw new Error(`${file}: not a word table`);
	return Object.entries(table)
		.filter(([key, value]) => key !== 'functions' && typeof value === 'string')
		.map(([, value]) => value as string);
}

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The platforms a text names, as whole words: "Add on ESPN" names ESPN, "espn.com" names none. */
export function namedPlatforms(text: string, names: readonly string[] = platformNames()): string[] {
	return names.filter((name) => new RegExp(`(^|[^A-Za-z0-9])${escaped(name)}([^A-Za-z0-9]|$)`).test(text));
}

/** What is wrong with one shot's strings: a missing or unreadable list, or a string naming a platform. */
export function sceneProblemsOf(shot: string, strings: unknown, names: readonly string[] = platformNames()): string[] {
	if (!Array.isArray(strings) || !strings.every((s) => typeof s === 'string')) {
		return [`${SCENE_STRINGS}/${shot}.json: not a list of strings`];
	}
	return strings.flatMap((text: string) =>
		namedPlatforms(text, names).map((name) => `${SCENE_STRINGS}/${shot}.json: "${text}" names ${name}`)
	);
}

/** Every problem across the shots' scene strings in a store folder, a missing list among them. */
export function checkSceneStrings(dir: string, shots: readonly string[]): string[] {
	const names = platformNames();
	return shots.flatMap((shot) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(join(dir, SCENE_STRINGS, `${shot}.json`), 'utf8'));
		} catch {
			return [`${SCENE_STRINGS}/${shot}.json: missing`];
		}
		return sceneProblemsOf(shot, parsed, names);
	});
}
