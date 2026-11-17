import { describe, expect, it } from "vitest";
import { pvpPairs, runMany, runPvpPair, simulateMatch, simulatePvpMatch } from "../src/sim/simulate.js";

describe("simulate PvP", () => {
  it("10 cặp cung kể cả cùng cung", () => {
    const pairs = pvpPairs(["a", "b", "c", "d"]);
    expect(pairs).toHaveLength(10);
    expect(pairs.filter(([x, y]) => x === y)).toHaveLength(4);
  });

  it("tất định theo seed, kể cả khi đổi bên", () => {
    for (const swap of [false, true]) {
      const o = { signA: "bach_duong", signB: "xu_nu", seed: 11, swap };
      expect(simulatePvpMatch(o)).toEqual(simulatePvpMatch(o));
    }
    expect(() => simulatePvpMatch({ signA: "ma_ket", signB: "xu_nu", seed: 1, swap: false })).toThrow(/ma_ket/);
  });

  it("runPvpPair: thắng A + thắng B + hòa = n, đổi bên một nửa số trận", () => {
    const r = runPvpPair("kim_nguu", "bao_binh", 6, 3);
    expect(r.n).toBe(6);
    expect(r.aWins + r.bWins + r.draws).toBe(6);
    expect(r.team0Wins).toBeLessThanOrEqual(6);
    expect(r.swapped).toBe(3);
  }, 120_000);
});

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
