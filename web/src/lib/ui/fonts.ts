/** Google Fonts, the only font source. Outfit is the UI face, Big Shoulders Display the number face. */
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2';
const UI_FAMILIES =
	'family=Big+Shoulders+Display:wght@500;700;800&family=Outfit:wght@400;500;600;700';
/** Newsreader sets capsule prose and its pull figures. Only a page that sets prose loads it. */
const READ_FAMILY = 'family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400';

export const FONT_CSS_ORIGIN = 'https://fonts.googleapis.com';
export const FONT_FILE_ORIGIN = 'https://fonts.gstatic.com';
export const UI_FONTS_HREF = `${GOOGLE_FONTS_CSS}?${UI_FAMILIES}&display=swap`;
export const READ_FONT_HREF = `${GOOGLE_FONTS_CSS}?${READ_FAMILY}&display=swap`;
