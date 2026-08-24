import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, expectRejectionMatching, truncateAll, truncateMoneyTables } from "@/db/test-db";

const db = createTestDb();

/**
 * The money schema's invariants, proven AT THE DATABASE with raw SQL — the same discipline
 * `src/db/audit-append-only.test.ts` established for the audit chain (migration 0019/0021's
 * precedent): the service layer promising immutability is one bug away from breaking it, and a
 * trigger is not. Everything here must hold against a raw client that never loads a line of
 * application code.
 *
 * The ledger's book-of-record claim (founder decision 1) rests on exactly these properties:
 * `money_entries` and `money_transactions` are append-only by trigger, every entry is a positive
 * whole-cent amount stamped with `state_of_entry` and `tax_year` (founder decision 6 — Phase 5's
 * tax stack assumes NO row is missing them), and no player-facing liability rollup can go
 * negative — the ACH-return shortfall goes to `platform_receivable` instead (plan ruling 5).
 */

/** Two rollup rows, one transaction, and one balanced pair of entries: a $5.00 deposit landing
 *  in the pool (asset debit) and credited to a member's available balance (liability credit). */
async function seedOnePosting(): Promise<void> {
  await db.execute(sql`
    INSERT INTO money_accounts (id, kind, owner_id, balance_cents)
    VALUES ('user_available:u1', 'user_available', 'u1', 500),
           ('fbo_pool', 'fbo_pool', NULL, 500)
  `);
  await db.execute(sql`
    INSERT INTO money_transactions (id, kind, league_id, provider_transfer_ref, idempotency_key)
    VALUES ('mtx_1', 'deposit', NULL, 'transfer_abc', 'idem_1')
  `);
  await db.execute(sql`
    INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year)
    VALUES ('men_1', 'mtx_1', 'fbo_pool', 'debit', 500, 'NJ', 2026),
           ('men_2', 'mtx_1', 'user_available:u1', 'credit', 500, 'NJ', 2026)
  `);
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  await seedOnePosting();
});

describe("money_entries is append-only at the database, not just in code", () => {
  it("refuses an UPDATE issued as raw SQL, outside any application code", async () => {
    await expectRejectionMatching(db.execute(sql`UPDATE money_entries SET amount_cents = 1`), /append.only/i);
    const [row] = await db.execute<{ amount_cents: string }>(sql`SELECT amount_cents FROM money_entries WHERE id = 'men_1'`);
    expect(row?.amount_cents).toBe("500");
  });

  it("refuses a DELETE issued as raw SQL", async () => {
    await expectRejectionMatching(db.execute(sql`DELETE FROM money_entries`), /append.only/i);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM money_entries`);
    expect(row?.count).toBe("2");
  });

  it("refuses an UPDATE that changes nothing, because a no-op edit is still an edit", async () => {
    await expectRejectionMatching(db.execute(sql`UPDATE money_entries SET amount_cents = amount_cents`), /append.only/i);
  });

  it("still allows the append itself", async () => {
    await db.execute(sql`
      INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year)
      VALUES ('men_3', 'mtx_1', 'fbo_pool', 'credit', 500, 'NJ', 2026),
             ('men_4', 'mtx_1', 'user_available:u1', 'debit', 500, 'NJ', 2026)
    `);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM money_entries`);
    expect(row?.count).toBe("4");
  });
});

