import { describe, expect, it } from "vitest";
import { applyMoves, chooseMonsterShot, previewShot, resolveShots, traceBeam } from "../../src/battle/engine.js";
import type { GunStats, ShotCommand, Zone } from "../../src/battle/types.js";
import { CFG, flatMap, mkState, unit } from "./helpers.js";

/** Bắn 45 độ / lực 50 từ cột 5 rơi quanh x ~ 19.5: đơn vị ở cột 19 bị trúng trực tiếp. */
const cmd = (unitId: number, gunId: string, over: Partial<ShotCommand> = {}): ShotCommand => ({
  unitId,
  angle: 45,
  power: 50,
  facing: 1,
  gunId,
  aimElapsedSeconds: 0,
  ...over,
});
const gun = (id: string, over: Partial<GunStats> = {}): GunStats => ({
  id,
  sign: null,
  kind: "projectile",
  damage: 35,
  blastRadiusTiles: 1,
  energyCost: 0,
  cooldownTurns: 0,
  ...over,
});
const gunsOf = (...gs: GunStats[]): Record<string, GunStats> => Object.fromEntries(gs.map((g) => [g.id, g]));
const P = (id: number, col: number, extra: Parameters<typeof unit>[3] = {}) => unit(id, col, 0, extra);
const M = (id: number, col: number, extra: Parameters<typeof unit>[3] = {}) => unit(id, col, 1, { aiErrorTiles: 0, ...extra });

const hp = (s: { units: { id: number; hp: number }[] }, id: number): number => s.units.find((u) => u.id === id)!.hp;

describe("spread", () => {
  const spread = gun("sp", { kind: "spread", damage: 14, count: 3, angleOffsets: [-4, 0, 4] });
  it("một viên mỗi angleOffsets, parentIndex về viên gốc, góc khác nhau cho điểm rơi khác nhau", () => {
    const s = mkState([P(1, 5, { guns: ["sp"] })]);
    const { result } = resolveShots(s, [cmd(1, "sp")], gunsOf(spread), CFG, 1);
    expect(result.shots.map((x) => x.parentIndex)).toEqual([null, 0, 0]);
    expect(result.explosions).toHaveLength(3);
    const xs = result.shots.map((x) => x.impact!.x);
    expect(new Set(xs).size).toBe(3);
    // góc 41, 45, 49: tầm xa giảm dần khi góc vượt 45 và tăng khi tiến tới 45
    expect(xs[1]!).toBeGreaterThan(xs[0]!);
    expect(xs[1]!).toBeGreaterThan(xs[2]!);
  });
  it("maxPower chặn lực: lực 100 cho kết quả như lực = maxPower", () => {
    const capped = { ...spread, maxPower: 20 };
    const s = mkState([P(1, 5, { guns: ["sp"] })]);
    const a = resolveShots(s, [cmd(1, "sp", { power: 100 })], gunsOf(capped), CFG, 1).result.shots.map((x) => x.impact);
    const b = resolveShots(s, [cmd(1, "sp", { power: 20 })], gunsOf(capped), CFG, 1).result.shots.map((x) => x.impact);
    expect(a).toEqual(b);
    const far = resolveShots(s, [cmd(1, "sp", { power: 100 })], gunsOf(spread), CFG, 1).result.shots[1]!.impact!.x;
    expect(far).toBeGreaterThan(a[1]!.x);
  });
  it("mỗi viên gắn cháy khi trúng; tất định theo seed (có độ lệch)", () => {
    const burning = { ...spread, burn: { turns: 2, damagePerTurn: 5 } };
    const cfg = { ...CFG, deviationMaxTiles: 3 };
    const s = mkState([P(1, 5, { guns: ["sp"] }), M(2, 19)]);
    const a = resolveShots(s, [cmd(1, "sp")], gunsOf(burning), cfg, 9);
    const b = resolveShots(s, [cmd(1, "sp")], gunsOf(burning), cfg, 9);
    expect(a.result).toEqual(b.result);
    expect(a.result.shots).toHaveLength(3);
  });
});

