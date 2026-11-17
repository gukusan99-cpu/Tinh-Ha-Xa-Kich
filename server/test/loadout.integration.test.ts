import { afterEach, describe, expect, it } from "vitest";
import { scaledClock } from "../src/clock.js";
import type { GameData } from "../src/data.js";
import { createServer, type GameServer } from "../src/server.js";
import { testData } from "./util.js";
import { Client } from "./wsclient.js";

let server: GameServer | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.length = 0;
  await server?.close();
  server = null;
});

const winTweak = (d: GameData): void => {
  d.monsters["am_thach_nho"]!.hp = 1;
  d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [10, 12];
  d.battle.deviationMaxTiles = 0;
  d.battle.critChance = 0;
  d.character.baseHp = 1000;
  d.settings.monsterRespawnSeconds = 100000;
};

describe("tích hợp: thắng -> súng rơi -> set_loadout trong thành -> trận kế mang súng", () => {
  it("toàn bộ luồng", async () => {
    const data = testData();
    winTweak(data);
    server = await createServer({ port: 0, clock: scaledClock(20), data, dropRandom: () => 0 });
    const c = await Client.open(server.port);
    clients.push(c);

    c.send({ type: "set_loadout", gunIds: [] }); // chưa đăng nhập
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c.send({ type: "register", username: "looter", password: "secret1" });
    await c.waitFor("auth_ok");
    c.send({ type: "create_character", name: "Nhặt Súng", sign: "bao_binh" });
    const created = await c.waitFor("character");
    expect(created.character).toMatchObject({ ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"] });
    c.send({ type: "set_loadout", gunIds: [] }); // chưa vào thế giới
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });

    c.send({ type: "enter_world" });
    await c.waitFor("world_state");
    c.send({ type: "set_loadout", gunIds: ["ba_tia"] }); // trong thành nhưng chưa có súng
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });

    // ra vùng săn, thắng một trận
    c.send({ type: "move_to", x: 28.5, y: 9.5 });
    const hunt = await c.waitFor("world_state");
    expect(hunt.mapId).toBe("vung_san_1");
    server.world.teleport(hunt.entities.find((e: any) => e.kind === "monster").id, 2.5, 15.5);
    const start1 = await c.waitFor("match_start");
    const me1 = start1.units.find((u: any) => u.id === start1.you);
    expect(me1.guns).toEqual([...data.character.signDefs["bao_binh"]!.gunIds, "thuoc_no_nho"]);
    await c.waitFor("phase");
    c.send({ type: "battle_move", col: 7 });
    await c.waitFor("moves_result");
    await c.waitFor((m) => m.type === "phase" && m.phase === "aim");
    c.send({ type: "battle_shot", angle: 45, power: 28, facing: 1, gunId: "dan_sao" });
    const end = await c.waitFor("match_end");
    expect(end.result).toBe("win");
    expect(end.drops).toEqual(["ba_tia", "lien_thanh", "sung_hoi"]);
    expect(end.character.ownedGunIds).toEqual(["thuoc_no_nho", "ba_tia", "lien_thanh", "sung_hoi"]);
    expect(end.character.loadout).toEqual(["thuoc_no_nho"]);
    const back = await c.waitFor("world_state"); // về vùng săn
    expect(back.mapId).toBe("vung_san_1");

    // ở vùng săn: không được đổi trang bị
    c.send({ type: "set_loadout", gunIds: ["ba_tia"] });
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });

    // về thành (cổng bên trái)
    c.send({ type: "move_to", x: 0.5, y: 15.5 });
    const city = await c.waitFor((m) => m.type === "world_state" && m.mapId === "thanh");
    expect(city.mapId).toBe("thanh");

    for (const bad of [["ba_tia", "lien_thanh", "sung_hoi"], ["ba_tia", "ba_tia"], ["laser"], ["phao_dan_no"], ["da_am_thach"]]) {
      c.send({ type: "set_loadout", gunIds: bad });
      expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    }
    c.send({ type: "set_loadout", gunIds: ["lien_thanh", "ba_tia"] });
    const set = await c.waitFor("character");
    expect(set.character.loadout).toEqual(["lien_thanh", "ba_tia"]);
    expect(set.character.ownedGunIds).toEqual(["thuoc_no_nho", "ba_tia", "lien_thanh", "sung_hoi"]);

    // trận kế mang đúng súng
    c.send({ type: "move_to", x: 28.5, y: 9.5 });
    const hunt2 = await c.waitFor((m) => m.type === "world_state" && m.mapId === "vung_san_1");
    server.world.teleport(hunt2.entities.find((e: any) => e.kind === "monster").id, 2.5, 15.5);
    const start2 = await c.waitFor("match_start");
    const me2 = start2.units.find((u: any) => u.id === start2.you);
    expect(me2.guns).toEqual([...data.character.signDefs["bao_binh"]!.gunIds, "lien_thanh", "ba_tia"]);
    await c.waitFor("phase");
    c.send({ type: "set_loadout", gunIds: [] }); // trong trận
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c.send({ type: "battle_move", col: 7 });
    await c.waitFor((m) => m.type === "phase" && m.phase === "aim");
    c.send({ type: "battle_shot", angle: 45, power: 28, facing: 1, gunId: "thuoc_no_nho" }); // không còn trong loadout
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c.send({ type: "battle_shot", angle: 45, power: 28, facing: 1, gunId: "ba_tia" });
    const tr = await c.waitFor("turn_result");
    expect(tr.shots.filter((s: any) => s.gunId === "ba_tia")).toHaveLength(3);
    expect(Array.isArray(tr.zones)).toBe(true);
    expect(Array.isArray(tr.chainHits)).toBe(true);
    const end2 = await c.waitFor("match_end");
    expect(end2.drops).toEqual([]); // súng đã có thì không tính lại
  }, 40000);
});
