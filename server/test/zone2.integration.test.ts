import { afterEach, describe, expect, it } from "vitest";
import { MemoryAccountStore, hashPassword } from "../src/accounts.js";
import { scaledClock } from "../src/clock.js";
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

async function open(): Promise<Client> {
  const c = await Client.open(server!.port);
  clients.push(c);
  return c;
}

describe("tích hợp: cổng khóa cấp và vùng săn 2", () => {
  it("cấp 1 đứng vào cổng khóa thì ở lại thành và nhận portal_locked", async () => {
    server = await createServer({ port: 0, clock: scaledClock(20), data: testData() });
    const c = await open();
    c.send({ type: "register", username: "lowlvl", password: "secret1" });
    await c.waitFor("auth_ok");
    c.send({ type: "create_character", name: "Tân Thủ", sign: "xu_nu" });
    await c.waitFor("character");
    c.send({ type: "enter_world" });
    const w = await c.waitFor("world_state");
    expect(w.mapId).toBe("thanh");
    c.send({ type: "move_to", x: 15, y: 0.5 }); // cổng phía trên (vung_san_2, levelRequired 2)
    expect(await c.waitFor("portal_locked")).toEqual({ v: 1, type: "portal_locked", levelRequired: 2 });
    expect(server.world.getPlayer(w.you)!.mapId).toBe("thanh");
    // vài nhịp nữa vẫn ở thành, không có world_state mới
    await new Promise((r) => setTimeout(r, 300));
    expect(c.log.filter((m) => m.type === "world_state")).toHaveLength(1);
    expect(server.world.getPlayer(w.you)!.mapId).toBe("thanh");
  }, 20000);

  it("cấp 2 qua cổng vào vung_san_2, chạm Ám Thạch Gai vào trận pve với 2 quái biết đi", async () => {
    const store = new MemoryAccountStore();
    await store.create("lvl2hero", await hashPassword("secret1"));
    await store.createCharacter("lvl2hero", {
      name: "Cấp Hai",
      sign: "bao_binh",
      level: 2,
      exp: 0,
      gunId: "thuoc_no_nho",
      pvp: { wins: 0, losses: 0, draws: 0 },
    });
    server = await createServer({ port: 0, clock: scaledClock(20), data: testData(), store });
    const c = await open();
    c.send({ type: "login", username: "lvl2hero", password: "secret1" });
    expect((await c.waitFor("auth_ok")).character.level).toBe(2);
    c.send({ type: "enter_world" });
    const w1 = await c.waitFor("world_state");
    c.send({ type: "move_to", x: 15, y: 0.5 });
    const w2 = await c.waitFor((m) => m.type === "world_state" && m.mapId === "vung_san_2");
    expect(w2.you).toBe(w1.you);
    expect(c.log.some((m) => m.type === "portal_locked")).toBe(false);
    const kinds = new Set(w2.entities.filter((e: any) => e.kind === "monster").map((e: any) => e.monsterId));
    expect(kinds).toEqual(new Set(["am_thach_gai", "am_thach_lon"]));

    const gai = w2.entities.find((e: any) => e.monsterId === "am_thach_gai");
    const me = w2.entities.find((e: any) => e.id === w2.you);
    server.world.teleport(gai.id, me.x, me.y);
    const start = await c.waitFor("match_start");
    expect(start).toMatchObject({ mode: "pve", battleMapId: "hem_van_thach_1" });
    const monsters = start.units.filter((u: any) => u.kind === "monster");
    expect(monsters).toHaveLength(2);
    for (const m of monsters) expect(m.monsterId).toBe("am_thach_gai");

    await c.waitFor((m) => m.type === "phase" && m.phase === "move");
    c.send({ type: "battle_move", col: start.units.find((u: any) => u.id === start.you).col });
    const mr = await c.waitFor("moves_result");
    for (const m of monsters) expect(mr.moves.some((x: any) => x.unitId === m.id)).toBe(true);
    expect(mr.moves.some((x: any) => x.unitId !== start.you && x.path.length > 0)).toBe(true);
  }, 20000);
});
