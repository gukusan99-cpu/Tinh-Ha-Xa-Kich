import { describe, expect, it } from "vitest";
import { loadGameData, validateGameData } from "../src/data.js";
import { testData } from "./util.js";

describe("nạp dữ liệu", () => {
  it("nạp được dữ liệu thật", () => {
    const d = loadGameData();
    expect(d.character.baseHp).toBe(100);
    expect(d.character.signs).toEqual(["bach_duong", "kim_nguu", "xu_nu", "bao_binh"]);
    expect(d.guns["thuoc_no_nho"]?.damage).toBe(35);
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

  it("từ chối súng khởi đầu không có", () => {
    const d = testData();
    d.character.startingGunId = "nope";
    expect(() => validateGameData(d)).toThrow(/nope/);
  });
});
