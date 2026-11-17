import { describe, expect, it } from "vitest";
import { World, isBlocked, moveToward, type MonsterEntity, type PlayerEntity } from "../src/world.js";
import { testData } from "./util.js";

function setup(opts: { random?: () => number } = {}) {
  const data = testData();
  const transfers: Array<{ id: number; to: string }> = [];
  const contacts: Array<{ player: PlayerEntity; monster: MonsterEntity; mapId: string }> = [];
  const world = new World({
    data,
    random: opts.random,
    events: {
      onTransfer: (p, to) => transfers.push({ id: p.id, to }),
      onContact: (player, monster, mapId) => contacts.push({ player, monster, mapId }),
    },
  });
  return { data, world, transfers, contacts };
}

describe("isBlocked / moveToward", () => {
  const { data } = setup();
  const thanh = data.worldMaps["thanh"]!;

  it("ngoài bản đồ coi là tường, ô # là tường", () => {
    expect(isBlocked(thanh, -0.1, 5)).toBe(true);
    expect(isBlocked(thanh, 5, -0.1)).toBe(true);
    expect(isBlocked(thanh, thanh.width, 5)).toBe(true);
    expect(isBlocked(thanh, 5, thanh.height)).toBe(true);
    expect(isBlocked(thanh, 0.5, 0.5)).toBe(true); // góc tường
    expect(isBlocked(thanh, 15.5, 10.5)).toBe(false);
    expect(isBlocked(thanh, 3.5, 3.5)).toBe(true); // khối ### ở hàng 3
  });

  it("đi thẳng đúng quãng đường rồi tới đích", () => {
    const r = moveToward(thanh, 15.5, 10.5, 20.5, 10.5, 2);
    expect(r.x).toBeCloseTo(17.5, 5);
    expect(r.y).toBeCloseTo(10.5, 5);
    expect(r.arrived).toBe(false);
    expect(r.blocked).toBe(false);
    const r2 = moveToward(thanh, 15.5, 10.5, 16.5, 10.5, 5);
    expect(r2).toMatchObject({ x: 16.5, y: 10.5, arrived: true });
  });

  it("dừng trước tường, không xuyên", () => {
    // khối ### chiếm cột 3-5, hàng 3-4; đi từ (8.5,3.5) sang trái
    const r = moveToward(thanh, 8.5, 3.5, 1.5, 3.5, 20);
    expect(r.blocked).toBe(true);
    expect(r.x).toBeGreaterThanOrEqual(6);
    expect(r.x).toBeLessThan(6.2);
    expect(isBlocked(thanh, r.x, r.y)).toBe(false);
  });

  it("dừng ở mép bản đồ (ngoài là tường)", () => {
    // hàng 9 thông ra ngoài ở cột 29
    const r = moveToward(thanh, 28.5, 9.5, 40, 9.5, 20);
    expect(r.blocked).toBe(true);
    expect(r.x).toBeLessThan(thanh.width);
    expect(r.x).toBeGreaterThan(thanh.width - 0.2);
  });

  it("đích ngay trong tường: đứng yên nếu bị chặn từ đầu", () => {
    const r = moveToward(thanh, 1.5, 1.5, 0.5, 0.5, 5);
    expect(isBlocked(thanh, r.x, r.y)).toBe(false);
    expect(r.blocked).toBe(true);
  });
});

describe("World: người chơi", () => {
  it("đặt người chơi ở điểm xuất phát, move_to đi với tốc độ trong dữ liệu", () => {
    const { world, data } = setup();
    const p = world.addPlayer("bob", "Bob", "thanh");
    expect(p).toMatchObject({ x: 15.5, y: 10.5, mapId: "thanh" });
    world.setTarget(p.id, 25.5, 10.5);
    world.step(1);
    expect(p.x).toBeCloseTo(15.5 + data.character.worldSpeedTilesPerSec, 3);
    expect(p.y).toBeCloseTo(10.5, 3);
  });

  it("dừng và xóa đích khi gặp tường", () => {
    const { world } = setup();
    const p = world.addPlayer("bob", "Bob", "thanh", 8.5, 3.5);
    world.setTarget(p.id, 1.5, 3.5);
    for (let i = 0; i < 20; i++) world.step(0.1);
    const stopX = p.x;
    expect(stopX).toBeGreaterThanOrEqual(6);
    expect(stopX).toBeLessThan(6.2);
    world.step(1);
    expect(p.x).toBe(stopX);
  });

  it("entities(mapId) liệt kê người chơi và quái cùng bản đồ", () => {
    const { world } = setup();
    const p = world.addPlayer("bob", "Bob", "vung_san_1");
    const list = world.entities("vung_san_1");
    expect(list.filter((e) => e.kind === "monster")).toHaveLength(5);
    expect(list.find((e) => e.id === p.id)).toMatchObject({ kind: "player", name: "Bob" });
    expect(world.entities("thanh")).toEqual([]);
    world.removePlayer(p.id);
    expect(world.entities("vung_san_1").some((e) => e.kind === "player")).toBe(false);
  });
});

