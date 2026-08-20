// Verifies the audit chains and exits non-zero if any of them is broken.
// Run: npm run audit:verify            (incremental, every chain)
//      npm run audit:verify -- --full  (from genesis, every chain)
//      npm run audit:verify -- --scope <leagueId|platform>
//
// This is the real mechanism, not a placeholder: the full walk is the spec's scheduled offline
// job, and a production scheduler runs exactly this on
// INTEGRITY_CONFIG.verification.fullVerifyIntervalHours. That scheduler is founder-gated deploy
// infrastructure and it belongs to PHASE 2 PLAN D — spelled out in full because "Plan D" alone is
// ambiguous across two phases and sends a reader looking in the wrong one.
//
// OPERATOR RUNBOOK, until Phase 2 Plan D lands. Run:
//
//     npm run audit:verify -- --full
//
// after any batch of new leagues is created, and on a recurring reminder no less often than
// fullVerifyIntervalHours (24h). This is NOT the same requirement as the cadence, and the
// difference is the one that matters: a chain is undetectably rewindable until its FIRST
// verification freezes a checkpoint for it (docs/decisions/audit-and-integrity.md, section 9,
// "The floor inside tier 1"). Every league creates a chain on its first append, so a product
// signing up leagues continuously has a continuously refilling population of chains that no run
// has ever touched. This command walks every chain in audit_chains, including ones never verified
// before, so one run closes the floor for every chain that existed when it started. It exits
// non-zero and names the scope, sequence, event and reason on any break.
import { getDb } from "@/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { verifyAllChains, verifyChainIntegrity, verifyFullChainIntegrity, type ChainVerificationResult } from "@/integrity-service/verify";
import { INTEGRITY_CONFIG } from "@/integrity/config";

function describe(result: ChainVerificationResult): string {
  if (result.valid) return `${result.scope}: ok through sequence ${result.verifiedThrough} (${result.hashed} re-hashed)`;
  return `${result.scope}: BROKEN at sequence ${result.firstBrokenSequence} (event ${result.firstBrokenEventId}), reason ${result.reason}`;
}

/**
 * Detecting a tamper is itself an auditable act, so it is appended to the platform chain. It is
 * NOT a member notice: telling a league its record may have been tampered with, before a human
 * has looked at the output above, is the accusatory failure mode this phase spends a denylist
 * preventing. What happens next is a decision for whoever is reading this output.
 */
async function recordDetection(broken: readonly ChainVerificationResult[]): Promise<void> {
  const db = getDb();
  await db.transaction((tx) =>
    getAuditLogger().record(tx, {
      eventType: "system_action",
      actorId: null,
      actorType: "system",
      leagueId: null,
      payload: {
        action: "chain_verification_failed",
        scopes: broken.map((result) => result.scope),
        checkedAt: new Date().toISOString(),
      },
      occurredAt: new Date().toISOString(),
    }),
  );
}

async function main(): Promise<void> {
  const full = process.argv.includes("--full");
  const scopeFlag = process.argv.indexOf("--scope");
  const scope = scopeFlag === -1 ? undefined : process.argv[scopeFlag + 1];
  if (scopeFlag !== -1 && scope === undefined) throw new Error("--scope needs a chain scope id.");

  const db = getDb();
  const results =
    scope === undefined
      ? await verifyAllChains(db, { full })
      : [full ? await verifyFullChainIntegrity(db, scope) : await verifyChainIntegrity(db, scope)];

  for (const result of results) console.log(describe(result));
  const broken = results.filter((result) => !result.valid);
  if (broken.length === 0) {
    console.log(
      `${results.length} chain(s) verified ${full ? "from genesis" : "incrementally"}. Full-walk cadence: every ${INTEGRITY_CONFIG.verification.fullVerifyIntervalHours}h.`,
    );
    return;
  }

  await recordDetection(broken);
  console.error(`${broken.length} chain(s) failed verification. Nothing has been repaired and nothing will be: a chain that can be repaired is a chain that can be forged.`);
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
