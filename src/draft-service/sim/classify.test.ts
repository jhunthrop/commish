import { describe, expect, it } from "vitest";
import { classifyBuild, type ClassifiablePick } from "./classify";

function pick(round: number, position: ClassifiablePick["position"]): ClassifiablePick {
  return { round, position };
}

describe("classifyBuild", () => {
  it("labels zero RBs in rounds 1-3 as zero-RB", () => {
    const picks = [pick(1, "WR"), pick(2, "WR"), pick(3, "TE"), pick(4, "RB"), pick(5, "RB"), pick(6, "QB")];
    expect(classifyBuild(picks)).toContain("zero-RB");
    expect(classifyBuild(picks)).not.toContain("hero-RB");
    expect(classifyBuild(picks)).not.toContain("robust-RB");
  });

  it("labels exactly one RB in rounds 1-3 as hero-RB", () => {
    const picks = [pick(1, "RB"), pick(2, "WR"), pick(3, "WR"), pick(4, "TE"), pick(5, "QB"), pick(6, "WR")];
    expect(classifyBuild(picks)).toContain("hero-RB");
  });

  it("labels two or more RBs in rounds 1-3 as robust-RB", () => {
    const picks = [pick(1, "RB"), pick(2, "RB"), pick(3, "WR"), pick(4, "WR"), pick(5, "QB"), pick(6, "TE")];
    expect(classifyBuild(picks)).toContain("robust-RB");
  });

  it("a round-4 RB never counts toward the rounds 1-3 shape", () => {
    const picks = [pick(1, "WR"), pick(2, "WR"), pick(3, "TE"), pick(4, "RB")];
    expect(classifyBuild(picks)).toContain("zero-RB");
  });

  it("labels a tight end in round 1 or 2 as early-TE", () => {
    const picks = [pick(1, "RB"), pick(2, "TE"), pick(3, "WR")];
    expect(classifyBuild(picks)).toContain("early-TE");
  });

  it("a round-3 tight end is not early-TE", () => {
    const picks = [pick(1, "RB"), pick(2, "WR"), pick(3, "TE")];
    expect(classifyBuild(picks)).not.toContain("early-TE");
  });

  it("labels no quarterback through round six as late-QB", () => {
    const picks = [pick(1, "RB"), pick(2, "WR"), pick(3, "WR"), pick(4, "TE"), pick(5, "RB"), pick(6, "WR")];
    expect(classifyBuild(picks)).toContain("late-QB");
  });

  it("a quarterback anywhere in the first six rounds rules out late-QB", () => {
    const picks = [pick(1, "RB"), pick(6, "QB")];
    expect(classifyBuild(picks)).not.toContain("late-QB");
  });

  it("a build can carry more than one independent label at once", () => {
    const picks = [pick(1, "RB"), pick(2, "TE"), pick(3, "WR"), pick(4, "WR"), pick(5, "RB"), pick(6, "WR")];
    const labels = classifyBuild(picks);
    expect(labels).toContain("hero-RB");
    expect(labels).toContain("early-TE");
    expect(labels).toContain("late-QB");
  });

  it("rounds past six never influence any label", () => {
    const throughSix = [pick(1, "WR"), pick(2, "WR"), pick(3, "WR"), pick(4, "WR"), pick(5, "WR"), pick(6, "WR")];
    const withLaterQb = [...throughSix, pick(7, "QB"), pick(8, "RB")];
    expect(classifyBuild(withLaterQb)).toEqual(classifyBuild(throughSix));
  });

  it("an empty pick list is zero-RB and late-QB, with no TE tag", () => {
    expect(classifyBuild([])).toEqual(["zero-RB", "late-QB"]);
  });
});
