import { describe, expect, it } from "vitest";
import { applyMoves, previewShot, resolveShots, validateShot } from "../../src/battle/engine.js";
import type { GunStats, Passive, ShotCommand, Status } from "../../src/battle/types.js";
import { CFG, flatMap, mkState, unit } from "./helpers.js";

/** Bắn 45 độ / lực 50 từ cột 5 rơi quanh x ~ 19.5 (xem engine.test.ts). */
const cmd = (unitId: number, gunId: string, over: Partial<ShotCommand> = {}): ShotCommand => ({
  unitId,
  angle: 45,
  power: 50,
  facing: 1,
  gunId,
  aimElapsedSeconds: 0,
  ...over,
});
const left = (unitId: number, gunId: string, over: Partial<ShotCommand> = {}): ShotCommand =>
  cmd(unitId, gunId, { facing: -1, ...over });

const gun = (id: string, over: Partial<GunStats> = {}): GunStats => ({
  id,
  sign: null,
  kind: "projectile",
  damage: 35,
  blastRadiusTiles: 2,
  energyCost: 0,
  cooldownTurns: 0,
  ...over,
});
const gunsOf = (...gs: GunStats[]): Record<string, GunStats> => Object.fromEntries(gs.map((g) => [g.id, g]));

const P = (id: number, col: number, extra: Parameters<typeof unit>[3] = {}) => unit(id, col, 0, extra);
const M = (id: number, col: number, extra: Parameters<typeof unit>[3] = {}) => unit(id, col, 1, { aiErrorTiles: 0, ...extra });

const earlyShot: Passive = { type: "earlyShot", earlyShotSeconds: 10, earlyShotDamageBonus: 0.15, lineBonus: 0.1 };
const toughness: Passive = { type: "toughness", damageTakenReduction: 0.15, lineBonus: 0.05 };
const precision: Passive = { type: "precision", deviationReduction: 0.3, lineBonus: 0.1, aimPreviewFraction: 0.4, aimPreviewPerSecond: 5 };
const meteorPush: Passive = { type: "meteorPush", digBelowOnHit: 1, lineBonusStones: 1, lineBonus: 0.1 };

describe("validateShot", () => {
  const g = gunsOf(gun("a", { energyCost: 2, cooldownTurns: 1 }), gun("b"));
  const s = mkState([P(1, 5, { guns: ["a"], energy: 2 }), M(2, 30, { guns: ["b"], gunId: "b" })]);
  it("ok khi súng trong bộ, đủ nội lực, hết hồi", () => {
    expect(validateShot(s, cmd(1, "a"), g)).toBe("ok");
  });
  it("súng ngoài bộ hoặc không tồn tại", () => {
    expect(validateShot(s, cmd(1, "b"), g)).toBe("not_allowed");
    expect(validateShot(s, cmd(1, "zzz"), g)).toBe("not_allowed");
  });
  it("thiếu nội lực", () => {
    const poor = mkState([P(1, 5, { guns: ["a"], energy: 1 })]);
    expect(validateShot(poor, cmd(1, "a"), g)).toBe("not_allowed");
  });
  it("còn hồi chiêu", () => {
    const cd = mkState([P(1, 5, { guns: ["a"], energy: 5, cooldowns: { a: 1 } })]);
    expect(validateShot(cd, cmd(1, "a"), g)).toBe("not_allowed");
  });
  it("đơn vị chết hoặc không có", () => {
    const dead = mkState([P(1, 5, { guns: ["a"], energy: 5 })]);
    dead.units[0]!.alive = false;
    expect(validateShot(dead, cmd(1, "a"), g)).toBe("not_allowed");
    expect(validateShot(s, cmd(9, "a"), g)).toBe("not_allowed");
  });
  it("quái không dùng nội lực", () => {
    const costly = gunsOf(gun("b", { energyCost: 9, cooldownTurns: 3 }));
    expect(validateShot(s, cmd(2, "b"), costly)).toBe("ok");
  });
  it("lệnh không hợp lệ bị bỏ qua khi tính lượt", () => {
    const { result } = resolveShots(s, [cmd(1, "b")], g, CFG, 1);
    expect(result.shots).toEqual([]);
  });
});

