/** The mark's generator: the whistle as the web draws it (web/src/lib/ui/mark.ts, its one home) into
 * the iOS app's drawing commands, so the app's Mark is the web's to the point. The SVG path's arc is
 * turned into cubic curves here, once, so the app draws moves, lines and curves only.
 *
 *   node shared/scripts/gen-mark.ts */
import { generatedBy, writeOutputs, type Outputs } from './generated.ts';
import {
	MARK_BOX,
	MARK_DISC,
	MARK_PATH,
	MARK_SMALL_MAX,
	MARK_SMALL_STROKE,
	MARK_STROKE
} from '../../web/src/lib/ui/mark.ts';

const SCRIPT = 'shared/scripts/gen-mark.ts';
export const OUTPUT = {
	swift: 'apps/ios/Packages/CommishDesign/Sources/CommishDesign/Mark.generated.swift'
} as const;

export type Segment =
	| { kind: 'move'; x: number; y: number }
	| { kind: 'line'; x: number; y: number }
	| { kind: 'curve'; x: number; y: number; c1x: number; c1y: number; c2x: number; c2y: number }
	| { kind: 'close' };

export interface MarkSource {
	path: string;
	box: number;
	disc: { cx: number; cy: number; r: number };
	stroke: number;
	smallStroke: number;
	smallMax: number;
}

/** The argument count each command letter takes. */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, A: 7, Z: 0 };

/** An absolute SVG path of M, L, A and Z as segments, every arc as cubic curves. */
export function parsePath(path: string): Segment[] {
	const tokens = path.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
	const segments: Segment[] = [];
	let at = { x: 0, y: 0 };
	let start = at;
	let i = 0;
	while (i < tokens.length) {
		const letter = tokens[i] ?? '';
		const arity = ARITY[letter];
		if (arity === undefined) throw new Error(`The mark's path holds a command it cannot draw: ${letter}`);
		const args = tokens.slice(i + 1, i + 1 + arity).map(Number);
		i += 1 + arity;
		if (letter === 'Z') {
			segments.push({ kind: 'close' });
			at = start;
			continue;
		}
		const end = { x: args[arity - 2] ?? 0, y: args[arity - 1] ?? 0 };
		if (letter === 'M') {
			segments.push({ kind: 'move', ...end });
			start = end;
		} else if (letter === 'L') segments.push({ kind: 'line', ...end });
		else segments.push(...arcCurves(at, args, end));
		at = end;
	}
	return segments;
}

interface Point {
	x: number;
	y: number;
}

/** SVG's arc (rx, ry, rotation, large-arc, sweep) from `from` to `to` as cubic curves, each a
 * quarter turn or less (the SVG spec's appendix B.2.4, endpoint to centre). Rotation is held at 0:
 * the mark's arc is a circle's. */
function arcCurves(from: Point, args: readonly number[], to: Point): Segment[] {
	const [rxIn = 0, ryIn = 0, , largeArc = 0, sweep = 0] = args;
	const dx = (from.x - to.x) / 2;
	const dy = (from.y - to.y) / 2;
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	const grow = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
	if (grow > 1) {
		rx *= Math.sqrt(grow);
		ry *= Math.sqrt(grow);
	}
	const sign = largeArc === sweep ? -1 : 1;
	const numerator = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
	const factor = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * dy * dy + ry * ry * dx * dx)));
	const centre = {
		x: factor * ((rx * dy) / ry) + (from.x + to.x) / 2,
		y: factor * (-(ry * dx) / rx) + (from.y + to.y) / 2
	};
	const angle = (p: Point): number => Math.atan2((p.y - centre.y) / ry, (p.x - centre.x) / rx);
	const start = angle(from);
	let sweepAngle = angle(to) - start;
	if (sweep === 1 && sweepAngle < 0) sweepAngle += 2 * Math.PI;
	if (sweep === 0 && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
	const pieces = Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9);
	const step = sweepAngle / pieces;
	const k = (4 / 3) * Math.tan(step / 4);
	const point = (t: number): Point => ({ x: centre.x + rx * Math.cos(t), y: centre.y + ry * Math.sin(t) });
	const segments: Segment[] = [];
	for (let n = 0; n < pieces; n++) {
		const a = start + n * step;
		const b = a + step;
		const p0 = point(a);
		const p3 = n === pieces - 1 ? to : point(b);
		segments.push({
			kind: 'curve',
			c1x: p0.x - k * rx * Math.sin(a),
			c1y: p0.y + k * ry * Math.cos(a),
			c2x: p3.x + k * rx * Math.sin(b),
			c2y: p3.y - k * ry * Math.cos(b),
			x: p3.x,
			y: p3.y
		});
	}
	return segments;
}

/** A coordinate as Swift reads it, rounded to a thousandth so the file is stable. */
function num(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

function swiftSegment(segment: Segment): string {
	switch (segment.kind) {
		case 'move':
			return `.move(x: ${num(segment.x)}, y: ${num(segment.y)})`;
		case 'line':
			return `.line(x: ${num(segment.x)}, y: ${num(segment.y)})`;
		case 'curve':
			return `.curve(x: ${num(segment.x)}, y: ${num(segment.y)}, c1x: ${num(segment.c1x)}, c1y: ${num(segment.c1y)}, c2x: ${num(segment.c2x)}, c2y: ${num(segment.c2y)})`;
		case 'close':
			return '.close';
	}
}

/** The mark as a Swift enum of plain numbers: no SwiftUI, so `swift test` reads it on macOS. */
export function renderMarkSwift(source: MarkSource): string {
	const { cx, cy, r } = source.disc;
	const segments = parsePath(source.path).map((s) => `        ${swiftSegment(s)},`);
	return `// ${generatedBy(SCRIPT, 'web/src/lib/ui/mark.ts')}
// swiftlint:disable all

/// One step of the mark's outline, in the trace's units (a box \`MarkTrace.box\` wide, y down).
public enum MarkSegment: Sendable, Equatable {
    case move(x: Double, y: Double)
    case line(x: Double, y: Double)
    case curve(x: Double, y: Double, c1x: Double, c1y: Double, c2x: Double, c2y: Double)
    case close
}

/// The pea, the mark's one accent, on the chamber's centre.
public struct MarkDisc: Sendable, Equatable {
    public let cx: Double
    public let cy: Double
    public let r: Double
}

/// The whistle as the web draws it: the outline, the pea and the two weights.
public enum MarkTrace {
    public static let box: Double = ${num(source.box)}
    public static let disc = MarkDisc(cx: ${num(cx)}, cy: ${num(cy)}, r: ${num(r)})
    /// The outline's weight where the mark is drawn large.
    public static let stroke: Double = ${num(source.stroke)}
    /// The outline's weight at \`smallMax\` points and under.
    public static let smallStroke: Double = ${num(source.smallStroke)}
    public static let smallMax: Double = ${num(source.smallMax)}
    public static let outline: [MarkSegment] = [
${segments.join('\n')}
    ]
}
`;
}

export function generate(): Promise<Outputs> {
	const swift = renderMarkSwift({
		path: MARK_PATH,
		box: MARK_BOX,
		disc: MARK_DISC,
		stroke: MARK_STROKE,
		smallStroke: MARK_SMALL_STROKE,
		smallMax: MARK_SMALL_MAX
	});
	return Promise.resolve(new Map([[OUTPUT.swift, swift]]));
}

if (import.meta.main) await writeOutputs(await generate());
