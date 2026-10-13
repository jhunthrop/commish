// A FITTED FILE'S NUMBERS, AS JSON: the named exports of one committed fit module, so the fit's
// provenance can tell the commit that changed the numbers from one that only moved or reworded the
// file. `research.model.fit_history` writes a past commit's copy of the file to a temporary
// directory and runs this on it. The fitted modules import only types, which tsx erases, so the
// copy evaluates on its own. A name the module does not export is left out of the output.
//
//   npx tsx research/parity/ts/fitted-values.ts <module.ts> <EXPORT_NAME>...
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  const [file, ...names] = process.argv.slice(2);
  if (file === undefined || names.length === 0) throw new Error("usage: fitted-values.ts <module.ts> <EXPORT_NAME>...");
  const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const values = Object.fromEntries(names.filter((name) => name in module).map((name) => [name, module[name]]));
  process.stdout.write(`${JSON.stringify(values)}\n`);
}

await main();
