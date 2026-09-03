import { describe, expect, it } from "vitest";
import { JOB_DEFINITIONS } from "./registry";
import { SCHEDULES } from "./schedules";

describe("the job registry", () => {
  it("registers every job the schedules name, so no fire can ever dead-letter on arrival", () => {
    for (const schedule of SCHEDULES) {
      expect(JOB_DEFINITIONS.has(schedule.job), `schedule "${schedule.name}" names "${schedule.job}"`).toBe(true);
    }
  });

  it("gives every definition a sane retry posture", () => {
    for (const definition of JOB_DEFINITIONS.values()) {
      expect(definition.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(definition.timeoutMs).toBeGreaterThan(0);
      expect(definition.backoff.baseMs).toBeGreaterThan(0);
      expect(definition.backoff.maxMs).toBeGreaterThanOrEqual(definition.backoff.baseMs);
      expect(definition.stepNames.length).toBeGreaterThan(0);
    }
  });
});
