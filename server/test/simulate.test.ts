import { describe, expect, it } from "vitest";
import { runMany, simulateMatch } from "../src/sim/simulate.js";

describe("simulate", () => {
  it("tất định theo seed", () => {
    for (const policy of ["gioi", "ngau_nhien", "trung_binh"] as const) {
      expect(simulateMatch({ policy, seed: 42 })).toEqual(simulateMatch({ policy, seed: 42 }));
    }
  });

  it("tất định theo seed với từng cung; cung lạ bị từ chối", () => {
    for (const sign of ["bach_duong", "kim_nguu", "xu_nu", "bao_binh"]) {
      for (const policy of ["gioi", "trung_binh", "ngau_nhien"] as const) {
        expect(simulateMatch({ policy, seed: 7, sign })).toEqual(simulateMatch({ policy, seed: 7, sign }));
      }
    }
    expect(() => simulateMatch({ policy: "gioi", seed: 1, sign: "ma_ket" })).toThrow(/ma_ket/);
  });

  it("bot giỏi mỗi cung thắng đa số trận, bot ngẫu nhiên thua", () => {
    for (const sign of ["bach_duong", "kim_nguu", "xu_nu", "bao_binh"]) {
      const good = runMany("gioi", 40, {}, 1, sign);
      const rand = runMany("ngau_nhien", 40, {}, 1, sign);
      expect(good.win).toBeGreaterThan(0.6);
      expect(rand.win).toBeLessThan(good.win);
    }
  }, 120_000);

  it("bot ngẫu nhiên thắng ít hơn bot giỏi", () => {
    const good = runMany("gioi", 200);
    const rand = runMany("ngau_nhien", 200);
    expect(rand.win).toBeLessThan(good.win);
  }, 120_000);
});
