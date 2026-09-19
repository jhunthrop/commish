import { describe, expect, it } from "vitest";
import { copyViolations } from "@/integrity/copy-rules";
import { DRAFT_SERVICE_COPY } from "./copy";

describe("DRAFT_SERVICE_COPY", () => {
  it("every sentence passes the house copy rules", () => {
    for (const [key, value] of Object.entries(DRAFT_SERVICE_COPY)) {
      expect(copyViolations(value), `DRAFT_SERVICE_COPY.${key} = ${JSON.stringify(value)}`).toEqual([]);
    }
  });
});
