import { describe, expect, it } from "vitest";
import { SIM_CONFIG, SIM_RUN_OPTIONS as SERVICE_RUN_OPTIONS, SIM_SHARPNESS as SERVICE_SHARPNESS } from "@/draft-service/sim/config";
import { SIM_RUN_OPTIONS, SIM_SHARPNESS } from "./constants";

describe("the simulator client's constants", () => {
  it("never drifts from the service's own SIM_RUN_OPTIONS", () => {
    expect(SIM_RUN_OPTIONS).toEqual(SERVICE_RUN_OPTIONS);
  });

  it("never drifts from the service's own SIM_SHARPNESS", () => {
    expect(SIM_SHARPNESS).toEqual(SERVICE_SHARPNESS);
  });

  it("the sync-run threshold is one of the offered run sizes, so the smallest option always finishes inline", () => {
    expect(SIM_RUN_OPTIONS).toContain(SIM_CONFIG.syncRunThreshold);
  });
});
