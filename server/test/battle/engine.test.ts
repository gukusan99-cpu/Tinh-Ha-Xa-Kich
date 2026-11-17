import { describe, expect, it } from "vitest";
import {
  applyMoves,
  chooseMonsterShot,
  createBattleState,
  mulberry32,
  outcome,
  resolveShots,
  winnerTeam,
} from "../../src/battle/engine.js";
import { loadBattleConfig, loadGuns } from "../../src/battle/config.js";
import type { BattleState, ShotCommand } from "../../src/battle/types.js";
import { CFG, GUNS, center, deepFreeze, flatMap, mkState, unit } from "./helpers.js";

const shot = (unitId: number, angle: number, power: number, facing: 1 | -1 = 1): ShotCommand => ({
  unitId,
  angle,
  power,
  facing,
  gunId: "g",
  aimElapsedSeconds: 0,
});

describe("config", () => {
  it("loads real data files", () => {
    const cfg = loadBattleConfig();
    expect(cfg.simHz).toBe(60);
    expect(Number.isFinite(cfg.deviationMaxTiles)).toBe(true);
    expect(loadGuns()["thuoc_no_nho"]?.damage).toBeGreaterThan(0);
  });
});

describe("mulberry32", () => {
  it("is deterministic and in [0,1)", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(6)()).not.toBe(mulberry32(5)());
  });
});

describe("createBattleState", () => {
  it("places units on the surface and marks alive", () => {
    const map = flatMap();
    map.rows[15] = "#" + map.rows[15]!.slice(1); // column 0 higher
    const s = createBattleState(map, [unit(1, 0, 0), unit(2, 10, 1)]);
    expect(s.turn).toBe(1);
    expect(s.units[0]!.y).toBe(15);
    expect(s.units[1]!.y).toBe(20);
    expect(s.units.every((u) => u.alive)).toBe(true);
    expect(s.rows).not.toBe(map.rows);
  });
});

describe("applyMoves", () => {
  it("moves up to range and reports the path", () => {
    const s = mkState([unit(1, 10, 0)]);
    const { state, moves } = applyMoves(s, [{ unitId: 1, col: 30 }], CFG);
    expect(moves[0]!.path).toEqual([11, 12, 13, 14, 15]);
    expect(moves[0]!.col).toBe(15);
    expect(state.units[0]!.col).toBe(15);
    const left = applyMoves(s, [{ unitId: 1, col: 8 }], CFG);
    expect(left.moves[0]!.path).toEqual([9, 8]);
  });
  it("stays when target is own column", () => {
    const s = mkState([unit(1, 10, 0)]);
    expect(applyMoves(s, [{ unitId: 1, col: 10 }], CFG).moves[0]!.path).toEqual([]);
  });
  it("stops at the map edges", () => {
    const s = mkState([unit(1, 2, 0)]);
    expect(applyMoves(s, [{ unitId: 1, col: -9 }], CFG).moves[0]!.col).toBe(0);
    const s2 = mkState([unit(1, 57, 0)]);
    expect(applyMoves(s2, [{ unitId: 1, col: 99 }], CFG).moves[0]!.col).toBe(59);
  });
  it("climbs 1 tile but stops at a 2 tile step; updates y", () => {
    const map = flatMap();
    map.rows[19] = map.rows[19]!.slice(0, 12) + "#" + map.rows[19]!.slice(13); // col 12 height 1
    map.rows[18] = map.rows[18]!.slice(0, 14) + "#" + map.rows[18]!.slice(15);
    map.rows[19] = map.rows[19]!.slice(0, 14) + "#" + map.rows[19]!.slice(15); // col 14 height 2
    const s = createBattleState(map, [unit(1, 10, 0)]);
    const r = applyMoves(s, [{ unitId: 1, col: 18 }], CFG);
    expect(r.moves[0]!.path).toEqual([11, 12, 13]);
    expect(r.moves[0]!.y).toBe(20);
    const r2 = applyMoves(s, [{ unitId: 1, col: 12 }], CFG);
    expect(r2.moves[0]!.y).toBe(19);
    expect(r2.state.units[0]!.y).toBe(19);
  });
  it("descends into a pit", () => {
    const map = flatMap();
    map.rows[20] = map.rows[20]!.slice(0, 11) + "." + map.rows[20]!.slice(12);
    const s = createBattleState(map, [unit(1, 10, 0)]);
    const r = applyMoves(s, [{ unitId: 1, col: 11 }], CFG);
    expect(r.moves[0]!.y).toBe(21);
  });
  it("does not mutate input", () => {
    const s = deepFreeze(mkState([unit(1, 10, 0)]));
    expect(() => applyMoves(s, deepFreeze([{ unitId: 1, col: 12 }]), CFG)).not.toThrow();
  });
});

