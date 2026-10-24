/** A preload (`node --import`) that stops the process's clock at FROZEN_CLOCK: `Date.now()` and a
 * `new Date()` with no argument both read that instant for as long as the process runs. The fixture
 * export (export-fixtures.ts) starts the fixture API under it, so every read stamp the API makes is
 * the same on every export and the drift check compares like with like. */
const FROZEN_CLOCK_VARIABLE = 'FROZEN_CLOCK';

const at = Date.parse(process.env[FROZEN_CLOCK_VARIABLE] ?? '');
if (Number.isNaN(at)) throw new Error(`${FROZEN_CLOCK_VARIABLE} is not an instant.`);

const RealDate = Date;

class FrozenDate extends RealDate {
	constructor(...args: ConstructorParameters<DateConstructor> | []) {
		if (args.length === 0) super(at);
		else super(...(args as ConstructorParameters<DateConstructor>));
	}

	static override now(): number {
		return at;
	}
}

globalThis.Date = FrozenDate as DateConstructor;
