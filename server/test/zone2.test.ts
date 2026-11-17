/** Vùng săn 2 (docs/09): quái biết đi, nhiều loại quái, cổng khóa cấp, match_start mở rộng. */
import { describe, expect, it } from "vitest";
import { applyMoves, chooseMonsterMove, monsterMoveRng } from "../src/battle/engine.js";
import type { Character, ServerMessage } from "../src/protocol.js";
import { Match } from "../src/match.js";
import { World, type MonsterEntity, type PlayerEntity } from "../src/world.js";
import { CFG, GUNS, flatMap, mkState, unit } from "./battle/helpers.js";
import { ManualClock, testData } from "./util.js";

const mover = (id: number, col: number, range = 3) => unit(id, col, 1, { moveRangeTiles: range });

describe("chooseMonsterMove", () => {
  it("null khi tầm 0, choáng, không còn địch hoặc không phải quái", () => {
    const rng = () => 0.5;
    const s0 = mkState([unit(1, 10, 0), mover(2, 30, 0)]);
    expect(chooseMonsterMove(s0, 2, GUNS, CFG, rng)).toBeNull();
    const s1 = mkState([unit(1, 10, 0), mover(2, 30, 3)]);
    s1.units[1]!.statuses = [{ type: "stun", turns: 1 }];
    expect(chooseMonsterMove(s1, 2, GUNS, CFG, rng)).toBeNull();
    const s2 = mkState([unit(1, 10, 0, { hp: 0 }), mover(2, 30, 3)]);
    s2.units[0]!.alive = false;
    expect(chooseMonsterMove(s2, 2, GUNS, CFG, rng)).toBeNull();
    expect(chooseMonsterMove(mkState([unit(1, 10, 0), mover(2, 30, 3)]), 1, GUNS, CFG, rng)).toBeNull();
  });

  it("hòa về điểm chạm thì chọn cột xa người chơi hơn (trong tầm)", () => {
    // phẳng, cách 10 ô: mọi cột trong tầm đều bắn trúng thẳng
    const right = mkState([unit(1, 20, 0), mover(2, 30, 3)]);
    expect(chooseMonsterMove(right, 2, GUNS, CFG, () => 0.3)).toEqual({ unitId: 2, col: 33 });
    const left = mkState([unit(1, 40, 0), mover(2, 30, 3)]);
    expect(chooseMonsterMove(left, 2, GUNS, CFG, () => 0.3)).toEqual({ unitId: 2, col: 27 });
  });

  it("kẹp theo bản đồ và tất định theo rng", () => {
    const edge = mkState([unit(1, 40, 0), mover(2, 58, 3)]);
    const a = chooseMonsterMove(edge, 2, GUNS, CFG, monsterMoveRng(99));
    expect(a).toEqual({ unitId: 2, col: 59 });
    expect(chooseMonsterMove(edge, 2, GUNS, CFG, monsterMoveRng(99))).toEqual(a);
  });

  it("không sửa trạng thái đầu vào", () => {
    const s = mkState([unit(1, 20, 0), mover(2, 30, 3)]);
    const before = JSON.stringify(s);
    chooseMonsterMove(s, 2, GUNS, CFG, () => 0.5);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("applyMoves cho quái", () => {
  it("dùng moveRangeTiles riêng của quái; chậm giảm tầm, choáng chặn đi", () => {
    const base = mkState([unit(1, 5, 0), mover(2, 30, 3)]);
    const go = applyMoves(base, [{ unitId: 2, col: 50 }], CFG).moves[0]!;
    expect(go.col).toBe(33);
    const slow = mkState([unit(1, 5, 0), mover(2, 30, 3)]);
    slow.units[1]!.statuses = [{ type: "slow", turns: 1, tiles: 2 }];
    expect(applyMoves(slow, [{ unitId: 2, col: 50 }], CFG).moves[0]!.col).toBe(31);
    const stun = mkState([unit(1, 5, 0), mover(2, 30, 3)]);
    stun.units[1]!.statuses = [{ type: "stun", turns: 1 }];
    expect(applyMoves(stun, [{ unitId: 2, col: 50 }], CFG).moves[0]!.col).toBe(30);
  });
});

// ---------- thế giới ----------

function worldSetup() {
  const data = testData();
  const transfers: Array<{ id: number; to: string }> = [];
  const locked: Array<{ id: number; levelRequired: number }> = [];
  const contacts: Array<{ monster: MonsterEntity; mapId: string }> = [];
  const world = new World({
    data,
    events: {
      onTransfer: (p, to) => transfers.push({ id: p.id, to }),
      onContact: (_p: PlayerEntity, monster, mapId) => contacts.push({ monster, mapId }),
      onPortalLocked: (p, levelRequired) => locked.push({ id: p.id, levelRequired }),
    },
  });
  const portal = data.worldMaps["thanh"]!.portals.find((p) => p.toMapId === "vung_san_2")!;
  return { data, world, transfers, locked, contacts, portal };
}

describe("World: nhiều loại quái", () => {
  it("mỗi điểm sinh dùng đúng loại quái của nó", () => {
    const { world, data } = worldSetup();
    const ms = world.monstersIn("vung_san_2");
    const want: Record<string, number> = {};
    for (const sp of data.worldMaps["vung_san_2"]!.monsterSpawns) want[sp.monsterId] = (want[sp.monsterId] ?? 0) + sp.count;
    const got: Record<string, number> = {};
    for (const m of ms) got[m.monsterId] = (got[m.monsterId] ?? 0) + 1;
    expect(got).toEqual(want);
    expect(Object.keys(want).sort()).toEqual(["am_thach_gai", "am_thach_lon"]);
  });

  it("chạm quái loại nào báo đúng loại đó, và hồi sinh đúng loại", () => {
    const { world, contacts, data } = worldSetup();
    const p = world.addPlayer("bob", "Bob", "vung_san_2", 20.5, 27.5);
    const lon = world.monstersIn("vung_san_2").find((m) => m.monsterId === "am_thach_lon")!;
    world.teleport(lon.id, p.x + 0.3, p.y);
    world.step(0.0001);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.monster.monsterId).toBe("am_thach_lon");
    const count = (id: string) => world.monstersIn("vung_san_2").filter((m) => m.monsterId === id).length;
    expect(count("am_thach_lon")).toBe(1);
    world.step(data.settings.monsterRespawnSeconds + 0.1);
    expect(count("am_thach_lon")).toBe(2);
    expect(count("am_thach_gai")).toBe(4);
  });
});

describe("World: cổng khóa cấp", () => {
  it("cấp thấp: không chuyển bản đồ, portal_locked tối đa một lần mỗi portalLockedNoticeSeconds", () => {
    const { world, transfers, locked, portal, data } = worldSetup();
    expect(portal.levelRequired).toBe(2);
    const p = world.addPlayer("bob", "Bob", "thanh", portal.x + 0.5, portal.y + 0.5);
    world.setProfile(p.id, "xu_nu", 1);
    const gap = data.settings.portalLockedNoticeSeconds;
    for (let i = 0; i < 10; i++) world.step(0.1);
    expect(transfers).toEqual([]);
    expect(p.mapId).toBe("thanh");
    expect(locked).toEqual([{ id: p.id, levelRequired: 2 }]);
    for (let t = 1; t < gap - 0.05; t += 0.1) world.step(0.1);
    expect(locked).toHaveLength(1);
    world.step(0.5);
    expect(locked).toHaveLength(2);
  });

  it("đủ cấp thì qua cổng", () => {
    const { world, transfers, locked, portal } = worldSetup();
    const p = world.addPlayer("bob", "Bob", "thanh", portal.x + 0.5, portal.y + 0.5);
    world.setProfile(p.id, "xu_nu", 2);
    world.step(0.1);
    expect(locked).toEqual([]);
    expect(transfers).toEqual([{ id: p.id, to: "vung_san_2" }]);
    expect(p).toMatchObject({ mapId: "vung_san_2", x: portal.toSpawn.x, y: portal.toSpawn.y });
  });
});

// ---------- trận ----------

function matchHarness(monsterId: string, turnSeed = 777) {
  const data = testData();
  const clock = new ManualClock();
  const sent: any[] = [];
  const match = new Match({
    id: "z2",
    data,
    clock,
    seed: () => turnSeed,
    player: {
      name: "Bob",
      sign: "xu_nu",
      gunId: data.character.commonGunIds[0]!,
      send: (m: ServerMessage) => void sent.push(m),
      isConnected: () => true,
    },
    monster: data.monsters[monsterId]!,
    settle: async () => ({ character: { name: "Bob", sign: "xu_nu", level: 1, exp: 0, gunId: "g", ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"], pvp: { wins: 0, losses: 0, draws: 0 } } as Character, drops: [] }),
    onDone: () => {},
  });
  return { data, match, sent, of: (t: string) => sent.filter((m) => m.type === t) };
}

describe("Match: match_start mang battleMapId và monsterId", () => {
  it("quái vùng 2: bản đồ hem_van_thach_1, mỗi quái có monsterId, người chơi thì không", () => {
    const h = matchHarness("am_thach_gai");
    h.match.start();
    const start = h.of("match_start")[0];
    expect(start.battleMapId).toBe("hem_van_thach_1");
    const monsters = start.units.filter((u: any) => u.kind === "monster");
    expect(monsters).toHaveLength(2);
    for (const m of monsters) expect(m.monsterId).toBe("am_thach_gai");
    const me = start.units.find((u: any) => u.kind === "player");
    expect("monsterId" in me).toBe(false);
  });

  it("vùng 1 cũng có battleMapId; PvP dùng bản đồ đấu trường và không có monsterId", () => {
    const h = matchHarness("am_thach_nho");
    h.match.start();
    const start = h.of("match_start")[0];
    expect(start.battleMapId).toBe("dong_am_thach_1");
    for (const u of start.units.filter((x: any) => x.kind === "monster")) expect(u.monsterId).toBe("am_thach_nho");
  });
});

describe("Match: quái di chuyển trong pha move", () => {
  it("quái có moveRangeTiles đi cùng người chơi, trong tầm; quái đứng yên thì không có lệnh", () => {
    const h = matchHarness("am_thach_gai");
    h.match.start();
    h.match.handleMove(6);
    const mr = h.of("moves_result")[0];
    const start = h.of("match_start")[0];
    const monsters = start.units.filter((u: any) => u.kind === "monster");
    expect(mr.moves.map((m: any) => m.unitId).sort()).toEqual([start.you, ...monsters.map((m: any) => m.id)].sort());
    for (const mon of monsters) {
      const mv = mr.moves.find((m: any) => m.unitId === mon.id);
      expect(mv.path.length).toBeLessThanOrEqual(3);
      expect(Math.abs(mv.col - mon.col)).toBeLessThanOrEqual(3);
    }
    expect(mr.moves.some((m: any) => m.unitId !== start.you && m.path.length > 0)).toBe(true);

    const still = matchHarness("am_thach_lon");
    still.match.start();
    still.match.handleMove(6);
    expect(still.of("moves_result")[0].moves).toHaveLength(1);
  });

  it("tất định theo seed của lượt", () => {
    const run = (seed: number) => {
      const h = matchHarness("am_thach_gai", seed);
      h.match.start();
      h.match.handleMove(6);
      return h.of("moves_result")[0].moves;
    };
    expect(run(5)).toEqual(run(5));
  });
});