describe("resolveShots ballistics", () => {
  it("lands where flat-ground ballistics predicts", () => {
    const s = mkState([unit(1, 5, 0)]);
    const { result } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    const v = 20;
    const vy = v * Math.sin(Math.PI / 4);
    const h = 0.75;
    const t = (vy + Math.sqrt(vy * vy + 2 * CFG.gravityTilesPerSec2 * h)) / CFG.gravityTilesPerSec2;
    const expectedX = 5.5 + v * Math.cos(Math.PI / 4) * t;
    const imp = result.shots[0]!.impact!;
    expect(Math.abs(imp.x - expectedX)).toBeLessThan(1);
    expect(imp.y).toBeGreaterThanOrEqual(20);
    expect(imp.y).toBeLessThan(20.8);
    expect(result.shots[0]!.flightSeconds).toBeGreaterThan(0.9);
    const pts = result.shots[0]!.points;
    expect(pts.length).toBeGreaterThan(5);
    expect(pts[0]).toEqual([5.5, 19.25]);
    const last = pts[pts.length - 1]!;
    expect(Math.abs(last[0] - imp.x)).toBeLessThan(0.01);
  });
  it("facing -1 goes left", () => {
    const s = mkState([unit(1, 30, 0)]);
    const { result } = resolveShots(s, [shot(1, 45, 50, -1)], GUNS, CFG, 1);
    expect(result.shots[0]!.impact!.x).toBeLessThan(30);
  });
  it("returns turn + 1 and never mutates input", () => {
    const s = deepFreeze(mkState([unit(1, 5, 0), unit(2, 19, 1)]));
    const cmds = deepFreeze([shot(1, 45, 50)]);
    const { state } = resolveShots(s, cmds, GUNS, { ...CFG, deviationMaxTiles: 3 }, 9);
    expect(state.turn).toBe(2);
    expect(s.turn).toBe(1);
  });
});

describe("determinism", () => {
  const cfg = { ...CFG, deviationMaxTiles: 3 };
  const s = mkState([unit(1, 5, 0), unit(2, 40, 1)]);
  it("same seed gives identical results", () => {
    const a = resolveShots(s, [shot(1, 45, 50), shot(2, 45, 50, -1)], GUNS, cfg, 77);
    const b = resolveShots(s, [shot(1, 45, 50), shot(2, 45, 50, -1)], GUNS, cfg, 77);
    expect(a.result).toEqual(b.result);
    expect(a.state).toEqual(b.state);
  });
  it("different seed gives different deviation", () => {
    const a = resolveShots(s, [shot(1, 45, 50)], GUNS, cfg, 1).result.shots[0]!.impact!;
    const b = resolveShots(s, [shot(1, 45, 50)], GUNS, cfg, 2).result.shots[0]!.impact!;
    expect(a.x).not.toBe(b.x);
  });
  it("deviation stays bounded by about deviationMaxTiles", () => {
    const base = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1).result.shots[0]!.impact!;
    for (let seed = 0; seed < 30; seed++) {
      const i = resolveShots(s, [shot(1, 45, 50)], GUNS, cfg, seed).result.shots[0]!.impact!;
      expect(Math.abs(i.x - base.x)).toBeLessThan(5);
    }
  });
  it("monster uses aiErrorTiles instead of deviationMaxTiles", () => {
    const st = mkState([unit(1, 5, 0), unit(2, 40, 1, { aiErrorTiles: 0 })]);
    const a = resolveShots(st, [shot(2, 45, 50, -1)], GUNS, cfg, 1).result.shots[0]!.impact!;
    const b = resolveShots(st, [shot(2, 45, 50, -1)], GUNS, cfg, 2).result.shots[0]!.impact!;
    expect(a.x).toBeCloseTo(b.x, 6);
  });
});

