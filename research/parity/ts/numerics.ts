// V8'S OWN ANSWERS, FOR THE NUMERICS CASE: random inputs to `Math.log`, `Math.exp`, `Math.sin`,
// `**` (general, integer and the 2 and 0.5 exponents V8 special-cases), `Math.round`, and the
// mulberry32 stream the law bootstrap draws from, each printed with V8's result as the hex of its
// IEEE 754 bits. The Python side recomputes every line and must agree on every bit. The header
// names the node, its architecture and its platform (whose libm its `**` is).
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
  const lines: string[] = [`# node ${process.version} ${process.arch} ${process.platform}`];
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
  // Signed zeros through Math.max and Math.min.
  const zeros = [0, -0, 0.5, -0.5];
  for (let i = 0; i < count / 10; i += 1) {
    const a = zeros[Math.floor(draw() * 4)]!;
    const b = zeros[Math.floor(draw() * 4)]!;
    lines.push(["max", hex(a), hex(b), hex(Math.max(a, b))].join(" "), ["min", hex(a), hex(b), hex(Math.min(a, b))].join(" "));
  }
  // The register's ordinal-rank comparator, `(b.value - a.value) || a.key.localeCompare(b.key)`:
  // pair by pair with NaN values (which fall through `||` to the key), and whole sorts without
  // them (where the comparator is a total order, so the sorted order is the algorithm's to keep).
  type Entry = { readonly key: string; readonly value: number };
  const compare = (x: Entry, y: Entry): number => y.value - x.value || x.key.localeCompare(y.key);
  const entry = (index: number, nan: boolean): Entry => ({
    key: `p${String(Math.floor(draw() * 1000)).padStart(3, "0")}${index}`,
    value: nan && draw() < 0.25 ? Number.NaN : Math.floor(draw() * 5),
  });
  for (let i = 0; i < count / 10; i += 1) {
    const x = entry(0, true);
    const y = entry(1, true);
    lines.push(["ordcmp", `${x.key}=${hex(x.value)}`, `${y.key}=${hex(y.value)}`, String(Math.sign(compare(x, y)))].join(" "));
  }
  for (let i = 0; i < count / 1000; i += 1) {
    const entries = Array.from({ length: 12 }, (_, index) => entry(index, false));
    const order = [...entries].sort(compare).map((item) => item.key);
    lines.push(["ordinal", entries.map((item) => `${item.key}=${hex(item.value)}`).join(","), order.join(",")].join(" "));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
