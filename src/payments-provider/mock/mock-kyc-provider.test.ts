import { describe, expect, it } from "vitest";
import type { Clock } from "@/domain/timing";
import type { KycProviderHarness } from "../kyc-contract-suite";
import { runKycProviderContractSuite } from "../kyc-contract-suite";
import { createMockKycProvider, MOCK_KYC_CONFIG, type MockKycProvider } from "./mock-kyc-provider";

const START_ISO = "2026-09-01T12:00:00.000Z";
const USER_ID = "user-mock-kyc";

interface MockRig {
  readonly provider: MockKycProvider;
  readonly clock: Clock;
}

function makeRig(): MockRig {
  const clock: Clock = { now: () => START_ISO };
  return { provider: createMockKycProvider(clock), clock };
}

let seq = 0;
function makeHarness(): KycProviderHarness {
  const { provider } = makeRig();
  return {
    provider,
    userId: USER_ID,
    async verifying(minAge) {
      const ref = await provider.submitVerification({
        userId: USER_ID,
        legalName: "Verifying Person",
        dateOfBirth: "1990-01-01",
        minAge,
        idempotencyKey: `harness-verifying-${seq++}`,
      });
      provider.advance();
      return ref;
    },
    async awaitingReview(minAge) {
      return provider.submitVerification({
        userId: USER_ID,
        legalName: "Reviewing Person",
        dateOfBirth: "1990-01-01",
        minAge,
        idempotencyKey: `harness-pending-${seq++}`,
      });
    },
    async failingIdentity(minAge) {
      return provider.submitVerification({
        userId: USER_ID,
        legalName: MOCK_KYC_CONFIG.failingLegalName,
        dateOfBirth: "1990-01-01",
        minAge,
        idempotencyKey: `harness-failing-${seq++}`,
      });
    },
    async underage(minAge) {
      return provider.submitVerification({
        userId: USER_ID,
        legalName: "Underage Person",
        dateOfBirth: "2020-01-01",
        minAge,
        idempotencyKey: `harness-underage-${seq++}`,
      });
    },
    async advance() {
      provider.advance();
    },
  };
}

runKycProviderContractSuite("mock", makeHarness);

describe("createMockKycProvider — mock-specific behavior", () => {
  it("stamps the injected clock, never a wall clock, on age arithmetic at the birthday boundary", async () => {
    const rig = makeRig();
    // Turns 18 exactly on the clock's current instant: the same-day birthday must count.
    const ref = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "Birthday Person",
      dateOfBirth: "2008-09-01",
      minAge: 18,
      idempotencyKey: "birthday-exact",
    });
    await expect(rig.provider.getStatus(ref)).resolves.toBe("pending");
  });

  it("treats one day short of the minimum age as underage", async () => {
    const rig = makeRig();
    const ref = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "Almost Birthday Person",
      dateOfBirth: "2008-09-02",
      minAge: 18,
      idempotencyKey: "birthday-minus-one",
    });
    await expect(rig.provider.getStatus(ref)).resolves.toBe("failed");
  });

  it("advance() settles only pending submissions, leaving failed ones alone", async () => {
    const rig = makeRig();
    const pending = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "Fine Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "advance-pending",
    });
    const failed = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: MOCK_KYC_CONFIG.failingLegalName,
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "advance-failed",
    });
    rig.provider.advance();
    await expect(rig.provider.getStatus(pending)).resolves.toBe("verified");
    await expect(rig.provider.getStatus(failed)).resolves.toBe("failed");
  });

  it("failNextSubmission fails the next submission regardless of identity, then closes", async () => {
    const rig = makeRig();
    rig.provider.failNextSubmission("Injected failure for this test.");
    const injected = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "Otherwise Fine Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "injected-failure",
    });
    await expect(rig.provider.getStatus(injected)).resolves.toBe("failed");

    const next = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "Second Fine Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "after-injected-failure",
    });
    await expect(rig.provider.getStatus(next)).resolves.toBe("pending");
  });

  it("issues sequential, distinct refs across submissions", async () => {
    const rig = makeRig();
    const first = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "First Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "seq-1",
    });
    const second = await rig.provider.submitVerification({
      userId: USER_ID,
      legalName: "Second Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "seq-2",
    });
    expect(first).not.toBe(second);
  });
});
