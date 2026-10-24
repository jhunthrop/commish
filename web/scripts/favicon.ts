// Writes the favicon (src/lib/assets/favicon.svg) from the mark (src/lib/ui/mark.ts): the whistle at
// its small weight, light colours with the dark ones in a media block. mark.test.ts holds the
// committed file equal to this output, so the file never drifts from the module.
// Usage: node scripts/favicon.ts   (rerun when the mark changes, and commit the SVG)
import { writeFile } from 'node:fs/promises';
import { faviconSvg } from '../src/lib/ui/mark.ts';

const file = new URL('../src/lib/assets/favicon.svg', import.meta.url);
await writeFile(file, faviconSvg());
process.stdout.write(`${file.pathname}\n`);
