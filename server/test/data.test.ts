import { describe, expect, it } from "vitest";
import { loadGameData, validateGameData } from "../src/data.js";
import { testData } from "./util.js";

describe("nạp dữ liệu", () => {
  it("nạp được dữ liệu thật", () => {
    const d = loadGameData();
    expect(d.character.baseHp).toBeGreaterThan(0);
    expect(d.character.signs).toEqual(["bach_duong", "kim_nguu", "xu_nu", "bao_binh"]);
    expect(d.guns["thuoc_no_nho"]?.damage).toBeGreaterThan(0);
    expect(d.guns[d.monsters["am_thach_nho"]!.gunId]).toBeDefined();
    expect(d.monsters["am_thach_nho"]?.groupSize).toBe(2);
    expect(d.settings.movePhaseSeconds).toBe(15);
    expect(d.settings.contactRadiusTiles).toBe(0.8);
    expect(d.worldMaps["thanh"]?.kind).toBe("thanh");
    expect(d.worldMaps["vung_san_1"]?.kind).toBe("vung_san");
    expect(d.battleMaps["dong_am_thach_1"]?.rows).toHaveLength(30);
    expect(d.startMapId).toBe("thanh");
    expect(d.battle.moveRangeTiles).toBe(5);
  });

  it("từ chối bản đồ sai kích thước", () => {
    const d = testData();
    d.worldMaps["thanh"]!.rows[0] = "###";
    expect(() => validateGameData(d)).toThrow(/thanh/);
  });

  it("từ chối cổng trỏ tới bản đồ không tồn tại", () => {
    const d = testData();
    d.worldMaps["thanh"]!.portals[0]!.toMapId = "khong_co";
    expect(() => validateGameData(d)).toThrow(/khong_co/);
  });

  it("từ chối điểm xuất phát trong tường", () => {
    const d = testData();
    d.worldMaps["thanh"]!.spawn = { x: 0.5, y: 0.5 };
    expect(() => validateGameData(d)).toThrow();
  });

  it("từ chối quái trỏ tới bản đồ trận không có", () => {
    const d = testData();
    d.monsters["am_thach_nho"]!.battleMapId = "zzz";
    expect(() => validateGameData(d)).toThrow(/zzz/);
  });

  it("từ chối groupSize lớn hơn số cột xuất phát của quái", () => {
    const d = testData();
    d.monsters["am_thach_nho"]!.groupSize = 99;
    expect(() => validateGameData(d)).toThrow();
  });

  it("từ chối súng chung không có", () => {
    const d = testData();
    d.character.commonGunIds = ["nope"];
    expect(() => validateGameData(d)).toThrow(/nope/);
  });

  it("nạp bộ súng và nội tại của 4 cung", () => {
    const d = loadGameData();
    expect(d.character.commonGunIds).toEqual(["thuoc_no_nho"]);
    expect(d.character.energyStart).toBe(3);
    expect(d.battle.energyMax).toBe(10);
    expect(d.battle.energyRegenPerTurn).toBe(2);
    for (const s of d.character.signs) {
      const sd = d.character.signDefs[s]!;
      expect(sd.gunIds).toHaveLength(3);
      for (const g of sd.gunIds) expect(d.guns[g]!.sign).toBe(s);
    }
    expect(d.character.signDefs["bach_duong"]!.passive.type).toBe("earlyShot");
    expect(d.guns["sung_tieu_lien"]).toMatchObject({ kind: "burst", count: 3, powerOffsets: [-4, 0, 4] });
    expect(d.guns["phao_sao_bang"]).toMatchObject({ kind: "shower", count: 4, spreadTiles: 3 });
    expect(d.guns["khien_dan"]!.selfEffect).toEqual({ type: "shield", amount: 40 });
    expect(d.guns["thien_thach"]).toMatchObject({ craterDepthTiles: 2, stun: { turns: 1 } });
  });

  it("từ chối súng của cung khác trong gunIds", () => {
    const d = testData();
    d.character.signDefs["xu_nu"]!.gunIds[0] = "phao_dan_no";
    expect(() => validateGameData(d)).toThrow(/phao_dan_no/);
  });

  it("từ chối gunIds trỏ tới súng không có", () => {
    const d = testData();
    d.character.signDefs["kim_nguu"]!.gunIds[1] = "khong_co";
    expect(() => validateGameData(d)).toThrow(/khong_co/);
  });

  it("từ chối súng kind thiếu trường riêng", () => {
    const d = testData();
    delete d.guns["sung_tieu_lien"]!.powerOffsets;
    expect(() => validateGameData(d)).toThrow(/sung_tieu_lien/);
    const e = testData();
    delete e.guns["khien_dan"]!.selfEffect;
    expect(() => validateGameData(e)).toThrow(/khien_dan/);
    const f = testData();
    delete f.guns["phao_sao_bang"]!.spreadTiles;
    expect(() => validateGameData(f)).toThrow(/phao_sao_bang/);
  });
});
