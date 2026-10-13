// THE ORACLE'S DECIDE LAYER, CALLED AS IT RUNS: the TypeScript side of the decide parity cases.
//
//   npx tsx research/parity/ts/decide.ts advise  <bodies.json>     one line per raw request body: the advice or the refusal
//   npx tsx research/parity/ts/decide.ts lineup  <queries.json>    one line per start/sit query
//   npx tsx research/parity/ts/decide.ts normal  <inputs.json>     normalCdf, chanceOfClearing, survival, outlook
//
// `advise` is the service's own path: `JSON.parse`, the zod schema the server validates with, then
// `advise`, so a refusal is the server's 400 or 422 text. Nothing about the closed form is restated here.
import { readFileSync } from "node:fs";
import { advise, RoomStateError } from "@research-ts/advisor/advise";
import { adviseRequestSchema } from "@research-ts/advisor/request";
import { startSit, type StartSitQuery } from "@research-ts/projections/decide/lineup";
import { chanceOfClearing, normalCdf } from "@research-ts/projections/decide/normal";
import { outlookAround, realizedDispersion, standardDeviationOf } from "@research-ts/projections/decide/outlook";
import { survivalProbabilities, type BoardEntry } from "@research-ts/projections/decide/survival";

const emit = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

function adviseOne(text: string): unknown {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { status: 400, error: "the body is not JSON" };
  }
  const validated = adviseRequestSchema.safeParse(body);
  if (!validated.success) {
    return { status: 400, error: validated.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ") };
  }
  try {
    return { status: 200, data: advise(validated.data) };
  } catch (error) {
    if (error instanceof RoomStateError) return { status: 422, error: error.message };
    throw error;
  }
}

interface NormalInputs {
  readonly z: readonly number[];
  readonly clearing: readonly (readonly [number, number, number])[];
  readonly survival: readonly { readonly board: readonly BoardEntry[]; readonly fromPick: number; readonly toPick: number }[];
  readonly spreads: readonly (readonly [number, number, number])[];
  readonly around: readonly (readonly [number, number])[];
  readonly weeks: readonly (readonly number[])[];
}

function normal(inputs: NormalInputs): void {
  emit({ normalCdf: inputs.z.map((z) => normalCdf(z)) });
  emit({ chanceOfClearing: inputs.clearing.map(([mean, sd, target]) => chanceOfClearing(mean, sd, target)) });
  emit({ survival: inputs.survival.map((query) => [...survivalProbabilities(query)]) });
  emit({ standardDeviationOf: inputs.spreads.map(([floor, median, ceiling]) => standardDeviationOf({ floor, median, ceiling })) });
  emit({ outlookAround: inputs.around.map(([median, sd]) => outlookAround(median, sd)) });
  emit({ realizedDispersion: inputs.weeks.map((weeks) => realizedDispersion(weeks)) });
}

function main(): void {
  const [command, path] = process.argv.slice(2);
  if (command === undefined || path === undefined) throw new Error("usage: tsx decide.ts advise|lineup|normal <inputs.json>");
  const inputs = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (command === "advise") for (const text of inputs as readonly string[]) emit(adviseOne(text));
  else if (command === "lineup") for (const query of inputs as readonly StartSitQuery[]) emit(startSit(query));
  else if (command === "normal") normal(inputs as NormalInputs);
  else throw new Error(`no command ${command}`);
}

main();