describe("beam (laser)", () => {
  const beam = gun("lz", { kind: "beam", damage: 35, blastRadiusTiles: 0, beamLengthTiles: 40, pierceTiles: 2 });

  it("đi thẳng, gây sát thương mọi địch trên đường, không có vụ nổ, không phá đất", () => {
    const s = mkState([P(1, 5, { guns: ["lz"] }), M(2, 20), M(3, 30), P(4, 12)]);
    const { result, state } = resolveShots(s, [cmd(1, "lz", { angle: 0 })], gunsOf(beam), CFG, 1);
    expect(result.explosions).toEqual([]);
    expect(state.rows).toEqual(s.rows);
    expect(hp(state, 2)).toBe(100 - 35);
    expect(hp(state, 3)).toBe(100 - 35);
    expect(hp(state, 4)).toBe(100); // đồng đội không bị
    expect(hp(state, 1)).toBe(100);
    const sh = result.shots[0]!;
    expect(sh.beam).toEqual({ from: { x: 5.5, y: 19.25 }, to: { x: 45.5, y: 19.25 } });
    expect(sh.hitUnitId).toBe(2);
    expect(sh.impact).toBeNull();
    expect(sh.flightSeconds).toBe(0);
  });

  it("độ dài tia giới hạn tầm", () => {
    const s = mkState([P(1, 5, { guns: ["lz"] }), M(2, 20), M(3, 30)]);
    const short = { ...beam, beamLengthTiles: 20 };
    const { state } = resolveShots(s, [cmd(1, "lz", { angle: 0 })], gunsOf(short), CFG, 1);
    expect(hp(state, 2)).toBe(65);
    expect(hp(state, 3)).toBe(100);
  });

  it("lệch ngang: tâm đơn vị cách tia > unitRadius thì không trúng", () => {
    const s = mkState([P(1, 5, { guns: ["lz"] }), M(2, 20)], flatMap());
    // tia lên 5 độ: tới cột 20 đã cao hơn ~1.3 ô so với tâm
    const { state } = resolveShots(s, [cmd(1, "lz", { angle: 5 })], gunsOf(beam), CFG, 1);
    expect(hp(state, 2)).toBe(100);
  });

  it("xuyên tối đa pierceTiles ô đất rồi dừng", () => {
    const map = flatMap();
    map.rows[19] = map.rows[19]!.slice(0, 15) + "###" + map.rows[19]!.slice(18); // 3 ô đất chắn tia ngang
    const s = mkState([P(1, 5, { guns: ["lz"] }), M(2, 12), M(3, 30)], map);
    const two = resolveShots(s, [cmd(1, "lz", { angle: 0 })], gunsOf(beam), CFG, 1);
    expect(hp(two.state, 2)).toBe(65);
    expect(hp(two.state, 3)).toBe(100); // dừng trước ô đất thứ ba
    expect(two.result.shots[0]!.impact).not.toBeNull();
    expect(two.result.shots[0]!.beam!.to.x).toBeGreaterThan(16.9);
    expect(two.result.shots[0]!.beam!.to.x).toBeLessThanOrEqual(17);
    expect(two.state.rows).toEqual(s.rows);
    const three = resolveShots(s, [cmd(1, "lz", { angle: 0 })], gunsOf({ ...beam, pierceTiles: 3 }), CFG, 1);
    expect(hp(three.state, 3)).toBe(65);
    const none = resolveShots(s, [cmd(1, "lz", { angle: 0 })], gunsOf({ ...beam, pierceTiles: 0 }), CFG, 1);
    expect(none.result.shots[0]!.beam!.to.x).toBeGreaterThan(14.9);
  });

  it("độ lệch xoay tia: góc = atan(offset / beamLengthTiles) (offset dương nâng lên)", () => {
    const s = mkState([P(1, 5, { guns: ["lz"] })]);
    const u = s.units[0]!;
    const t = traceBeam(s, u, beam, 0, 1, 2, CFG);
    const expected = Math.atan(2 / 40);
    expect(t.to.x - t.from.x).toBeCloseTo(40 * Math.cos(expected), 1);
    expect(t.from.y - t.to.y).toBeCloseTo(40 * Math.sin(expected), 1);
    const flat = traceBeam(s, u, beam, 0, 1, 0, CFG);
    expect(flat.to.y).toBeCloseTo(flat.from.y, 5);
    const left = traceBeam(s, u, beam, 0, -1, 0, CFG);
    expect(left.to.x).toBeLessThan(left.from.x);
  });

  it("lệch ngẫu nhiên tất định theo seed; khiên hấp thụ; chí mạng nhân", () => {
    const cfg = { ...CFG, deviationMaxTiles: 3 };
    const s = mkState([P(1, 5, { guns: ["lz"] }), M(2, 20)]);
    const a = resolveShots(s, [cmd(1, "lz", { angle: 3 })], gunsOf(beam), cfg, 5).result;
    const b = resolveShots(s, [cmd(1, "lz", { angle: 3 })], gunsOf(beam), cfg, 5).result;
    expect(a).toEqual(b);
    const shielded = mkState([P(1, 5, { guns: ["lz"] }), M(2, 20, { statuses: [{ type: "shield", turns: 1, amount: 20 }] })]);
    const r = resolveShots(shielded, [cmd(1, "lz", { angle: 0 })], gunsOf(beam), CFG, 1);
    expect(r.result.shieldAbsorbed).toEqual([{ unitId: 2, amount: 20 }]);
    expect(hp(r.state, 2)).toBe(85);
    const crit = resolveShots(s, [cmd(1, "lz", { angle: 0 })], gunsOf(beam), { ...CFG, critChance: 1 }, 1);
    expect(hp(crit.state, 2)).toBe(100 - Math.round(35 * 1.5));
  });

  it("previewShot trả đoạn tia; quái dùng laser nhắm vào người chơi", () => {
    const s = mkState([P(1, 5), M(2, 30, { gunId: "lz", guns: ["lz"] })]);
    const pts = previewShot(s, cmd(2, "lz", { angle: 0, facing: -1 }), gunsOf(beam), CFG, 1);
    expect(pts).toHaveLength(2);
    expect(pts[1]![0]).toBeLessThan(pts[0]![0]);
    const c = chooseMonsterShot(s, 2, gunsOf(beam), CFG);
    const r = resolveShots(s, [c], gunsOf(beam), CFG, 1);
    expect(hp(r.state, 1)).toBe(65);
  });
});

