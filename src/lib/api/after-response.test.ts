import { afterEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn<(task: () => Promise<void>) => void>());
vi.mock("next/server", () => ({ after: afterMock }));

import { runAfterResponse } from "./after-response";

afterEach(() => {
  afterMock.mockReset();
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("runAfterResponse", () => {
  it("inside a request scope, hands the work to Next's after() and runs nothing itself", async () => {
    const work = vi.fn(async () => undefined);
    runAfterResponse(work);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
    await afterMock.mock.calls[0]![0]();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("outside a request scope (after() throws), runs the work now, detached", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    const work = vi.fn(async () => undefined);
    runAfterResponse(work);
    await flush();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("a failing work never throws into the caller in either scope; it is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    afterMock.mockImplementation((task) => void task());
    runAfterResponse(async () => {
      throw new Error("boom");
    });
    await flush();
    afterMock.mockImplementation(() => {
      throw new Error("outside");
    });
    runAfterResponse(async () => {
      throw new Error("boom again");
    });
    await flush();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
