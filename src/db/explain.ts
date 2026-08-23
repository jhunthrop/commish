import type { Db } from "./client";

/** The subset of a Postgres `EXPLAIN (FORMAT JSON)` node this repo asserts on. */
export interface PlanNode {
  readonly "Node Type": string;
  readonly "Relation Name"?: string;
  readonly "Index Name"?: string;
  /** The predicate the index itself SEEKS on. Absent when the planner could only scan and filter. */
  readonly "Index Cond"?: string;
  /** The predicate applied to rows the index already returned — the half an index did not serve. */
  readonly Filter?: string;
  /** Present only when a `Filter` clause discarded rows an index/scan condition did not exclude. */
  readonly "Rows Removed by Filter"?: number;
  /** The planner's own cost estimate for this node, in its usual arbitrary units — not
   *  wall-clock time. `planCost` reads the root node's, which is the estimate for the plan
   *  as a whole. */
  readonly "Total Cost": number;
  /** Present only on a `Sort`/`Incremental Sort` node — the expressions it actually sorts by, as
   *  Postgres prints them. The one field that pins WHAT a sort node sorts on, not merely THAT one
   *  exists (`nodeTypes` alone can't tell a seats-remaining sort from a `created_at` one). */
  readonly "Sort Key"?: readonly string[];
  readonly Plans?: readonly PlanNode[];
}

/**
 * Runs a Drizzle query under `EXPLAIN (ANALYZE, FORMAT JSON)` and returns its root plan node.
 *
 * Test-support, like `test-db.ts` beside it: nothing in the running app explains its own
 * queries. It goes through `db.$client.unsafe(text, params)` — postgres-js's own escape hatch
 * for a statement Drizzle did not build — because `EXPLAIN` cannot be expressed as a Drizzle
 * query and because `toSQL()` already hands back the parameterized text and the bound values
 * separately, so nothing is string-interpolated into SQL here.
 *
 * `ANALYZE` genuinely executes the statement. That is deliberate: a plan without actual row
 * counts can be confidently wrong about a table it has stale statistics for, and the whole
 * point of this helper is to catch exactly that.
 */
export async function explainPlan(
  db: Db,
  query: { toSQL(): { sql: string; params: unknown[] } },
): Promise<PlanNode> {
  const { sql: text, params } = query.toSQL();
  const rows = await db.$client.unsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${text}`, params as never[]);
  const first = rows[0] as Record<string, unknown> | undefined;
  const explained = first?.["QUERY PLAN"];
  if (!Array.isArray(explained) || explained.length === 0) {
    throw new Error(`EXPLAIN returned no plan for: ${text}`);
  }
  const root = (explained[0] as { readonly Plan?: PlanNode }).Plan;
  if (root === undefined) throw new Error(`EXPLAIN returned a plan with no root node for: ${text}`);
  return root;
}

/** Every relation this plan reads with a sequential scan, deduplicated, in encounter order. */
export function sequentiallyScannedRelations(plan: PlanNode): readonly string[] {
  const found: string[] = [];
  const walk = (node: PlanNode): void => {
    const relation = node["Relation Name"];
    if (node["Node Type"] === "Seq Scan" && relation !== undefined && !found.includes(relation)) {
      found.push(relation);
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(plan);
  return found;
}

/** Whether `plan` reads `relation` with a sequential scan anywhere in the tree. */
export function planUsesSeqScanOn(plan: PlanNode, relation: string): boolean {
  return sequentiallyScannedRelations(plan).includes(relation);
}

/**
 * The first node anywhere in the plan whose `Index Name` matches, or `undefined` if the plan
 * never touches that index. `not.toContain("chat_messages")` on `sequentiallyScannedRelations`
 * only rules out a full-table scan; it passes just as well on an index scan over the WRONG index
 * (e.g. the primary key, filtering rather than seeking) — this is the assertion that pins WHICH
 * index the planner actually chose.
 */
export function indexScanNode(plan: PlanNode, indexName: string): PlanNode | undefined {
  if (plan["Index Name"] === indexName) return plan;
  for (const child of plan.Plans ?? []) {
    const found = indexScanNode(child, indexName);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The first node anywhere in the plan `predicate` matches, or `undefined` if none does. General
 * where `indexScanNode` is specific: e.g. finding the node that actually touches a relation's heap
 * pages (a Bitmap Heap Scan, which carries `Relation Name` but no `Index Name` of its own — the
 * `Index Name` lives one level down, on its child Bitmap Index Scan) to check what `Filter`, if
 * any, ran on the rows an index scan already narrowed.
 */
export function findNode(plan: PlanNode, predicate: (node: PlanNode) => boolean): PlanNode | undefined {
  if (predicate(plan)) return plan;
  for (const child of plan.Plans ?? []) {
    const found = findNode(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Every `Node Type` in the plan tree, in encounter order, duplicates included.
 *
 * The assertion this exists for is an inverted one: a plan that reaches the right index and
 * still carries a `Sort` or an `Incremental Sort` above it is a plan whose index only serves
 * PART of its ordering — the exact shape `integrity_flags_queue_idx` had before
 * `drizzle/0026_measured_index_shapes.sql` gave it the cursor's second key. `indexScanNode`
 * cannot see that: the right index really is in the tree, doing half the job.
 */
export function nodeTypes(plan: PlanNode): readonly string[] {
  return [plan["Node Type"], ...(plan.Plans ?? []).flatMap(nodeTypes)];
}

/**
 * The planner's own total-cost estimate for the plan as a whole (the root node's `Total Cost`),
 * in arbitrary cost units — never wall-clock time. Used only as a RELATIVE measure: recreating
 * an index without the partial predicate that made it selective does not always change which
 * `Node Type` the planner picks (a small enough per-key row count can still make an index scan
 * plus a `Filter` cheaper than a sequential scan), so `sequentiallyScannedRelations` alone can
 * miss the regression. The cost estimate cannot: scanning the rows the dropped predicate used to
 * exclude, and then filtering them out one by one, is strictly more expensive than never reading
 * them, so a mutation-proof test compares this number against a baseline taken before the index
 * was recreated rather than asserting a specific `Node Type`.
 */
export function planCost(plan: PlanNode): number {
  return plan["Total Cost"];
}
