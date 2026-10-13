// V8'S OWN ANSWERS, FOR THE NUMERICS CASE: random inputs to `Math.log`, `Math.exp`, `Math.sin`,
// `**` (general, integer and the 2 and 0.5 exponents V8 special-cases), `Math.round`, and the
// mulberry32 stream the law bootstrap draws from, each printed with V8's result as the hex of its
// IEEE 754 bits. The Python side recomputes every line and must agree on every bit.
//
//   npx tsx research/parity/ts/numerics.ts <count> <seed>
import { mulberry32 } from "@research-ts/projections/laws/harness";

const view = new DataView(new ArrayBuffer(8));
const hex = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
};

function main(): void {
  const count = Number(process.argv[2] ?? "100000");
  const seed = Number(process.argv[3] ?? "20261012");
  const draw = mulberry32(seed);
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = Math.exp((draw() - 0.5) * 40);
    const y = (draw() - 0.5) * 60;
    const z = (draw() - 0.5) * 6.4;
    const base = draw() * 3;
    const exponent = (draw() - 0.5) * 8;
    const integer = Math.floor(draw() * 40);
    const half = (draw() - 0.5) * 2000;
    lines.push(
      ["log", hex(x), hex(Math.log(x))].join(" "),
      ["exp", hex(y), hex(Math.exp(y))].join(" "),
      ["sin", hex(z), hex(Math.sin(z))].join(" "),
      ["pow", hex(base), hex(exponent), hex(base ** exponent)].join(" "),
      ["pow", hex(base), hex(integer), hex(base ** integer)].join(" "),
      ["pow", hex(base), hex(2), hex(base ** 2)].join(" "),
      ["pow", hex(base), hex(0.5), hex(base ** 0.5)].join(" "),
      ["round", hex(half), hex(Math.round(half))].join(" "),
    );
  }
  const stream = mulberry32(seed);
  for (let i = 0; i < count; i += 1) lines.push(["mulberry32", String(seed), String(i), hex(stream())].join(" "));
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