describe("damage", () => {
  // target around the landing spot of 45deg/50 from col 5 (x ~ 19.5)
  it("direct hit deals full damage", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 19, 1)]);
    const { result, state } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    expect(result.shots[0]!.hitUnitId).toBe(2);
    expect(result.damage).toEqual([{ unitId: 2, sourceUnitId: 1, amount: 35, hpAfter: 65 }]);
    expect(state.units[1]!.hp).toBe(65);
  });
  it("splash falls off with distance", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 21, 1)]);
    const { result } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    const sh = result.shots[0]!;
    expect(sh.hitUnitId).toBeNull();
    const t = s.units[1]!;
    const [cx, cy] = center(t);
    const dist = Math.hypot(sh.impact!.x - cx, sh.impact!.y - cy);
    const expected = Math.round(35 * Math.max(0, 1 - dist / (2 + 0.75)));
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(35);
    expect(result.damage).toEqual([
      { unitId: 2, sourceUnitId: 1, amount: expected, hpAfter: 100 - expected },
    ]);
  });
  it("no damage outside blast radius + unit radius", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 30, 1)]);
    const { result } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    expect(result.damage).toEqual([]);
  });
  it("crit multiplies damage", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 19, 1)]);
    const { result } = resolveShots(s, [shot(1, 45, 50)], GUNS, { ...CFG, critChance: 1 }, 1);
    expect(result.shots[0]!.crit).toBe(true);
    expect(result.damage[0]!.amount).toBe(Math.round(35 * 1.5));
  });
  it("no crit when critChance is 0", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 19, 1)]);
    const { result } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    expect(result.shots[0]!.crit).toBe(false);
  });
  it("self-hit grace: no self hit early, but hit when grace is 0", () => {
    const s = mkState([unit(1, 5, 0)]);
    const a = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1).result.shots[0]!;
    expect(a.hitUnitId).toBeNull();
    const b = resolveShots(s, [shot(1, 45, 50)], GUNS, { ...CFG, selfHitGraceSeconds: 0 }, 1).result;
    expect(b.shots[0]!.hitUnitId).toBe(1);
    expect(b.damage[0]!.unitId).toBe(1);
  });
});

describe("craters, simultaneity, order", () => {
  it("crater removes tiles within radius and only those", () => {
    const s = mkState([unit(1, 5, 0)]);
    const { result, state } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    const ex = result.explosions[0]!;
    expect(ex.radius).toBe(2);
    expect(ex.removedTiles.length).toBeGreaterThan(0);
    for (const [c, r] of ex.removedTiles) {
      expect(Math.hypot(c + 0.5 - ex.x, r + 0.5 - ex.y)).toBeLessThanOrEqual(2);
      expect(s.rows[r]![c]).toBe("#");
      expect(state.rows[r]![c]).toBe(".");
    }
    let diff = 0;
    for (let r = 0; r < s.height; r++)
      for (let c = 0; c < s.width; c++) if (s.rows[r]![c] !== state.rows[r]![c]) diff++;
    expect(diff).toBe(ex.removedTiles.length);
  });
  it("simultaneous shots use start-of-phase terrain", () => {
    // both aim at the same spot (~19.5); sequential resolving would drop the second into the crater
    const s = mkState([unit(1, 5, 0), unit(2, 33, 0)]);
    const { result } = resolveShots(s, [shot(1, 45, 50, 1), shot(2, 45, 50, -1)], GUNS, CFG, 1);
    const a = result.shots[0]!.impact!;
    const b = result.shots[1]!.impact!;
    expect(a.y).toBeLessThan(20.8);
    expect(b.y).toBeLessThan(20.8);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.8);
  });
  it("applies explosions in impact-time order, ties by unitId", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 20, 0), unit(3, 35, 0)]);
    // unit1 long shot, unit2 short shot, unit3 identical to unit2 (time tie)
    const { result } = resolveShots(
      s,
      [shot(1, 45, 70), shot(2, 45, 30), shot(3, 45, 30, -1)],
      GUNS,
      CFG,
      1,
    );
    expect(result.explosions.map((e) => e.unitId)).toEqual([2, 3, 1]);
  });
  it("later explosions only list tiles still present", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 33, 0)]);
    const { result } = resolveShots(s, [shot(1, 45, 50, 1), shot(2, 45, 50, -1)], GUNS, CFG, 1);
    const [e1, e2] = result.explosions;
    const set = new Set(e1!.removedTiles.map(([c, r]) => `${c},${r}`));
    for (const [c, r] of e2!.removedTiles) expect(set.has(`${c},${r}`)).toBe(false);
  });
});

