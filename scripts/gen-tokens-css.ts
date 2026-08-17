import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTokensCss } from "../src/design/generate-css";

const out = resolve(process.cwd(), "src/design/tokens.css");
writeFileSync(out, renderTokensCss(), "utf8");
console.log(`wrote ${out}`);