describe("money_transactions is append-only at the database", () => {
  it("refuses an UPDATE issued as raw SQL", async () => {
    await expectRejectionMatching(db.execute(sql`UPDATE money_transactions SET kind = 'settlement'`), /append.only/i);
  });

  it("refuses a DELETE issued as raw SQL", async () => {
    // The entries' FK alone would also block this DELETE, but only incidentally (a transaction
    // whose entries were somehow gone would become deletable) — the trigger is the stated rule.
    await expectRejectionMatching(db.execute(sql`DELETE FROM money_transactions`), /append.only/i);
  });

  it("refuses a second transaction reusing an idempotency key, which is what makes a retry safe", async () => {
    await expectRejectionMatching(
      db.execute(sql`INSERT INTO money_transactions (id, kind, idempotency_key) VALUES ('mtx_2', 'deposit', 'idem_1')`),
      /idempotency/i,
    );
  });

  it("allows many transactions with NO idempotency key, because internal postings do not carry one", async () => {
    await db.execute(sql`INSERT INTO money_transactions (id, kind) VALUES ('mtx_2', 'entry_fee'), ('mtx_3', 'entry_fee')`);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM money_transactions`);
    expect(row?.count).toBe("3");
  });
});

describe("money_accounts is the mutable rollup, bounded by its balance floor", () => {
  it("lets the rollup row be updated, because a rollup is not the record", async () => {
    await db.execute(sql`UPDATE money_accounts SET balance_cents = 700 WHERE id = 'user_available:u1'`);
    const [row] = await db.execute<{ balance_cents: string }>(sql`SELECT balance_cents FROM money_accounts WHERE id = 'user_available:u1'`);
    expect(row?.balance_cents).toBe("700");
  });

  it("refuses a negative balance on any liability rollup at the database", async () => {
    await expectRejectionMatching(
      db.execute(sql`UPDATE money_accounts SET balance_cents = -1 WHERE kind = 'user_available'`),
      /check/i,
    );
  });

  it("permits the asset and clearing accounts to swing negative, where the shortfall math lives", async () => {
    // Ruling 5's failure model: an ACH return can pull the pool below what the ledger already
    // paid out, and the shortfall is posted to `platform_receivable` — so all three non-player
    // kinds must be free to go negative while every player-facing liability keeps its floor.
    await db.execute(sql`
      INSERT INTO money_accounts (id, kind, owner_id, balance_cents)
      VALUES ('provider_clearing', 'provider_clearing', NULL, -100),
             ('platform_receivable:u1', 'platform_receivable', 'u1', -100)
    `);
    await db.execute(sql`UPDATE money_accounts SET balance_cents = -500 WHERE id = 'fbo_pool'`);
    const [row] = await db.execute<{ balance_cents: string }>(sql`SELECT balance_cents FROM money_accounts WHERE id = 'fbo_pool'`);
    expect(row?.balance_cents).toBe("-500");
  });
});

describe("every entry row satisfies Phase 5's assumptions the day it is written", () => {
  it("refuses a zero or negative amount, because a signed amount would encode direction twice", async () => {
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year)
        VALUES ('men_zero', 'mtx_1', 'fbo_pool', 'debit', 0, 'NJ', 2026)
      `),
      /check/i,
    );
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year)
        VALUES ('men_neg', 'mtx_1', 'fbo_pool', 'debit', -500, 'NJ', 2026)
      `),
      /check/i,
    );
  });

  it("refuses an entry missing state_of_entry or tax_year — founder decision 6, NOT NULL on every row", async () => {
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, tax_year)
        VALUES ('men_nostate', 'mtx_1', 'fbo_pool', 'debit', 500, 2026)
      `),
      /state_of_entry/,
    );
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry)
        VALUES ('men_noyear', 'mtx_1', 'fbo_pool', 'debit', 500, 'NJ')
      `),
      /tax_year/,
    );
  });

  it("refuses an entry naming a transaction or account that does not exist", async () => {
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year)
        VALUES ('men_orphan', 'mtx_missing', 'fbo_pool', 'debit', 500, 'NJ', 2026)
      `),
      /foreign key/i,
    );
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year)
        VALUES ('men_orphan', 'mtx_1', 'user_available:missing', 'debit', 500, 'NJ', 2026)
      `),
      /foreign key/i,
    );
  });
});

describe("money history survives anything (the audit chain's ruling-7 precedent)", () => {
  it("carries no foreign key from money_transactions.league_id, so deleting a league cannot touch the money record", async () => {
    // No `leagues` row named `lg_ghost` exists; an FK would refuse this insert. The audit chain
    // made the same call for the same reason: a cascade is a DELETE, and the money trail of a
    // deleted league is exactly the trail you want to still have.
    await db.execute(sql`INSERT INTO money_transactions (id, kind, league_id) VALUES ('mtx_lg', 'entry_fee', 'lg_ghost')`);
    const [row] = await db.execute<{ league_id: string }>(sql`SELECT league_id FROM money_transactions WHERE id = 'mtx_lg'`);
    expect(row?.league_id).toBe("lg_ghost");
  });
});