describe("nội lực và hồi chiêu", () => {
  const g = gunsOf(gun("a", { energyCost: 3, cooldownTurns: 2 }));
  it("trừ chi phí, cộng hồi cuối lượt, đặt hồi chiêu", () => {
    const s = mkState([P(1, 5, { guns: ["a"], energy: 5 })]);
    const r = resolveShots(s, [cmd(1, "a")], g, CFG, 1);
    expect(r.state.units[0]!.energy).toBe(5 - 3 + CFG.energyRegenPerTurn);
    expect(r.state.units[0]!.cooldowns).toEqual({ a: 2 });
    expect(r.result.units[0]).toMatchObject({ id: 1, energy: 4, cooldowns: { a: 2 } });
  });
  it("hồi chiêu giảm mỗi lượt; hết thì dùng lại được", () => {
    let s = mkState([P(1, 5, { guns: ["a"], energy: 9 })]);
    s = resolveShots(s, [cmd(1, "a")], g, CFG, 1).state; // cd 2
    expect(validateShot(s, cmd(1, "a"), g)).toBe("not_allowed");
    s = resolveShots(s, [], g, CFG, 1).state; // cd 1
    expect(s.units[0]!.cooldowns).toEqual({ a: 1 });
    expect(validateShot(s, cmd(1, "a"), g)).toBe("not_allowed");
    s = resolveShots(s, [], g, CFG, 1).state; // hết
    expect(s.units[0]!.cooldowns).toEqual({});
    expect(validateShot(s, cmd(1, "a"), g)).toBe("ok");
  });
  it("cooldownTurns 1: bỏ đúng một lượt", () => {
    const g1 = gunsOf(gun("a", { cooldownTurns: 1 }));
    let s = mkState([P(1, 5, { guns: ["a"] })]);
    s = resolveShots(s, [cmd(1, "a")], g1, CFG, 1).state;
    expect(validateShot(s, cmd(1, "a"), g1)).toBe("not_allowed");
    s = resolveShots(s, [], g1, CFG, 1).state;
    expect(validateShot(s, cmd(1, "a"), g1)).toBe("ok");
  });
  it("nội lực bị chặn trên bởi energyMax; quái không đổi nội lực", () => {
    const s = mkState([P(1, 5, { guns: ["a"], energy: 9 }), M(2, 40)]);
    const r = resolveShots(s, [], g, CFG, 1);
    expect(r.state.units[0]!.energy).toBe(CFG.energyMax);
    expect(r.state.units[1]!.energy).toBe(0);
  });
  it("không sửa đầu vào", () => {
    const s = mkState([P(1, 5, { guns: ["a"], energy: 5 })]);
    resolveShots(s, [cmd(1, "a")], g, CFG, 1);
    expect(s.units[0]!.energy).toBe(5);
    expect(s.units[0]!.cooldowns).toEqual({});
  });
});

describe("burst", () => {
  const burst = gun("br", { kind: "burst", damage: 14, blastRadiusTiles: 1, count: 3, powerOffsets: [-4, 0, 4] });
  it("count viên, parentIndex trỏ về viên gốc, power lệch theo offsets", () => {
    const s = mkState([P(1, 5, { guns: ["br"] })]);
    const { result } = resolveShots(s, [cmd(1, "br")], gunsOf(burst), CFG, 1);
    expect(result.shots.map((x) => x.parentIndex)).toEqual([null, 0, 0]);
    expect(result.shots.every((x) => x.gunId === "br" && x.unitId === 1)).toBe(true);
    const xs = result.shots.map((x) => x.impact!.x);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    expect(result.explosions).toHaveLength(3);
  });
  it("mỗi viên có độ lệch riêng", () => {
    const s = mkState([P(1, 5, { guns: ["br"] })]);
    const cfg = { ...CFG, deviationMaxTiles: 3 };
    const a = resolveShots(s, [cmd(1, "br", { power: 50 })], gunsOf({ ...burst, powerOffsets: [0, 0, 0] }), cfg, 3).result.shots;
    const xs = new Set(a.map((x) => x.impact!.x));
    expect(xs.size).toBe(3);
  });
});