describe("chain (Dây điện)", () => {
  const chain = gun("ch", { damage: 25, chain: { maxTargets: 2, radiusTiles: 5, falloff: 0.6 } });
  it("trúng trực tiếp thì chuyền tới địch gần nhất lần lượt, giảm falloff mỗi bước, không lặp", () => {
    const s = mkState([P(1, 5, { guns: ["ch"] }), M(2, 19), M(3, 22), M(4, 24), M(5, 40), P(6, 21)]);
    const { result, state } = resolveShots(s, [cmd(1, "ch")], gunsOf(chain), CFG, 1);
    expect(result.shots[0]!.hitUnitId).toBe(2);
    expect(result.chainHits).toEqual([
      { fromUnitId: 2, toUnitId: 3, amount: 15 },
      { fromUnitId: 3, toUnitId: 4, amount: 9 },
    ]);
    expect(hp(state, 3)).toBe(85);
    expect(hp(state, 4)).toBe(91);
    expect(hp(state, 5)).toBe(100); // quá maxTargets / ngoài bán kính
    expect(hp(state, 6)).toBe(100); // đồng đội không bị chuyền
    expect(result.damage.some((d) => d.unitId === 3 && d.amount === 15)).toBe(true);
  });
  it("trúng đất (không trực tiếp) thì không chuyền; chỉ trong radiusTiles", () => {
    const s = mkState([P(1, 5, { guns: ["ch"] }), M(2, 30), M(3, 31)]);
    expect(resolveShots(s, [cmd(1, "ch")], gunsOf(chain), CFG, 1).result.chainHits).toEqual([]);
    const near = mkState([P(1, 5, { guns: ["ch"] }), M(2, 19), M(3, 26)]); // cách 7 > 5
    expect(resolveShots(near, [cmd(1, "ch")], gunsOf(chain), CFG, 1).result.chainHits).toEqual([]);
  });
  it("tất định", () => {
    const s = mkState([P(1, 5, { guns: ["ch"] }), M(2, 19), M(3, 22)]);
    const a = resolveShots(s, [cmd(1, "ch")], gunsOf(chain), CFG, 4).result;
    expect(a).toEqual(resolveShots(s, [cmd(1, "ch")], gunsOf(chain), CFG, 4).result);
  });
});

