import { describe, expect, it } from "vitest";
import { AccountService, MemoryAccountStore, type AccountRules } from "../src/accounts.js";
import { loadGameData, validateGameData } from "../src/data.js";
import { parseClientMessage } from "../src/protocol.js";
import { candidateGuns, simulateMatch, simulatePvpMatch, runMany } from "../src/sim/simulate.js";
import { testData } from "./util.js";

const rules: AccountRules = {
  signs: ["xu_nu"],
  startingGunId: "thuoc_no_nho",
  expPerLevel: 100,
  startingOwnedGunIds: ["thuoc_no_nho"],
  defaultLoadout: ["thuoc_no_nho"],
  extraGunSlots: 2,
  loadoutGunIds: ["thuoc_no_nho", "ba_tia", "lien_thanh", "laser"],
};
async function fresh(): Promise<{ s: AccountService; store: MemoryAccountStore }> {
  const store = new MemoryAccountStore();
  const s = new AccountService(store, rules);
  await s.register("bob", "secret1");
  await s.createCharacter("bob", "Bob", "xu_nu");
  return { s, store };
}

describe("dữ liệu súng chung", () => {
  it("nạp 9 súng mới với trường đúng tên, bảng rơi và kho khởi đầu", () => {
    const d = loadGameData();
    expect(d.guns["ba_tia"]).toMatchObject({ kind: "spread", count: 3, angleOffsets: [-4, 0, 4], tier: "thuong" });
    expect(d.guns["phun_lua"]).toMatchObject({ kind: "spread", maxPower: 45, burn: { turns: 2, damagePerTurn: 5 }, tier: "hiem" });
    expect(d.guns["laser"]).toMatchObject({ kind: "beam", beamLengthTiles: 40, pierceTiles: 2 });
    expect(d.guns["to_nhen"]!.root).toEqual({ turns: 1 });
    expect(d.guns["noc_doc"]!.zone).toEqual({ radiusTiles: 2.5, turns: 3, poison: { turns: 2, damagePerTurn: 8 } });
    expect(d.guns["day_dien"]!.chain).toEqual({ maxTargets: 2, radiusTiles: 5, falloff: 0.6 });
    expect(d.battle.rootMaxTurns).toBe(1);
    expect(d.battle.poisonMaxTurns).toBe(2);
    expect(d.character.startingOwnedGunIds).toEqual(["thuoc_no_nho"]);
    expect(d.character.extraGunSlots).toBe(2);
    expect(d.monsters["am_thach_nho"]!.drops.map((x) => x.gunId)).toEqual(["ba_tia", "lien_thanh", "sung_hoi"]);
    expect(candidateGuns(d)).toHaveLength(9);
  });
  it("từ chối bảng rơi sai", () => {
    const a = testData();
    a.monsters["am_thach_nho"]!.drops.push({ gunId: "khong_co", chance: 0.1 });
    expect(() => validateGameData(a)).toThrow(/khong_co/);
    const b = testData();
    b.monsters["am_thach_nho"]!.drops.push({ gunId: "phao_dan_no", chance: 0.1 }); // súng cung
    expect(() => validateGameData(b)).toThrow(/phao_dan_no/);
    const c = testData();
    c.monsters["am_thach_nho"]!.drops.push({ gunId: "ba_tia", chance: 1.5 });
    expect(() => validateGameData(c)).toThrow(/chance/);
    const e = testData();
    e.monsters["am_thach_nho"]!.drops.push({ gunId: "da_am_thach", chance: 0.1 }); // súng quái
    expect(() => validateGameData(e)).toThrow(/da_am_thach/);
  });
  it("từ chối kho khởi đầu/loadout mặc định sai, spread/beam thiếu trường", () => {
    const a = testData();
    a.character.startingOwnedGunIds = ["sung_nang"];
    expect(() => validateGameData(a)).toThrow(/sung_nang/);
    const b = testData();
    b.character.extraGunSlots = 0;
    expect(() => validateGameData(b)).toThrow(/extraGunSlots/);
    const c = testData();
    delete c.guns["laser"]!.beamLengthTiles;
    expect(() => validateGameData(c)).toThrow(/laser/);
    const e = testData();
    e.guns["ba_tia"]!.angleOffsets = [];
    expect(() => validateGameData(e)).toThrow(/ba_tia/);
  });
});