describe("shower", () => {
  const shower = gun("sh", { kind: "shower", sign: "bao_binh", damage: 10, blastRadiusTiles: 1, count: 4, spreadTiles: 3 });
  it("viên dẫn đường không nổ; sao băng rơi thẳng từ mép trên, trải đều quanh điểm chạm", () => {
    const s = mkState([P(1, 5, { guns: ["sh"] })]);
    const { result } = resolveShots(s, [cmd(1, "sh")], gunsOf(shower), CFG, 1);
    expect(result.shots).toHaveLength(5);
    expect(result.shots.map((x) => x.parentIndex)).toEqual([null, 0, 0, 0, 0]);
    expect(result.explosions).toHaveLength(4);
    const cx = result.shots[0]!.impact!.x;
    const stones = result.shots.slice(1);
    stones.forEach((st, i) => {
      expect(st.points[0]![1]).toBe(0);
      expect(st.points[0]![0]).toBeCloseTo(cx - 3 + 2 * i, 1);
      expect(st.impact!.x).toBeCloseTo(cx - 3 + 2 * i, 1);
      // rơi thẳng đứng: mọi điểm cùng x
      for (const p of st.points) expect(p[0]).toBeCloseTo(st.points[0]![0], 1);
      expect(st.flightSeconds).toBeGreaterThan(result.shots[0]!.flightSeconds);
    });
  });
  it("Bảo Bình đúng cung: thêm lineBonusStones viên; sai cung thì không", () => {
    const own = mkState([P(1, 5, { guns: ["sh"], sign: "bao_binh", passive: meteorPush })]);
    expect(resolveShots(own, [cmd(1, "sh")], gunsOf(shower), CFG, 1).result.shots).toHaveLength(1 + 5);
    const other = mkState([P(1, 5, { guns: ["sh"], sign: "kim_nguu", passive: meteorPush })]);
    expect(resolveShots(other, [cmd(1, "sh")], gunsOf(shower), CFG, 1).result.shots).toHaveLength(1 + 4);
  });
  it("viên dẫn đường bay ra ngoài thì không có sao băng", () => {
    const s = mkState([P(1, 20, { guns: ["sh"] })]);
    const { result } = resolveShots(s, [cmd(1, "sh", { power: 100 })], gunsOf(shower), CFG, 1);
    expect(result.shots).toHaveLength(1);
    expect(result.explosions).toEqual([]);
  });
  it("sao băng gây sát thương riêng lên đơn vị bên dưới", () => {
    const s = mkState([P(1, 5, { guns: ["sh"] }), M(2, 20)]);
    const { result } = resolveShots(s, [cmd(1, "sh")], gunsOf(shower), CFG, 1);
    expect(result.damage.length).toBeGreaterThan(0);
    expect(result.damage.every((d) => d.unitId === 2)).toBe(true);
  });
});