describe("root (Trói)", () => {
  const web = gun("web", { root: { turns: 1 } });
  it("gắn root, không đi được lượt kế tiếp (như choáng), hết sau đó; vẫn bắn được", () => {
    const s = mkState([P(1, 5, { guns: ["web"] }), M(2, 19, { guns: ["web"], gunId: "web" })]);
    const r1 = resolveShots(s, [cmd(1, "web")], gunsOf(web), CFG, 1);
    expect(r1.result.statusEvents.find((e) => e.unitId === 2)!.status).toEqual({ type: "root", turns: 1 });
    expect(r1.state.units[1]!.statuses).toEqual([{ type: "root", turns: 1 }]);
    const mv = applyMoves(r1.state, [{ unitId: 2, col: 10 }], CFG);
    expect(mv.moves[0]!.path).toEqual([]);
    expect(mv.state.units[1]!.col).toBe(19);
    // vẫn bắn được
    const r2 = resolveShots(r1.state, [cmd(2, "web", { facing: -1 })], gunsOf(web), CFG, 1);
    expect(r2.result.shots).toHaveLength(1);
    expect(r2.state.units[1]!.statuses).toEqual([]);
    expect(applyMoves(r2.state, [{ unitId: 2, col: 10 }], CFG).moves[0]!.path.length).toBe(5);
  });
  it("bị chặn trên bởi rootMaxTurns", () => {
    const s = mkState([P(1, 5, { guns: ["web"] }), M(2, 19)]);
    const r = resolveShots(s, [cmd(1, "web")], gunsOf({ ...web, root: { turns: 5 } }), CFG, 1);
    expect(r.state.units[1]!.statuses).toEqual([{ type: "root", turns: CFG.rootMaxTurns }]);
  });
});

