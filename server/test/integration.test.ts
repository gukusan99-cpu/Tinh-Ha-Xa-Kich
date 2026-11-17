import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { scaledClock } from "../src/clock.js";
import type { GameData } from "../src/data.js";
import { createServer, type GameServer } from "../src/server.js";
import { testData } from "./util.js";

class Client {
  log: any[] = [];
  private cursor = 0;
  private waiters: Array<() => void> = [];
  closeCode: number | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      this.log.push(JSON.parse(d.toString()));
      for (const w of this.waiters.splice(0)) w();
    });
    ws.on("close", (code) => {
      this.closeCode = code;
      for (const w of this.waiters.splice(0)) w();
    });
  }
  static async open(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    const c = new Client(ws);
    c.send({ type: "hello", clientVersion: "test" });
    await c.waitFor("welcome");
    return c;
  }
  send(o: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, ...o }));
  }
  async waitFor(match: string | ((m: any) => boolean), timeoutMs = 4000): Promise<any> {
    const pred = typeof match === "string" ? (m: any) => m.type === match : match;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.log.length) {
        const m = this.log[this.cursor++];
        if (pred(m)) return m;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        const kinds = this.log.filter((m) => m.type !== "world_tick").map((m) => m.type);
        throw new Error(`hết giờ chờ ${String(match)}; đã nhận: ${kinds.join(",")}`);
      }
      await new Promise<void>((res) => {
        const t = setTimeout(res, left);
        this.waiters.push(() => {
          clearTimeout(t);
          res();
        });
      });
    }
  }
  async waitClosed(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error("hết giờ chờ đóng kết nối");
      await new Promise((r) => setTimeout(r, 5));
    }
    return this.closeCode;
  }
}

let server: GameServer | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.length = 0;
  await server?.close();
  server = null;
});

async function boot(tweak: (d: GameData) => void = () => {}): Promise<GameServer> {
  const data = testData();
  tweak(data);
  server = await createServer({ port: 0, clock: scaledClock(20), data });
  return server;
}
async function open(): Promise<Client> {
  const c = await Client.open(server!.port);
  clients.push(c);
  return c;
}

const winTweak = (d: GameData): void => {
  d.monsters["am_thach_nho"]!.hp = 1;
  d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [10, 12]; // gần người chơi để một phát bắn trúng cả hai
  d.battle.deviationMaxTiles = 0;
  d.battle.critChance = 0;
  d.character.baseHp = 1000;
  d.settings.monsterRespawnSeconds = 100000;
};