describe("falling and death", () => {
  it("unit falls when the ground beneath is removed", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 19, 1)]);
    const { result, state } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    const u = state.units[1]!;
    expect(u.alive).toBe(true);
    expect(u.y).toBeGreaterThan(20);
    expect(state.rows[u.y]![u.col]).toBe("#");
    for (let r = 20; r < u.y; r++) expect(state.rows[r]![u.col]).toBe(".");
    expect(result.falls).toContainEqual({ unitId: 2, y: u.y });
  });
  it("unit dies when falling off the map", () => {
    const map = flatMap(60, 30, 30);
    map.rows[20] = "#".repeat(60); // 1-tile thick floor only
    const s = createBattleState(map, [unit(1, 5, 0), unit(2, 19, 1)]);
    const { result, state } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    expect(state.units[1]!.alive).toBe(false);
    expect(result.falls).toContainEqual({ unitId: 2, y: -1 });
    expect(result.deaths).toContain(2);
  });
  it("unit dies from damage", () => {
    const s = mkState([unit(1, 5, 0), unit(2, 19, 1, { hp: 20, maxHp: 20 })]);
    const { result, state } = resolveShots(s, [shot(1, 45, 50)], GUNS, CFG, 1);
    expect(result.deaths).toContain(2);
    expect(state.units[1]!.alive).toBe(false);
    expect(state.units[1]!.hp).toBe(0);
    expect(result.damage[0]!.hpAfter).toBe(0);
  });
});

describe("leaving the map", () => {
  it("left", () => {
    const s = mkState([unit(1, 1, 0)]);
    const { result } = resolveShots(s, [shot(1, 10, 100, -1)], GUNS, CFG, 1);
    expect(result.shots[0]!.impact).toBeNull();
    expect(result.explosions).toEqual([]);
    expect(result.shots[0]!.points.length).toBeGreaterThan(1);
  });
  it("right", () => {
    const s = mkState([unit(1, 20, 0)]);
    const { result } = resolveShots(s, [shot(1, 45, 100)], GUNS, CFG, 1);
    expect(result.shots[0]!.impact).toBeNull();
    expect(result.explosions).toEqual([]);
  });
  it("bottom", () => {
    const map = flatMap(60, 30, 30);
    for (let r = 20; r < 30; r++) map.rows[r] = "#".repeat(4) + ".".repeat(56);
    const s = createBattleState(map, [unit(1, 1, 0)]);
    const { result } = resolveShots(s, [shot(1, 10, 50)], GUNS, CFG, 1);
    expect(result.shots[0]!.impact).toBeNull();
    expect(result.explosions).toEqual([]);
  });
  it("flying above the top edge continues and lands", () => {
    const s = mkState([unit(1, 5, 0)], flatMap(60, 30, 5));
    const { result } = resolveShots(s, [shot(1, 80, 100)], GUNS, CFG, 1);
    expect(result.shots[0]!.impact).not.toBeNull();
  });
});

describe("outcome", () => {
  const base = (): BattleState => mkState([unit(1, 5, 0), unit(2, 20, 1)]);
  it("null while both sides alive", () => {
    expect(outcome(base(), 20)).toBeNull();
  });
  it("win when no monsters", () => {
    const s = base();
    s.units[1]!.alive = false;
    expect(outcome(s, 20)).toBe("win");
  });
  it("lose when no players, and lose beats win", () => {
    const s = base();
    s.units[0]!.alive = false;
    expect(outcome(s, 20)).toBe("lose");
    s.units[1]!.alive = false;
    expect(outcome(s, 20)).toBe("lose");
  });
  it("draw after maxTurns", () => {
    const s = base();
    s.turn = 21;
    expect(outcome(s, 20)).toBe("draw");
    s.turn = 20;
    expect(outcome(s, 20)).toBeNull();
  });
});

describe("winnerTeam", () => {
  const base = (): BattleState => mkState([unit(1, 5, 0), unit(2, 20, 1)]);
  it("null while both teams alive", () => {
    expect(winnerTeam(base(), 20)).toBeNull();
  });
  it("team 0 / team 1 wins when the other team is gone", () => {
    const s = base();
    s.units[1]!.alive = false;
    expect(winnerTeam(s, 20)).toBe(0);
    const t = base();
    t.units[0]!.alive = false;
    expect(winnerTeam(t, 20)).toBe(1);
  });
  it("draw when both teams are dead, or after maxTurns", () => {
    const s = base();
    s.units[0]!.alive = false;
    s.units[1]!.alive = false;
    expect(winnerTeam(s, 20)).toBe("draw");
    const t = base();
    t.turn = 21;
    expect(winnerTeam(t, 20)).toBe("draw");
    t.turn = 20;
    expect(winnerTeam(t, 20)).toBeNull();
  });
  it("a dead team beats the turn limit", () => {
    const s = base();
    s.turn = 99;
    s.units[1]!.alive = false;
    expect(winnerTeam(s, 20)).toBe(0);
  });
});