describe("self: khiên và ngắm chuẩn", () => {
  const shield = gun("kh", { kind: "self", damage: 0, blastRadiusTiles: 0, energyCost: 3, cooldownTurns: 2, selfEffect: { type: "shield", amount: 40 } });
  const aim = gun("kinh", { kind: "self", damage: 0, blastRadiusTiles: 0, energyCost: 2, cooldownTurns: 2, selfEffect: { type: "trueAim", turns: 1 } });
  const plain = gun("g");

  it("self không sinh đạn, trừ nội lực, đặt hồi chiêu, ghi selfEffects", () => {
    const s = mkState([P(1, 5, { guns: ["kh"], energy: 5 })]);
    const { result, state } = resolveShots(s, [cmd(1, "kh")], gunsOf(shield), CFG, 1);
    expect(result.shots).toEqual([]);
    expect(result.selfEffects).toEqual([{ unitId: 1, sourceUnitId: 1, status: { type: "shield", turns: 1, amount: 40 } }]);
    expect(state.units[0]!.energy).toBe(5 - 3 + 2);
    expect(state.units[0]!.cooldowns).toEqual({ kh: 2 });
  });

  it("khiên áp trước nổ: chặn đạn bay tới ngay trong lượt, còn lại tới hết lượt kế", () => {
    const g = gunsOf(shield, plain);
    const s = mkState([P(1, 19, { guns: ["kh"], energy: 5 }), M(2, 33, { guns: ["g"] })]);
    const base = resolveShots(mkState([P(1, 19), M(2, 33)]), [left(2, "g")], g, CFG, 1).result;
    expect(base.damage[0]).toMatchObject({ unitId: 1, amount: 35 });
    const r = resolveShots(s, [cmd(1, "kh"), left(2, "g")], g, CFG, 1);
    expect(r.result.shieldAbsorbed).toEqual([{ unitId: 1, amount: 35 }]);
    expect(r.result.damage.filter((d) => d.unitId === 1)).toEqual([]);
    expect(r.state.units[0]!.hp).toBe(100);
    expect(r.state.units[0]!.statuses).toEqual([{ type: "shield", turns: 1, amount: 5 }]);
    // lượt kế: khiên (còn 5) vẫn chặn một phần, rồi hết
    const r2 = resolveShots(r.state, [left(2, "g")], g, CFG, 1);
    expect(r2.result.shieldAbsorbed).toEqual([{ unitId: 1, amount: 5 }]);
    expect(r2.result.damage.find((d) => d.unitId === 1)!.amount).toBe(30);
    expect(r2.state.units[0]!.statuses).toEqual([]);
  });

  it("khiên hết hạn sau lượt kế dù chưa bị phá", () => {
    const g = gunsOf(shield);
    let s = mkState([P(1, 5, { guns: ["kh"], energy: 5 })]);
    s = resolveShots(s, [cmd(1, "kh")], g, CFG, 1).state;
    expect(s.units[0]!.statuses).toHaveLength(1);
    s = resolveShots(s, [], g, CFG, 1).state;
    expect(s.units[0]!.statuses).toEqual([]);
  });

  it("Ngắm chuẩn: lượt kế phát bắn không lệch, rồi hết", () => {
    const cfg = { ...CFG, deviationMaxTiles: 3 };
    const g = gunsOf(aim, plain);
    let s = mkState([P(1, 5, { guns: ["kinh", "g"], energy: 5 })]);
    const r1 = resolveShots(s, [cmd(1, "kinh")], g, cfg, 1);
    expect(r1.result.selfEffects[0]!.status).toEqual({ type: "trueAim", turns: 1 });
    s = r1.state;
    expect(s.units[0]!.statuses).toEqual([{ type: "trueAim", turns: 1 }]);
    const xs = [1, 2, 3, 4, 5].map((seed) => resolveShots(s, [cmd(1, "g")], g, cfg, seed).result.shots[0]!.impact!.x);
    expect(new Set(xs).size).toBe(1);
    const exact = resolveShots(s, [cmd(1, "g")], g, CFG, 1).result.shots[0]!.impact!.x;
    expect(xs[0]).toBeCloseTo(exact, 6);
    const after = resolveShots(s, [cmd(1, "g")], g, cfg, 1).state;
    expect(after.units[0]!.statuses).toEqual([]);
    // sau khi hết thì lệch trở lại
    const ys = [1, 2, 3].map((seed) => resolveShots(after, [cmd(1, "g")], g, cfg, seed).result.shots[0]!.impact!.x);
    expect(new Set(ys).size).toBeGreaterThan(1);
  });
});

