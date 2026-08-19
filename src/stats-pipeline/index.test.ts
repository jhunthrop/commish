import { describe, expect, it, vi } from "vitest";

// getIngestionWorker() opens a real Postgres pool and a real Redis connection the moment it's
// called (its globalThis singleton, `./index.ts`) — point both at the test infrastructure
// before the module under test is imported. vi.hoisted runs before the import graph, the same
// idiom the route tests use to point the process-wide getDb()/getPublisher() at the test stack
// (see e.g. `src/app/api/leagues/[leagueId]/events/route.test.ts`).
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

import { DB_POOL_CONFIG } from "@/db/config";
import { getIngestionWorker, ingestionPoolOptions } from "./index";

describe("stats-pipeline edge wiring", () => {
  it("draws its connections from the background job budget, never from the request path's", () => {
    // Plan A subtracted backgroundJobPoolSize from the connection budget BEFORE dividing by
    // instance count, specifically so a batch job could never borrow from the request path's
    // budget on the busiest day of the week. That arithmetic is only true if the worker actually
    // uses it, and this is the only place it can be made false.
    expect(ingestionPoolOptions()).toEqual({ max: DB_POOL_CONFIG.backgroundJobPoolSize });
  });

  it("is a singleton, so two calls never mint two pools", () => {
    expect(getIngestionWorker()).toBe(getIngestionWorker());
  });
});