describe("chooseMonsterShot", () => {
  it("lands within 1.5 tiles of a reachable player", () => {
    for (const dist of [6, 10, 14, 18, 24, 30]) {
      const s = mkState([unit(1, 10, 0), unit(2, 10 + dist, 1, { aiErrorTiles: 0 })]);
      const cmd = chooseMonsterShot(s, 2, GUNS, CFG);
      expect(cmd.unitId).toBe(2);
      expect(cmd.angle).toBeGreaterThanOrEqual(CFG.aimAngleMinDegrees);
      expect(cmd.angle).toBeLessThanOrEqual(CFG.aimAngleMaxDegrees);
      expect(cmd.power).toBeGreaterThanOrEqual(10);
      expect(cmd.power).toBeLessThanOrEqual(100);
      expect(cmd.facing).toBe(-1);
      const { result } = resolveShots(s, [cmd], GUNS, CFG, 1);
      const imp = result.shots[0]!.impact!;
      expect(imp).not.toBeNull();
      const [px, py] = center(s.units[0]!);
      expect(Math.hypot(imp.x - px, imp.y - py)).toBeLessThan(1.5);
    }
  });
  it("targets the nearest living player", () => {
    const s = mkState([unit(1, 5, 0), unit(3, 40, 0), unit(2, 45, 1)]);
    const cmd = chooseMonsterShot(s, 2, GUNS, CFG);
    const { result } = resolveShots(s, [cmd], GUNS, CFG, 1);
    expect(Math.abs(result.shots[0]!.impact!.x - 40.5)).toBeLessThan(1.5);
  });
  it("does not mutate input", () => {
    const s = deepFreeze(mkState([unit(1, 10, 0), unit(2, 30, 1)]));
    expect(() => chooseMonsterShot(s, 2, GUNS, CFG)).not.toThrow();
  });
  it("does not shoot into a wall right next to itself", () => {
    const map = flatMap();
    for (let r = 0; r < 20; r++) map.rows[r] = map.rows[r]!.slice(0, 26) + "####" + map.rows[r]!.slice(30);
    const s = createBattleState(map, [unit(1, 10, 0), unit(2, 30, 1, { aiErrorTiles: 0 })]);
    const cmd = chooseMonsterShot(s, 2, GUNS, CFG);
    const { state } = resolveShots(s, [cmd], GUNS, CFG, 1);
    expect(state.units.find((u) => u.id === 2)!.hp).toBe(100);
  });
  it("in a narrow pit prefers a shot that stays safe under its own deviation", () => {
    const map = flatMap();
    // hố hẹp rộng 3 ô (cột 29..31) sâu 2 ô; người chơi ở cột 25, quái ở đáy hố cột 30
    for (let r = 20; r < 22; r++) map.rows[r] = map.rows[r]!.slice(0, 29) + "..." + map.rows[r]!.slice(32);
    const mk = (err: number) => createBattleState(map, [unit(1, 25, 0), unit(2, 30, 1, { aiErrorTiles: err })]);
    const lossOver = (cmdFrom: BattleState, run: BattleState): number => {
      const cmd = chooseMonsterShot(cmdFrom, 2, GUNS, CFG);
      let total = 0;
      for (let seed = 1; seed <= 40; seed++) total += 100 - resolveShots(run, [cmd], GUNS, CFG, seed).state.units[1]!.hp;
      return total / 40;
    };
    const naive = lossOver(mk(0), mk(4)); // chọn như không có độ lệch
    const aware = lossOver(mk(4), mk(4));
    expect(aware).toBeLessThan(naive);
  });
  it("keeps allies out of the blast", () => {
    const s = mkState([unit(1, 10, 0), unit(2, 30, 1, { aiErrorTiles: 0 }), unit(3, 11, 1, { aiErrorTiles: 0 })]);
    const cmd = chooseMonsterShot(s, 2, GUNS, CFG);
    const { state } = resolveShots(s, [cmd], GUNS, CFG, 1);
    expect(state.units.find((u) => u.id === 3)!.hp).toBe(100);
    expect(state.units.find((u) => u.id === 2)!.hp).toBe(100);
  });
  it("finishes under 200 ms on a 60x30 map", () => {
    const map = flatMap(60, 30, 22);
    for (let c = 0; c < 60; c++) {
      const h = 22 - Math.round(4 * Math.sin(c / 5) + 4);
      for (let r = h; r < 30; r++) map.rows[r] = map.rows[r]!.slice(0, c) + "#" + map.rows[r]!.slice(c + 1);
    }
    const s = createBattleState(map, [unit(1, 6, 0), unit(2, 53, 1)]);
    const t0 = performance.now();
    chooseMonsterShot(s, 2, GUNS, CFG);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