describe("hiệu ứng khi trúng", () => {
  const burnGun = (id: string, dpt: number, turns = 2) => gun(id, { burn: { turns, damagePerTurn: dpt } });

  it("cháy: trừ máu cuối lượt, hai lượt rồi hết", () => {
    const g = gunsOf(burnGun("b", 8));
    let s = mkState([P(1, 5, { guns: ["b"] }), M(2, 19)]);
    const r1 = resolveShots(s, [cmd(1, "b")], g, CFG, 1);
    expect(r1.result.damage[0]).toMatchObject({ unitId: 2, amount: 35, hpAfter: 65 });
    expect(r1.result.statusEvents).toEqual([{ unitId: 2, sourceUnitId: 1, status: { type: "burn", turns: 2, damagePerTurn: 8 } }]);
    expect(r1.result.burnTicks).toEqual([{ unitId: 2, sourceUnitId: 0, amount: 8, hpAfter: 57 }]);
    expect(r1.state.units[1]!.statuses).toEqual([{ type: "burn", turns: 1, damagePerTurn: 8 }]);
    s = r1.state;
    const r2 = resolveShots(s, [], g, CFG, 1);
    expect(r2.result.burnTicks).toEqual([{ unitId: 2, sourceUnitId: 0, amount: 8, hpAfter: 49 }]);
    expect(r2.state.units[1]!.statuses).toEqual([]);
    const r3 = resolveShots(r2.state, [], g, CFG, 1);
    expect(r3.result.burnTicks).toEqual([]);
    expect(r3.state.units[1]!.hp).toBe(49);
  });

  it("thời lượng bị kẹp theo giá trị tối đa trong dữ liệu", () => {
    const g = gunsOf(
      gun("x", { burn: { turns: 5, damagePerTurn: 1 }, slow: { turns: 4, tiles: 1 }, stun: { turns: 3 } }),
    );
    const s = mkState([P(1, 5, { guns: ["x"] }), M(2, 19)]);
    const { result } = resolveShots(s, [cmd(1, "x")], g, CFG, 1);
    const byType = Object.fromEntries(result.statusEvents.map((e) => [e.status.type, e.status.turns]));
    expect(byType).toEqual({ burn: CFG.burnMaxTurns, slow: CFG.slowMaxTurns, stun: CFG.stunMaxTurns });
  });

  it("hai nguồn cùng hiệu ứng trong một lượt: giữ cái mạnh hơn (trị số, rồi số lượt)", () => {
    for (const [a, b] of [
      [5, 8],
      [8, 5],
    ] as const) {
      const g = gunsOf(burnGun("b1", a), burnGun("b2", b));
      const s = mkState([P(1, 5, { guns: ["b1"] }), P(2, 33, { guns: ["b2"] }), M(3, 19)]);
      const { result, state } = resolveShots(s, [cmd(1, "b1"), left(2, "b2")], g, CFG, 1);
      expect(result.statusEvents.filter((e) => e.unitId === 3).length).toBe(2);
      expect(state.units[2]!.statuses).toEqual([{ type: "burn", turns: 1, damagePerTurn: 8 }]);
    }
    // nhiều lượt hơn thắng trị số lớn hơn
    const g = gunsOf(burnGun("b1", 20, 1), burnGun("b2", 3, 2));
    const s = mkState([P(1, 5, { guns: ["b1"] }), P(2, 33, { guns: ["b2"] }), M(3, 19)]);
    const { state } = resolveShots(s, [cmd(1, "b1"), left(2, "b2")], g, CFG, 1);
    expect(state.units[2]!.statuses).toEqual([{ type: "burn", turns: 1, damagePerTurn: 3 }]);
  });

  it("hiệu ứng mới thay hiệu ứng cũ từ lượt trước dù yếu hơn", () => {
    const g = gunsOf(gun("w", { slow: { turns: 1, tiles: 1 } }));
    const old: Status = { type: "slow", turns: 1, tiles: 4 };
    const s = mkState([P(1, 5, { guns: ["w"] }), M(2, 19, { statuses: [old] })]);
    const { state } = resolveShots(s, [cmd(1, "w")], g, CFG, 1);
    expect(state.units[1]!.statuses).toEqual([{ type: "slow", turns: 1, tiles: 1 }]);
  });

  it("choáng và chậm tác động pha di chuyển kế tiếp rồi hết", () => {
    const g = gunsOf(gun("s", { slow: { turns: 1, tiles: 2 }, stun: { turns: 1 } }), gun("sl", { slow: { turns: 1, tiles: 2 } }));
    const s = mkState([P(1, 5, { guns: ["s"] }), P(2, 33, { guns: ["sl"] }), M(3, 19)]);
    // chỉ trúng quái với súng choáng; người chơi 2 chỉ bị chậm bằng cách đặt thẳng trạng thái
    const r = resolveShots(s, [cmd(1, "s")], g, CFG, 1);
    const mon = r.state.units[2]!;
    expect(mon.statuses.map((x) => x.type).sort()).toEqual(["slow", "stun"]);
    const stunned = applyMoves(r.state, [{ unitId: 3, col: 10 }], CFG);
    expect(stunned.moves[0]!.path).toEqual([]);

    const slowed = mkState([P(1, 5, { statuses: [{ type: "slow", turns: 1, tiles: 2 }] })]);
    expect(applyMoves(slowed, [{ unitId: 1, col: 30 }], CFG).moves[0]!.path).toHaveLength(CFG.moveRangeTiles - 2);
    const crawl = mkState([P(1, 5, { statuses: [{ type: "slow", turns: 1, tiles: 99 }] })]);
    expect(applyMoves(crawl, [{ unitId: 1, col: 30 }], CFG).moves[0]!.path).toEqual([]); // tối thiểu 0

    const next = resolveShots(r.state, [], g, CFG, 1).state;
    expect(next.units[2]!.statuses).toEqual([]);
    expect(applyMoves(next, [{ unitId: 3, col: 10 }], CFG).moves[0]!.path.length).toBeGreaterThan(0);
  });

  it("hiệu ứng không áp lên đơn vị không nhận sát thương", () => {
    const g = gunsOf(burnGun("b", 8));
    const s = mkState([P(1, 5, { guns: ["b"] }), M(2, 40)]);
    const { result } = resolveShots(s, [cmd(1, "b")], g, CFG, 1);
    expect(result.statusEvents).toEqual([]);
    expect(result.burnTicks).toEqual([]);
  });
});

