import type { Db } from "./client";

/** The subset of a Postgres `EXPLAIN (FORMAT JSON)` node this repo asserts on. */
export interface PlanNode {
  readonly "Node Type": string;
  readonly "Relation Name"?: string;
  readonly "Index Name"?: string;
  /** Present only when a `Filter` clause discarded rows an index/scan condition did not exclude. */
  readonly "Rows Removed by Filter"?: number;
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