describe("tích hợp: toàn bộ luồng Giai đoạn 1", () => {
  it("đăng ký, đăng nhập đá kết nối cũ, tạo nhân vật, vào thế giới, qua cổng, trận, về thế giới", async () => {
    const s = await boot(winTweak);

    // 1. đăng ký (tự đăng nhập) trên kết nối 1
    const c1 = await open();
    c1.send({ type: "register", username: "hero", password: "secret1" });
    expect(await c1.waitFor("auth_ok")).toMatchObject({ v: 1, username: "hero", character: null });

    // 2. đăng nhập ở kết nối 2 ngắt kết nối 1
    const c2 = await open();
    c2.send({ type: "login", username: "hero", password: "secret1" });
    expect(await c2.waitFor("auth_ok")).toMatchObject({ username: "hero", character: null });
    expect(await c1.waitClosed()).toBe(4001);

    // 3. tạo nhân vật
    c2.send({ type: "enter_world" });
    expect(await c2.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c2.send({ type: "create_character", name: "  Anh Hùng ", sign: "bao_binh" });
    expect(await c2.waitFor("character")).toMatchObject({
      character: { name: "Anh Hùng", sign: "bao_binh", level: 1, exp: 0, gunId: "thuoc_no_nho" },
    });
    c2.send({ type: "create_character", name: "Khac", sign: "xu_nu" });
    expect(await c2.waitFor("error")).toMatchObject({ code: "not_allowed" });

    // 4. vào thành
    c2.send({ type: "enter_world" });
    const ws1 = await c2.waitFor("world_state");
    expect(ws1).toMatchObject({ mapId: "thanh", width: 30, height: 20 });
    expect(ws1.rows).toHaveLength(20);
    const me1 = ws1.entities.find((e: any) => e.id === ws1.you);
    expect(me1).toMatchObject({ kind: "player", name: "Anh Hùng", x: 15.5, y: 10.5 });
    const tick = await c2.waitFor("world_tick");
    expect(tick.entities.some((e: any) => e.id === ws1.you)).toBe(true);

    // 5. đi vào cổng
    c2.send({ type: "move_to", x: 28.5, y: 9.5 });
    const ws2 = await c2.waitFor((m) => m.type === "world_state");
    expect(ws2).toMatchObject({ mapId: "vung_san_1", width: 40, height: 30, you: ws1.you });
    const me2 = ws2.entities.find((e: any) => e.id === ws2.you);
    expect(me2).toMatchObject({ x: 2.5, y: 15.5 });
    const monsters = ws2.entities.filter((e: any) => e.kind === "monster");
    expect(monsters).toHaveLength(5);
    expect(monsters[0]).toMatchObject({ monsterId: "am_thach_nho" });

    // 6. ép chạm quái
    s.world.teleport(monsters[0].id, 2.5, 15.5); // đúng chỗ người chơi: chạm dù có bị trễ nhịp
    const start = await c2.waitFor("match_start");
    expect(start.units).toHaveLength(3);
    const phase1 = await c2.waitFor("phase");
    expect(phase1).toMatchObject({ turn: 1, phase: "move" });
    // người chơi và quái rời bản đồ: các world_tick sau đó không còn người chơi
    const afterTicks = c2.log.slice(c2.log.indexOf(start)).filter((m) => m.type === "world_tick");
    expect(afterTicks.length).toBe(0);

    // lệnh sai thời điểm / sai dữ liệu
    c2.send({ type: "battle_shot", angle: 45, power: 50, facing: 1, gunId: "thuoc_no_nho" });
    expect(await c2.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c2.send({ type: "battle_shot", angle: 45, power: 500, facing: 1, gunId: "thuoc_no_nho" });
    expect(await c2.waitFor("error")).toMatchObject({ code: "bad_message" });

    // 7. đi, bắn
    c2.send({ type: "battle_move", col: 7 });
    const mr = await c2.waitFor("moves_result");
    expect(mr.moves[0]).toMatchObject({ unitId: start.you, col: 7, path: [7] });
    expect(await c2.waitFor("phase")).toMatchObject({ turn: 1, phase: "aim" });
    c2.send({ type: "battle_move", col: 9 });
    expect(await c2.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c2.send({ type: "battle_shot", angle: 45, power: 28, facing: 1, gunId: "dan_sao" }); // súng của Bảo Bình
    const tr = await c2.waitFor("turn_result");
    expect(tr.turn).toBe(1);
    expect(tr.shots).toHaveLength(3);
    expect(tr.shots[0]).toMatchObject({ unitId: start.you });
    expect(Array.isArray(tr.shots[0].points)).toBe(true);
    for (const k of ["explosions", "damage", "falls", "deaths"]) expect(Array.isArray(tr[k])).toBe(true);
    expect(tr.deaths.length).toBe(2); // cả hai quái chết

    // 8. kết thúc và về thế giới
    const end = await c2.waitFor("match_end");
    expect(end).toMatchObject({ matchId: start.matchId, result: "win", rewards: { exp: 40 } });
    expect(end.character).toMatchObject({ name: "Anh Hùng", level: 1, exp: 40 });
    const ws3 = await c2.waitFor("world_state");
    expect(ws3).toMatchObject({ mapId: "vung_san_1", you: expect.any(Number) });
    expect(ws3.entities.find((e: any) => e.id === ws3.you)).toMatchObject({ x: 2.5, y: 15.5 });
    expect(ws3.entities.filter((e: any) => e.kind === "monster").length).toBe(4); // một con chờ hồi sinh

    // và đi lại được
    c2.send({ type: "move_to", x: 6.5, y: 15.5 });
    await c2.waitFor((m) => m.type === "world_tick" && m.entities.some((e: any) => e.kind === "player" && e.x > 4));
  }, 20000);

  it("lệnh khi chưa đăng nhập hoặc chưa vào thế giới -> not_allowed; auth lỗi", async () => {
    await boot();
    const c = await open();
    for (const m of [
      { type: "enter_world" },
      { type: "move_to", x: 1, y: 1 },
      { type: "create_character", name: "Abc", sign: "xu_nu" },
      { type: "battle_move", col: 1 },
      { type: "battle_shot", angle: 1, power: 1, facing: 1, gunId: "thuoc_no_nho" },
      { type: "aim_preview", angle: 1, power: 1, facing: 1, gunId: "sung_kinh" },
    ]) {
      c.send(m);
      expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    }
    c.send({ type: "login", username: "ghost", password: "secret1" });
    expect(await c.waitFor("auth_error")).toMatchObject({ code: "bad_credentials" });
    c.send({ type: "register", username: "x", password: "secret1" });
    expect(await c.waitFor("auth_error")).toMatchObject({ code: "invalid" });
    c.send({ type: "register", username: "dupe", password: "secret1" });
    await c.waitFor("auth_ok");
    c.send({ type: "register", username: "other", password: "secret1" });
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" }); // đã đăng nhập

    const d = await open();
    d.send({ type: "register", username: "DUPE", password: "secret1" });
    expect(await d.waitFor("auth_error")).toMatchObject({ code: "taken" });
    d.send({ type: "login", username: "dupe", password: "wrongpw" });
    expect(await d.waitFor("auth_error")).toMatchObject({ code: "bad_credentials" });
    d.send({ type: "create_character", name: "Abc", sign: "xu_nu" }); // chưa đăng nhập
    expect(await d.waitFor("error")).toMatchObject({ code: "not_allowed" });
  });

  it("sign không có trong dữ liệu -> bad_message; enter_world hai lần -> not_allowed", async () => {
    await boot();
    const c = await open();
    c.send({ type: "register", username: "signy", password: "secret1" });
    await c.waitFor("auth_ok");
    c.send({ type: "create_character", name: "Sig", sign: "ma_ket" });
    expect(await c.waitFor("error")).toMatchObject({ code: "bad_message" });
    c.send({ type: "create_character", name: "Sig", sign: "xu_nu" });
    await c.waitFor("character");
    c.send({ type: "enter_world" });
    await c.waitFor("world_state");
    c.send({ type: "enter_world" });
    expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
  });

  it("mất kết nối giữa trận: vẫn ở lại trận tới khi kết thúc; đăng nhập lại mới vào thế giới được", async () => {
    const s = await boot((d) => {
      d.guns["thuoc_no_nho"]!.damage = 0; // không ai chết: người chơi bị loại vì vắng mặt
      d.settings.replayPaddingSeconds = 10; // trận kéo dài đủ để đăng nhập lại
    });
    const c1 = await open();
    c1.send({ type: "register", username: "dropper", password: "secret1" });
    await c1.waitFor("auth_ok");
    c1.send({ type: "create_character", name: "Rớt Mạng", sign: "kim_nguu" });
    await c1.waitFor("character");
    c1.send({ type: "enter_world" });
    const w = await c1.waitFor("world_state");
    c1.send({ type: "move_to", x: 28.5, y: 9.5 });
    const w2 = await c1.waitFor("world_state");
    s.world.teleport(w2.entities.find((e: any) => e.kind === "monster").id, 2.5, 15.5);
    await c1.waitFor("match_start");
    expect(w.you).toBe(w2.you);
    expect(s.matchCount).toBe(1);
    c1.ws.terminate();
    await c1.waitClosed();
    expect(s.matchCount).toBe(1); // vẫn còn trận

    const c2 = await open();
    c2.send({ type: "login", username: "dropper", password: "secret1" });
    await c2.waitFor("auth_ok");
    c2.send({ type: "enter_world" });
    expect(await c2.waitFor("error")).toMatchObject({ code: "not_allowed" }); // đang trong trận
    const back = await c2.waitFor("world_state", 8000);
    expect(back).toMatchObject({ mapId: "vung_san_1" });
    expect(s.matchCount).toBe(0);
  }, 20000);
});