describe("đẩy lùi và rơi", () => {
  const kb = gun("kb", { blastRadiusTiles: 3.5, knockbackTiles: 1 });
  const g = gunsOf(kb);
  it("đẩy 1 cột ra xa tâm nổ", () => {
    const s = mkState([P(1, 5, { guns: ["kb"] }), M(2, 22)]);
    const { result, state } = resolveShots(s, [cmd(1, "kb")], g, CFG, 1);
    expect(result.damage.some((d) => d.unitId === 2)).toBe(true);
    expect(result.knockbacks).toEqual([{ unitId: 2, fromCol: 22, toCol: 23 }]);
    expect(state.units[1]!.col).toBe(23);
  });
  it("đẩy về phía trái nếu đứng bên trái tâm nổ", () => {
    const s = mkState([P(1, 5, { guns: ["kb"] }), M(2, 17)]);
    const { result } = resolveShots(s, [cmd(1, "kb")], g, CFG, 1);
    const kbe = result.knockbacks.find((k) => k.unitId === 2);
    expect(kbe).toMatchObject({ fromCol: 17, toCol: 16 });
  });
  it("bị tường cao hơn maxClimbTiles chặn", () => {
    const map = flatMap();
    for (const r of [18, 19]) map.rows[r] = map.rows[r]!.slice(0, 23) + "#" + map.rows[r]!.slice(24);
    const s = mkState([P(1, 5, { guns: ["kb"] }), M(2, 22)], map);
    const { result, state } = resolveShots(s, [cmd(1, "kb")], g, CFG, 1);
    expect(result.knockbacks).toEqual([]);
    expect(state.units[1]!.col).toBe(22);
  });
  it("tường cao đúng maxClimbTiles thì leo qua", () => {
    const map = flatMap();
    map.rows[19] = map.rows[19]!.slice(0, 23) + "#" + map.rows[19]!.slice(24);
    const s = mkState([P(1, 5, { guns: ["kb"] }), M(2, 22)], map);
    const { state } = resolveShots(s, [cmd(1, "kb")], g, CFG, 1);
    expect(state.units[1]!.col).toBe(23);
    expect(state.units[1]!.y).toBe(19);
  });
  it("đẩy xuống hố thì rơi", () => {
    const map = flatMap();
    for (let r = 20; r < 25; r++) map.rows[r] = map.rows[r]!.slice(0, 23) + "." + map.rows[r]!.slice(24);
    const s = mkState([P(1, 5, { guns: ["kb"] }), M(2, 22)], map);
    const { result, state } = resolveShots(s, [cmd(1, "kb")], g, CFG, 1);
    expect(state.units[1]!.col).toBe(23);
    expect(state.units[1]!.y).toBe(25);
    expect(result.falls).toContainEqual({ unitId: 2, y: 25 });
  });
});

