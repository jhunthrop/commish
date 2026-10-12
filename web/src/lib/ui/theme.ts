/** The three-state theme. Auto follows the operating system, Light and Dark pin a theme.
 * The choice lives in this browser only, so the server never guesses. */
export const THEME_MODES = ['auto', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_STORAGE_KEY = 'commish-theme';
export const THEME_LABELS: Record<ThemeMode, string> = {
	auto: 'Auto',
	light: 'Light',
	dark: 'Dark'
};

export function isThemeMode(value: unknown): value is ThemeMode {
	return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/** Auto removes the attribute so the prefers-color-scheme block in tokens.css decides. */
export function applyTheme(root: HTMLElement, mode: ThemeMode): void {
	if (mode === 'auto') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', mode);
}

/** Reaching storage can itself throw (blocked cookies, sandboxed frames), so callers pass a getter
 * and the property access happens inside the try. */
export type StorageGetter = () => Storage;

/** The browser's own storage, read only when called. */
export const browserStorage: StorageGetter = () => localStorage;

export function readSavedTheme(getStorage: StorageGetter): ThemeMode {
	try {
		const saved = getStorage().getItem(THEME_STORAGE_KEY);
		return isThemeMode(saved) ? saved : 'auto';
	} catch {
		return 'auto';
	}
}

/** Storage can be disabled or full. The theme still applies for this visit, so a failed write is not an error. */
export function saveTheme(getStorage: StorageGetter, mode: ThemeMode): boolean {
	try {
		getStorage().setItem(THEME_STORAGE_KEY, mode);
		return true;
	} catch {
		return false;
	}
}

/** Runs in the document head before first paint, so a pinned theme never flashes the other one.
 * Built from the same constants as the switch and injected by hooks.server.ts. */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
	THEME_STORAGE_KEY
)});if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m);}catch(e){}})();`;