describe("vũng độc (Nọc độc)", () => {
  const venom = gun("nd", {
    damage: 10,
    blastRadiusTiles: 1.5,
    zone: { radiusTiles: 2.5, turns: 3, poison: { turns: 2, damagePerTurn: 8 } },
  });
  const G = gunsOf(venom);
  const start = () => mkState([P(1, 5, { guns: ["nd"] }), M(2, 19), P(3, 21)]);

  it("lượt bắn chỉ cảnh báo (active=false); các lượt sau gây độc và hết hạn sau zone.turns lượt", () => {
    const r1 = resolveShots(start(), [cmd(1, "nd")], G, CFG, 1);
    expect(r1.result.zones).toHaveLength(1);
    expect(r1.result.zones[0]).toMatchObject({ id: 1, radius: 2.5, turnsLeft: 3, active: false });
    expect(r1.result.statusEvents.some((e) => e.status.type === "poison")).toBe(false);
    expect(r1.result.poisonTicks).toEqual([]);
    expect(r1.state.zones).toHaveLength(1);
    const hp1 = hp(r1.state, 2);

    const r2 = resolveShots(r1.state, [], G, CFG, 1);
    expect(r2.result.statusEvents.filter((e) => e.status.type === "poison").map((e) => e.unitId)).toEqual([2]); // đồng đội đội 0 không bị
    expect(r2.result.poisonTicks).toEqual([{ unitId: 2, sourceUnitId: 0, amount: 8, hpAfter: hp1 - 8 }]);
    expect(r2.result.zones[0]).toMatchObject({ turnsLeft: 2, active: true });
    expect(r2.state.units[1]!.statuses).toEqual([{ type: "poison", turns: 1, damagePerTurn: 8 }]);
    expect(r2.state.units[2]!.statuses).toEqual([]);

    const r3 = resolveShots(r2.state, [], G, CFG, 1);
    expect(r3.result.zones[0]).toMatchObject({ turnsLeft: 1, active: true });
    const r4 = resolveShots(r3.state, [], G, CFG, 1);
    expect(r4.result.zones).toEqual([]); // hết hạn bị gỡ
    expect(r4.result.poisonTicks).toHaveLength(1); // lượt cuối vẫn gây độc
    const r5 = resolveShots(r4.state, [], G, CFG, 1);
    expect(r5.result.poisonTicks).toHaveLength(1); // độc còn 1 lượt
    expect(hp(r5.state, 2)).toBe(hp1 - 8 * 4);
    const r6 = resolveShots(r5.state, [], G, CFG, 1);
    expect(r6.result.poisonTicks).toEqual([]);
    expect(r6.state.units[1]!.statuses).toEqual([]);
  });

  it("rời vũng trước cuối lượt kế tiếp thì không bị độc", () => {
    const r1 = resolveShots(start(), [cmd(1, "nd")], G, CFG, 1);
    const moved = applyMoves(r1.state, [{ unitId: 2, col: 24 }], CFG).state;
    const r2 = resolveShots(moved, [], G, CFG, 1);
    expect(r2.result.poisonTicks).toEqual([]);
    expect(r2.state.units[1]!.statuses).toEqual([]);
  });

  it("hai vũng chồng nhau: giữ độc mạnh hơn (cùng lượt thì nhiều lượt hơn / sát thương lớn hơn), bị chặn poisonMaxTurns", () => {
    const base = mkState([P(1, 5), M(2, 19)]);
    const z = (id: number, dpt: number, turns: number): Zone => ({
      id,
      ownerUnitId: 1,
      team: 0,
      x: 19.5,
      y: 19.25,
      radius: 2,
      turnsLeft: 2,
      active: true,
      poison: { turns, damagePerTurn: dpt },
    });
    const s = { ...base, zones: [z(1, 5, 5), z(2, 8, 2)], nextZoneId: 3 };
    const r = resolveShots(s, [], G, CFG, 1);
    expect(r.result.poisonTicks).toHaveLength(1);
    expect(r.result.poisonTicks[0]!.amount).toBe(8); // cùng 2 lượt sau khi chặn: lấy sát thương lớn hơn
    expect(r.state.zones.map((x) => x.turnsLeft)).toEqual([1, 1]);
  });

  it("poison thắng không bị nhầm với cháy: cả hai cùng tick", () => {
    const base = mkState([P(1, 5), M(2, 19, { statuses: [{ type: "burn", turns: 2, damagePerTurn: 5 }] })]);
    const z: Zone = { id: 1, ownerUnitId: 1, team: 0, x: 19.5, y: 19.25, radius: 2, turnsLeft: 2, active: true, poison: { turns: 2, damagePerTurn: 8 } };
    const r = resolveShots({ ...base, zones: [z], nextZoneId: 2 }, [], G, CFG, 1);
    expect(hp(r.state, 2)).toBe(100 - 5 - 8);
    expect(r.result.burnTicks).toHaveLength(1);
    expect(r.result.poisonTicks).toHaveLength(1);
  });
});
