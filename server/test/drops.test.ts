import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/battle/engine.js";
import type { GameData } from "../src/data.js";
import { Match, type MatchResult } from "../src/match.js";
import type { Character } from "../src/protocol.js";
import { ManualClock, flush, testData } from "./util.js";

function winData(tweak: (d: GameData) => void = () => {}): GameData {
  const d = testData();
  d.monsters["am_thach_nho"]!.hp = 1;
  d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [10, 12];
  d.battle.deviationMaxTiles = 0;
  d.battle.critChance = 0;
  d.character.baseHp = 1000;
  tweak(d);
  return d;
}

async function play(data: GameData, opts: { random?: () => number; loadout?: string[]; shotPower?: number }) {
  const clock = new ManualClock();
  const sent: any[] = [];
  const calls: { result: MatchResult; exp: number; rolled: string[] }[] = [];
  let done = false;
  const match = new Match({
    id: "m",
    data,
    clock,
    seed: () => 12345,
    dropRandom: opts.random,
    player: {
      name: "Bob",
      sign: "xu_nu",
      gunId: "thuoc_no_nho",
      loadout: opts.loadout,
      send: (m) => void sent.push(m),
      isConnected: () => true,
    },
    monster: data.monsters["am_thach_nho"]!,
    settle: async (result, exp, rolled) => {
      calls.push({ result, exp, rolled });
      const c: Character = { name: "Bob", sign: "xu_nu", level: 1, exp, gunId: "thuoc_no_nho", ownedGunIds: ["thuoc_no_nho", "ba_tia"], loadout: [], pvp: { wins: 0, losses: 0, draws: 0 } };
      // giả lập kho: ba_tia đã có sẵn, các súng khác là mới
      return { character: c, drops: [...new Set(rolled)].filter((g) => g !== "ba_tia") };
    },
    onDone: () => {
      done = true;
    },
  });
  match.start();
  match.handleMove(6);
  match.handleShot(45, opts.shotPower ?? 28, 1, "thuoc_no_nho");
  for (let i = 0; i < 2000 && !done; i++) {
    clock.advance(500);
    await flush();
  }
  return { sent, calls, end: sent.find((m) => m.type === "match_end"), start: sent.find((m) => m.type === "match_start") };
}

describe("súng rơi khi thắng PvE", () => {
  it("chance 1: mỗi quái bị hạ quay cả bảng; match_end.drops chỉ súng mới (không trùng, bỏ súng đã có)", async () => {
    const r = await play(winData(), { random: () => 0 });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.result).toBe("win");
    // 2 quái x 3 mục
    expect(r.calls[0]!.rolled).toEqual(["ba_tia", "lien_thanh", "sung_hoi", "ba_tia", "lien_thanh", "sung_hoi"]);
    expect(r.end.drops).toEqual(["lien_thanh", "sung_hoi"]);
  });
  it("chance không đạt: không rơi gì", async () => {
    const r = await play(winData(), { random: () => 0.999999 });
    expect(r.calls[0]!.rolled).toEqual([]);
    expect(r.end.drops).toEqual([]);
  });
  it("bốc theo thứ tự quái rồi theo bảng, đúng một lần mỗi mục (random có hạt giống)", async () => {
    const seeded = mulberry32(2024);
    const probe = mulberry32(2024);
    const d = winData();
    const table = d.monsters["am_thach_nho"]!.drops;
    const expected: string[] = [];
    for (let m = 0; m < 2; m++) for (const e of table) if (probe() < e.chance) expected.push(e.gunId);
    const calls = [0];
    const r = await play(d, { random: () => (calls[0]!++, seeded()) });
    expect(calls[0]).toBe(2 * table.length);
    expect(r.calls[0]!.rolled).toEqual(expected);
  });
  it("thua hoặc hòa: không bốc, không gọi random", async () => {
    let called = 0;
    const d = winData((x) => {
      x.monsters["am_thach_nho"]!.hp = 100000; // không ai chết
      x.guns["thuoc_no_nho"]!.damage = 0;
      x.settings.maxTurnsPerMatch = 2;
    });
    const r = await play(d, { random: () => (called++, 0) });
    expect(r.calls[0]!.result).not.toBe("win");
    expect(r.calls[0]!.rolled).toEqual([]);
    expect(called).toBe(0);
    expect(r.end.drops).toEqual([]);
  });
  it("mặc định dùng crypto: kết quả vẫn là mảng súng nằm trong bảng", async () => {
    const r = await play(winData((d) => d.monsters["am_thach_nho"]!.drops.forEach((e) => (e.chance = 1))), {});
    expect(r.calls[0]!.rolled).toHaveLength(6);
  });
});

describe("loadout trong trận", () => {
  it("đơn vị người chơi mang súng cung + loadout; thiếu loadout thì dùng mặc định", async () => {
    const d = winData();
    const a = await play(d, { loadout: ["thuoc_no_nho", "laser"] });
    const me = a.start.units.find((u: any) => u.id === a.start.you);
    expect(me.guns).toEqual([...d.character.signDefs["xu_nu"]!.gunIds, "thuoc_no_nho", "laser"]);
    const b = await play(d, {});
    expect(b.start.units.find((u: any) => u.id === b.start.you).guns).toEqual([...d.character.signDefs["xu_nu"]!.gunIds, "thuoc_no_nho"]);
  });
  it("súng không có trong loadout bị từ chối; phase gửi kèm zones", async () => {
    const d = winData();
    const clock = new ManualClock();
    const sent: any[] = [];
    const match = new Match({
      id: "m",
      data: d,
      clock,
      player: { name: "Bob", sign: "xu_nu", gunId: "thuoc_no_nho", loadout: ["ba_tia"], send: (m) => void sent.push(m), isConnected: () => true },
      monster: d.monsters["am_thach_nho"]!,
      settle: async () => {
        throw new Error("không gọi");
      },
      onDone: () => {},
    });
    match.start();
    match.handleMove(6);
    expect(match.handleShot(45, 50, 1, "thuoc_no_nho")).toBe("not_allowed");
    expect(match.handleShot(45, 50, 1, "ba_tia")).toBe("ok");
    for (const p of sent.filter((m) => m.type === "phase")) expect(p.zones).toEqual([]);
  });
});