describe("World: cổng", () => {
  it("bước vào hình chữ nhật cổng thì chuyển bản đồ tới điểm đến", () => {
    const { world, transfers } = setup();
    const p = world.addPlayer("bob", "Bob", "thanh", 26.5, 9.5);
    world.setTarget(p.id, 28.5, 9.5);
    for (let i = 0; i < 10; i++) world.step(0.1);
    expect(transfers).toEqual([{ id: p.id, to: "vung_san_1" }]);
    expect(p.mapId).toBe("vung_san_1");
    expect(p.x).toBe(2.5);
    expect(p.y).toBe(15.5);
    expect(world.entities("thanh")).toEqual([]);
    expect(world.entities("vung_san_1").some((e) => e.id === p.id)).toBe(true);
  });

  it("cổng ngược lại về thành", () => {
    const { world, transfers } = setup();
    const p = world.addPlayer("bob", "Bob", "vung_san_1", 2.5, 15.5);
    world.setTarget(p.id, 0.5, 15.5);
    for (let i = 0; i < 10; i++) world.step(0.1);
    expect(transfers).toEqual([{ id: p.id, to: "thanh" }]);
    expect(p).toMatchObject({ mapId: "thanh", x: 26.5, y: 10.5 });
  });

  it("đứng ngoài cổng thì không chuyển", () => {
    const { world, transfers } = setup();
    const p = world.addPlayer("bob", "Bob", "thanh", 20.5, 9.5);
    world.step(0.1);
    expect(transfers).toEqual([]);
    expect(p.mapId).toBe("thanh");
  });
});

describe("World: quái", () => {
  it("sinh đủ số quái trong vùng spawn, không nằm trong tường", () => {
    const { world, data } = setup();
    world.addPlayer("bob", "Bob", "vung_san_1");
    const map = data.worldMaps["vung_san_1"]!;
    const area = map.monsterSpawns[0]!.area;
    const ms = world.monstersIn("vung_san_1");
    expect(ms).toHaveLength(5);
    for (const m of ms) {
      expect(m.x).toBeGreaterThanOrEqual(area.x);
      expect(m.x).toBeLessThan(area.x + area.w);
      expect(m.y).toBeGreaterThanOrEqual(area.y);
      expect(m.y).toBeLessThan(area.y + area.h);
      expect(isBlocked(map, m.x, m.y)).toBe(false);
      expect(m.monsterId).toBe("am_thach_nho");
    }
  });

  it("lang thang chậm và luôn ở trong vùng", () => {
    const { world, data } = setup();
    const map = data.worldMaps["vung_san_1"]!;
    const area = map.monsterSpawns[0]!.area;
    const speed = data.monsters["am_thach_nho"]!.worldSpeedTilesPerSec;
    const start = new Map(world.monstersIn("vung_san_1").map((m) => [m.id, { x: m.x, y: m.y }]));
    let moved = false;
    for (let i = 0; i < 600; i++) {
      world.step(0.1);
      for (const m of world.monstersIn("vung_san_1")) {
        expect(m.x).toBeGreaterThanOrEqual(area.x);
        expect(m.x).toBeLessThanOrEqual(area.x + area.w);
        expect(m.y).toBeGreaterThanOrEqual(area.y);
        expect(m.y).toBeLessThanOrEqual(area.y + area.h);
        expect(isBlocked(map, m.x, m.y)).toBe(false);
        const b = start.get(m.id)!;
        if (Math.hypot(m.x - b.x, m.y - b.y) > 0.5) moved = true;
      }
    }
    expect(moved).toBe(true);
    // một bước 0.1s không vượt tốc độ cho phép
    const m = world.monstersIn("vung_san_1")[0]!;
    const x0 = m.x;
    const y0 = m.y;
    world.step(0.1);
    expect(Math.hypot(m.x - x0, m.y - y0)).toBeLessThanOrEqual(speed * 0.1 + 1e-6);
  });
});

describe("World: chạm quái", () => {
  it("trong vùng săn, chạm quái thì gỡ cả hai và báo onContact", () => {
    const { world, contacts, data } = setup();
    const p = world.addPlayer("bob", "Bob", "vung_san_1");
    const m = world.monstersIn("vung_san_1")[0]!;
    world.teleport(m.id, p.x + data.settings.contactRadiusTiles - 0.05, p.y);
    world.step(0.0001);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.player.id).toBe(p.id);
    expect(contacts[0]!.monster.id).toBe(m.id);
    expect(contacts[0]!.mapId).toBe("vung_san_1");
    expect(world.entities("vung_san_1").some((e) => e.id === p.id || e.id === m.id)).toBe(false);
    expect(world.getPlayer(p.id)).toBeUndefined();
  });

  it("cách xa hơn contactRadiusTiles thì không chạm", () => {
    const { world, contacts, data } = setup();
    const p = world.addPlayer("bob", "Bob", "vung_san_1");
    const m = world.monstersIn("vung_san_1")[0]!;
    world.teleport(m.id, p.x + data.settings.contactRadiusTiles + 0.3, p.y);
    world.step(0.0001);
    expect(contacts).toHaveLength(0);
  });

  it("trong thành không có quái nên không có chạm; spawn chỉ ở vùng săn", () => {
    const { world, contacts } = setup();
    world.addPlayer("bob", "Bob", "thanh");
    world.step(1);
    expect(contacts).toHaveLength(0);
    expect(world.monstersIn("thanh")).toHaveLength(0);
  });

  it("quái hồi sinh sau monsterRespawnSeconds", () => {
    const { world, data } = setup();
    const p = world.addPlayer("bob", "Bob", "vung_san_1");
    const m = world.monstersIn("vung_san_1")[0]!;
    world.teleport(m.id, p.x + 0.3, p.y);
    world.step(0.0001);
    expect(world.monstersIn("vung_san_1")).toHaveLength(4);
    world.step(data.settings.monsterRespawnSeconds - 1);
    expect(world.monstersIn("vung_san_1")).toHaveLength(4);
    world.step(1.1);
    expect(world.monstersIn("vung_san_1")).toHaveLength(5);
  });
});