describe("craterDepthTiles", () => {
  it("hố sâu thêm theo chiều dọc, không đổi sát thương", () => {
    const flat = gunsOf(gun("m", { blastRadiusTiles: 2 }));
    const deep = gunsOf(gun("m", { blastRadiusTiles: 2, craterDepthTiles: 2 }));
    const s = mkState([P(1, 5, { guns: ["m"] })]);
    const a = resolveShots(s, [cmd(1, "m")], flat, CFG, 1).result.explosions[0]!;
    const b = resolveShots(s, [cmd(1, "m")], deep, CFG, 1).result.explosions[0]!;
    const maxRow = (e: typeof a) => Math.max(...e.removedTiles.map(([, r]) => r));
    const minRow = (e: typeof a) => Math.min(...e.removedTiles.map(([, r]) => r));
    expect(maxRow(b)).toBe(maxRow(a) + 2);
    expect(minRow(b)).toBe(minRow(a));
    expect(b.removedTiles.length).toBeGreaterThan(a.removedTiles.length);
  });
});

describe("nội tại", () => {
  const sign = (id: GunStats["sign"], over: Partial<GunStats> = {}) => gun("s", { sign: id, ...over });

  it("Bạch Dương: bắn sớm +bonus, đúng cung cộng thêm lineBonus, quá giờ thì không", () => {
    const mk = (g: GunStats, t: number) => {
      const s = mkState([P(1, 5, { guns: ["s"], sign: "bach_duong", passive: earlyShot }), M(2, 19)]);
      return resolveShots(s, [cmd(1, "s", { aimElapsedSeconds: t })], gunsOf(g), CFG, 1).result.damage[0]!.amount;
    };
    expect(mk(sign("bach_duong"), 3)).toBe(Math.round(35 * 1.25));
    expect(mk(sign("bach_duong"), 10)).toBe(Math.round(35 * 1.25));
    expect(mk(sign("bach_duong"), 10.5)).toBe(35);
    expect(mk(sign(null), 3)).toBe(Math.round(35 * 1.15)); // súng chung: không có dòng riêng
    expect(mk(sign("kim_nguu"), 3)).toBe(Math.round(35 * 1.15)); // khác cung
  });

  it("Kim Ngưu: giảm sát thương nhận, thêm lineBonus nếu lượt đó bắn súng đúng cung", () => {
    const run = (shooterGun: string | null, own: GunStats | null) => {
      const guns = gunsOf(gun("e"), ...(own ? [own] : []));
      const tough = P(2, 19, { guns: own ? ["s"] : [], sign: "kim_nguu", passive: toughness });
      const s = mkState([M(1, 33, { guns: ["e"], gunId: "e" }), tough]);
      const cmds = [left(1, "e")];
      if (shooterGun && own) cmds.push(cmd(2, shooterGun, { facing: -1, angle: 10, power: 100 })); // bắn ra xa, không ảnh hưởng ai
      return resolveShots(s, cmds, guns, CFG, 1).result.damage.find((d) => d.unitId === 2)!.amount;
    };
    expect(run(null, null)).toBe(Math.round(35 * 0.85));
    expect(run("s", sign("kim_nguu"))).toBe(Math.round(35 * 0.8));
    expect(run("s", sign(null))).toBe(Math.round(35 * 0.85)); // súng chung không tính dòng riêng
    expect(run("s", sign("bao_binh"))).toBe(Math.round(35 * 0.85));
  });

  it("Xử Nữ: độ lệch × (1 − deviationReduction) × (1 − lineBonus nếu đúng cung)", () => {
    const cfg = { ...CFG, deviationMaxTiles: 3 };
    const x = (passive: Passive | null, g: GunStats, seed = 7) => {
      const s = mkState([P(1, 5, { guns: ["s"], sign: "xu_nu", passive })]);
      return resolveShots(s, [cmd(1, "s")], gunsOf(g), cfg, seed).result.shots[0]!.impact!.x;
    };
    const exact = resolveShots(mkState([P(1, 5, { guns: ["s"] })]), [cmd(1, "s")], gunsOf(sign(null)), CFG, 1).result.shots[0]!.impact!.x;
    const plain = x(null, sign(null)) - exact;
    expect(Math.abs(plain)).toBeGreaterThan(0.3);
    expect((x(precision, sign(null)) - exact) / plain).toBeCloseTo(0.7, 1);
    expect((x(precision, sign("xu_nu")) - exact) / plain).toBeCloseTo(0.7 * 0.9, 1);
    expect((x(precision, sign("kim_nguu")) - exact) / plain).toBeCloseTo(0.7, 1);
  });

  it("Bảo Bình: đạn trúng đơn vị đào thêm ô ngay dưới chân; chỉ với nội tại meteorPush", () => {
    const run = (passive: Passive | null) => {
      const s = mkState([P(1, 5, { guns: ["s"], sign: "bao_binh", passive }), M(2, 19)]);
      return resolveShots(s, [cmd(1, "s")], gunsOf(sign("bao_binh", { blastRadiusTiles: 0.5 })), CFG, 1);
    };
    const withPush = run(meteorPush);
    const ex = withPush.result.explosions[0]!;
    expect(withPush.result.shots[0]!.hitUnitId).toBe(2);
    expect(ex.removedTiles).toContainEqual([19, 20]);
    expect(withPush.state.units[1]!.y).toBeGreaterThan(20);
    const without = run(null);
    expect(without.result.explosions[0]!.removedTiles).not.toContainEqual([19, 20]);
  });

  it("Bảo Bình: đạn thường đúng cung +lineBonus sát thương, sai cung thì không", () => {
    const run = (gs: GunStats["sign"]) => {
      const s = mkState([P(1, 5, { guns: ["s"], sign: "bao_binh", passive: meteorPush }), M(2, 19)]);
      return resolveShots(s, [cmd(1, "s")], gunsOf(sign(gs, { damage: 40 })), CFG, 1).result.damage[0]!.amount;
    };
    expect(run("bao_binh")).toBe(44);
    expect(run(null)).toBe(40);
  });
});

