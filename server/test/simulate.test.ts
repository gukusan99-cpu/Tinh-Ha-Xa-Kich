import { describe, expect, it } from "vitest";
import { runMany, simulateMatch } from "../src/sim/simulate.js";

describe("simulate", () => {
  it("tất định theo seed", () => {
    for (const policy of ["gioi", "ngau_nhien", "trung_binh"] as const) {
      expect(simulateMatch({ policy, seed: 42 })).toEqual(simulateMatch({ policy, seed: 42 }));
    }
  });

  it("bot ngẫu nhiên thắng ít hơn bot giỏi", () => {
    const good = runMany("gioi", 200);
    const rand = runMany("ngau_nhien", 200);
    expect(rand.win).toBeLessThan(good.win);
  }, 120_000);
});
