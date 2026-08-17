import { describe, it, expect } from "vitest";
import { createKeyedMutex } from "./mutex";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createKeyedMutex", () => {
  it("runs tasks for the same key strictly one after another", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const task = (label: string) => async () => {
      order.push(`${label}:start`);
      await tick();
      order.push(`${label}:end`);
      return label;
    };
    const results = await Promise.all([mutex.run("d1", task("a")), mutex.run("d1", task("b")), mutex.run("d1", task("c"))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("lets different keys run concurrently", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const task = (label: string) => async () => {
      order.push(`${label}:start`);
      await tick();
      order.push(`${label}:end`);
    };
    await Promise.all([mutex.run("d1", task("a")), mutex.run("d2", task("b"))]);
    expect(order.slice(0, 2).sort()).toEqual(["a:start", "b:start"]);
  });

  it("keeps the queue moving after a task throws", async () => {
    const mutex = createKeyedMutex();
    const failed = mutex.run("d1", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(mutex.run("d1", async () => "next")).resolves.toBe("next");
  });
});
