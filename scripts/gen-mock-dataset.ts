import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDataset, DATASET_SEED } from "../src/stats/mock/generate-dataset";

const out = resolve(process.cwd(), "src/stats/mock/dataset.json");
writeFileSync(out, JSON.stringify(generateDataset(DATASET_SEED), null, 2) + "\n", "utf8");
console.log(`wrote ${out}`);
