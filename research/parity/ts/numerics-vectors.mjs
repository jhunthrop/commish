// V8'S ANSWERS ON ANOTHER MACHINE: the numerics case's inputs and V8's results, as IEEE 754 bit
// patterns, written once by a node of a different architecture and committed, so the arithmetic
// arm this machine's node cannot run is still proven against a real V8.
//
//   docker run --rm --platform linux/amd64 -v "$PWD/research/parity:/p" node:22-slim \
//     node /p/ts/numerics-vectors.mjs 20000 20261012 | gzip -9n > research/parity/fixtures/numerics-v8-x64/vectors.txt.gz
//
// The arm64 file is the same command run by the arm64 macOS node. The header names the node, its
// architecture and its platform: the platform says whose libm its `**` is.
//
// Plain JavaScript (no imports) so it runs in a bare node image. The draw stream is mulberry32, the
// same generator `ts/numerics.ts` uses.
function mulberry32(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const view = new DataView(new ArrayBuffer(8));
const hex = (x) => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
};

const count = Number(process.argv[2] ?? "20000");
const seed = Number(process.argv[3] ?? "20261012");
const draw = mulberry32(seed);
const lines = [`# node ${process.version} ${process.arch} ${process.platform}`];
for (let i = 0; i < count; i += 1) {
  const x = Math.exp((draw() - 0.5) * 1400);
  const y = (draw() - 0.5) * 1400;
  const z = (draw() - 0.5) * 2000;
  const base = draw() * 50;
  const exponent = (draw() - 0.5) * 40;
  lines.push(`log ${hex(x)} ${hex(Math.log(x))}`, `exp ${hex(y)} ${hex(Math.exp(y))}`, `sin ${hex(z)} ${hex(Math.sin(z))}`);
  lines.push(`pow ${hex(base)} ${hex(exponent)} ${hex(base ** exponent)}`);
}
process.stdout.write(`${lines.join("\n")}\n`);