describe("kho súng và loadout", () => {
  it("nhân vật mới: kho và loadout mặc định", async () => {
    const { s } = await fresh();
    const r = await s.login("bob", "secret1");
    expect(r.ok && r.account.character).toMatchObject({ ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"] });
  });
  it("nhân vật lưu từ bản cũ thiếu trường được điền mặc định khi đăng nhập và khi cập nhật", async () => {
    const store = new MemoryAccountStore();
    const s = new AccountService(store, rules);
    await s.register("old", "secret1");
    await store.createCharacter("old", { name: "Old", sign: "xu_nu", level: 1, exp: 0, gunId: "thuoc_no_nho" } as never);
    const r = await s.login("old", "secret1");
    expect(r.ok && r.account.character).toMatchObject({ ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"], pvp: { wins: 0, losses: 0, draws: 0 } });
    const c = await s.awardExp("old", 5);
    expect(c).toMatchObject({ exp: 5, ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"] });
  });
  it("awardDrops: chỉ súng mới, không trùng, giữ thứ tự, lưu lại", async () => {
    const { s } = await fresh();
    const r = await s.awardDrops("bob", ["ba_tia", "thuoc_no_nho", "ba_tia", "laser"]);
    expect(r!.newGunIds).toEqual(["ba_tia", "laser"]);
    expect(r!.character.ownedGunIds).toEqual(["thuoc_no_nho", "ba_tia", "laser"]);
    expect((await s.awardDrops("bob", ["ba_tia"]))!.newGunIds).toEqual([]);
    const l = await s.login("bob", "secret1");
    expect(l.ok && l.account.character!.ownedGunIds).toEqual(["thuoc_no_nho", "ba_tia", "laser"]);
    expect(await s.awardDrops("nobody", ["ba_tia"])).toBeNull();
  });
  it("setLoadout: hợp lệ lưu lại; không có trong kho, trùng, vượt ô, súng cung/quái/lạ bị từ chối", async () => {
    const { s } = await fresh();
    await s.awardDrops("bob", ["ba_tia", "lien_thanh", "laser"]);
    const ok = await s.setLoadout("bob", ["ba_tia", "laser"]);
    expect(ok).toMatchObject({ ok: true, character: { loadout: ["ba_tia", "laser"] } });
    expect(await s.setLoadout("bob", [])).toMatchObject({ ok: true, character: { loadout: [] } });
    expect(await s.setLoadout("bob", ["ba_tia", "lien_thanh", "laser"])).toEqual({ ok: false }); // 3 > 2 ô
    expect(await s.setLoadout("bob", ["ba_tia", "ba_tia"])).toEqual({ ok: false });
    expect(await s.setLoadout("bob", ["sung_hoi"])).toEqual({ ok: false }); // chưa có
    expect(await s.setLoadout("bob", ["phao_dan_no"])).toEqual({ ok: false }); // súng cung
    expect(await s.setLoadout("bob", ["da_am_thach"])).toEqual({ ok: false }); // súng quái
    expect(await s.setLoadout("nobody", [])).toEqual({ ok: false });
    const l = await s.login("bob", "secret1");
    expect(l.ok && l.account.character!.loadout).toEqual([]); // lệnh sai không đổi gì
  });
});

describe("giao thức set_loadout", () => {
  it("parse hợp lệ và từ chối sai hình dạng", () => {
    expect(parseClientMessage(JSON.stringify({ v: 1, type: "set_loadout", gunIds: ["a", "b"] }))).toEqual({
      ok: true,
      message: { v: 1, type: "set_loadout", gunIds: ["a", "b"] },
    });
    expect(parseClientMessage(JSON.stringify({ v: 1, type: "set_loadout", gunIds: [] })).ok).toBe(true);
    for (const bad of [undefined, "a", [1], [""], ["x".repeat(65)], Array(17).fill("a"), null]) {
      expect(parseClientMessage(JSON.stringify({ v: 1, type: "set_loadout", gunIds: bad }))).toEqual({ ok: false, code: "bad_message" });
    }
  });
});

describe("mô phỏng với loadout", () => {
  it("--loadout: bot có súng thêm, tất định; loadout sai bị từ chối; PvP nhận loadout", () => {
    const o = { policy: "gioi" as const, seed: 5, sign: "xu_nu", loadout: ["thuoc_no_nho", "ba_tia"] };
    expect(simulateMatch(o)).toEqual(simulateMatch(o));
    expect(() => simulateMatch({ ...o, loadout: ["a"] })).toThrow(/a/);
    expect(() => simulateMatch({ ...o, loadout: ["ba_tia", "laser", "lien_thanh"] })).toThrow(/ô/);
    expect(() => simulateMatch({ ...o, loadout: ["phao_dan_no"] })).toThrow(/phao_dan_no/);
    const p = { signA: "bach_duong", signB: "xu_nu", seed: 3, swap: false, loadoutA: ["laser"], loadoutB: ["ba_tia", "sung_hoi"] };
    expect(simulatePvpMatch(p)).toEqual(simulatePvpMatch(p));
  }, 60000);
  it("bot gioi dùng được súng thêm (laser / ba_tia / nọc độc) và vẫn thắng đa số", () => {
    for (const g of ["laser", "ba_tia", "noc_doc", "day_dien"]) {
      const r = runMany("gioi", 10, {}, 1, "kim_nguu", undefined, ["thuoc_no_nho", g]);
      expect(r.win).toBeGreaterThan(0.4);
    }
  }, 120000);
});