describe("previewShot", () => {
  it("là phần đầu quỹ đạo không lệch, theo fraction", () => {
    const cfg = { ...CFG, deviationMaxTiles: 3 };
    const s = mkState([P(1, 5, { guns: ["g"] })]);
    const g = gunsOf(gun("g"));
    const full = resolveShots(s, [cmd(1, "g")], g, CFG, 1).result.shots[0]!.points;
    const pv = previewShot(s, cmd(1, "g"), g, cfg, 0.4);
    expect(pv.length).toBeGreaterThan(2);
    expect(pv.length).toBeLessThan(full.length);
    expect(pv).toEqual(full.slice(0, pv.length));
    expect(Math.abs(pv.length / full.length - 0.4)).toBeLessThan(0.1);
    expect(previewShot(s, cmd(1, "g"), g, cfg, 1)).toEqual(full);
  });
});

describe("tính tất định và ảnh chụp", () => {
  it("cùng seed, cùng kết quả với súng đa viên", () => {
    const g = gunsOf(
      gun("br", { kind: "burst", count: 3, powerOffsets: [-4, 0, 4], damage: 14 }),
      gun("sh", { kind: "shower", count: 4, spreadTiles: 3, damage: 10, blastRadiusTiles: 1 }),
    );
    const cfg = { ...CFG, deviationMaxTiles: 3, critChance: 0.3 };
    const s = mkState([P(1, 5, { guns: ["br"] }), P(2, 33, { guns: ["sh"] }), M(3, 19)]);
    const run = () => resolveShots(s, [cmd(1, "br"), left(2, "sh")], g, cfg, 99);
    expect(run().result).toEqual(run().result);
    expect(run().state).toEqual(run().state);
  });
  it("TurnResult.units chụp hp, nội lực, hồi chiêu, trạng thái của mọi đơn vị", () => {
    const g = gunsOf(gun("a", { energyCost: 1, cooldownTurns: 1, burn: { turns: 2, damagePerTurn: 4 } }));
    const s = mkState([P(1, 5, { guns: ["a"], energy: 3 }), M(2, 19)]);
    const { result } = resolveShots(s, [cmd(1, "a")], g, CFG, 1);
    expect(result.units).toEqual([
      { id: 1, hp: 100, energy: 4, cooldowns: { a: 1 }, statuses: [] },
      { id: 2, hp: 61, energy: 0, cooldowns: {}, statuses: [{ type: "burn", turns: 1, damagePerTurn: 4 }] },
    ]);
  });
});
