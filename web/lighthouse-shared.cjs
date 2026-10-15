// What both Lighthouse configs share, so a local run and the deploy's run measure the same thing.

// Chrome switch that turns paint holding off, so a run measures the page and not Chrome's holding.
// With holding on, a page whose document is large (the board's is 1.4 MB) is not committed until
// its parse finishes, and its text then waits on the web fonts: first paint landed at 0.67 s,
// 1.66 s or 2.67 s run to run on a quiet machine, while with the switch off every run landed at
// 0.67 s (Lane 49).
const PAINT_HOLDING_OFF = '--disable-features=PaintHolding';

// The static server's port. `PORT=4601 npm run lighthouse` audits a server on 4601, because the
// server (scripts/serve-built.ts) and both configs read the same variable.
const PORT = Number(process.env.PORT ?? 4173);
const ORIGIN = `http://localhost:${String(PORT)}`;

module.exports = { ORIGIN, PAINT_HOLDING_OFF };
