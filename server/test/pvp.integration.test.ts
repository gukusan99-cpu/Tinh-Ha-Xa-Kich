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

/** Đấu trường phẳng, hai bên cách 4 ô, một phát là hạ (baseHp 1), không lệch, không bạo kích. */
const duel = (d: GameData): void => {
  const m = d.battleMaps["dau_truong_1"]!;
  m.rows = Array.from({ length: m.height }, (_, r) => (r >= 18 ? "#" : ".").repeat(m.width));
  m.team0SpawnCols = [6];
  m.team1SpawnCols = [10];
  d.character.baseHp = 1;
  d.battle.deviationMaxTiles = 0;
  d.battle.critChance = 0;
};

async function boot(tweak: (d: GameData) => void = () => {}): Promise<GameServer> {
  const data = testData();
  data.settings.challengeTimeoutSeconds = 400; // 20 giây thật ở tốc độ x20
  tweak(data);
  server = await createServer({ port: 0, clock: scaledClock(20), data });
  return server;
}

interface Hero {
  c: Client;
  id: number;
  world: any;
}

let seq = 0;
async function joinCity(name: string, sign: string): Promise<Hero> {
  const c = await Client.open(server!.port);
  clients.push(c);
  c.send({ type: "register", username: `pvp_user_${++seq}`, password: "secret1" });
  await c.waitFor("auth_ok");
  c.send({ type: "create_character", name, sign });
  await c.waitFor("character");
  c.send({ type: "enter_world" });
  const world = await c.waitFor("world_state");
  return { c, id: world.you, world };
}

const closed = (reason: string) => (m: any) => m.type === "challenge_closed" && m.reason === reason;

describe("thách đấu: luồng đầy đủ", () => {
  it("mời, nhận, trận PvP, kết quả thắng/thua, cả hai về thành với world_state", async () => {
    await boot(duel);
    const a = await joinCity("An Nhiên", "xu_nu");
    const b = await joinCity("Bình Minh", "kim_nguu");

    // world_state / world_tick mang sign và level của người chơi
    const latest = await a.c.waitFor((m) => m.type === "world_tick" && m.entities.some((e: any) => e.id === b.id));
    expect(latest.entities.find((e: any) => e.id === b.id)).toMatchObject({ kind: "player", sign: "kim_nguu", level: 1 });
    expect(b.world.entities.find((e: any) => e.id === a.id)).toMatchObject({ sign: "xu_nu", level: 1 });

    a.c.send({ type: "challenge", targetEntityId: b.id });
    const sent = await a.c.waitFor("challenge_sent");
    const recv = await b.c.waitFor("challenge_received");
    expect(sent).toMatchObject({ v: 1, targetName: "Bình Minh", challengeId: expect.any(String), expiresAt: expect.any(Number) });
    expect(recv).toMatchObject({
      v: 1,
      challengeId: sent.challengeId,
      fromName: "An Nhiên",
      fromSign: "xu_nu",
      fromLevel: 1,
      expiresAt: sent.expiresAt,
    });

    b.c.send({ type: "challenge_reply", challengeId: sent.challengeId, accept: true });
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId: sent.challengeId, reason: "accepted" });
    expect(await b.c.waitFor("challenge_closed")).toMatchObject({ challengeId: sent.challengeId, reason: "accepted" });

    const sa = await a.c.waitFor("match_start");
    const sb = await b.c.waitFor("match_start");
    expect(sa).toMatchObject({ mode: "pvp", matchId: sb.matchId, maxTurns: 15 });
    expect(sa.you).not.toBe(sb.you);
    const ua = sa.units.find((u: any) => u.id === sa.you);
    const ub = sa.units.find((u: any) => u.id === sb.you);
    expect(ua).toMatchObject({ team: 0, name: "An Nhiên", col: 6 }); // người mời bên trái
    expect(ub).toMatchObject({ team: 1, name: "Bình Minh", col: 10 }); // người nhận bên phải
    expect(server!.matchCount).toBe(1);

    // thế giới: cả hai đã rời bản đồ thành trong lúc đấu
    expect((await a.c.waitFor("phase")).phase).toBe("move");
    await b.c.waitFor("phase");
    a.c.send({ type: "battle_move", col: 6 });
    b.c.send({ type: "battle_move", col: 10 });
    expect((await a.c.waitFor("phase")).phase).toBe("aim");
    a.c.send({ type: "battle_shot", angle: 45, power: 28, facing: 1, gunId: "thuoc_no_nho" });

    const ea = await a.c.waitFor("match_end");
    const eb = await b.c.waitFor("match_end");
    expect(ea).toMatchObject({ matchId: sa.matchId, result: "win", rewards: { exp: 0 } });
    expect(eb).toMatchObject({ matchId: sa.matchId, result: "lose", rewards: { exp: 0 } });
    expect(ea.character).toMatchObject({ name: "An Nhiên", exp: 0, level: 1, pvp: { wins: 1, losses: 0, draws: 0 } });
    expect(eb.character).toMatchObject({ name: "Bình Minh", exp: 0, level: 1, pvp: { wins: 0, losses: 1, draws: 0 } });

    const wa = await a.c.waitFor("world_state");
    const wb = await b.c.waitFor("world_state");
    for (const w of [wa, wb]) {
      expect(w).toMatchObject({ mapId: "thanh" });
      const me = w.entities.find((e: any) => e.id === w.you);
      expect(me).toMatchObject({ x: 15.5, y: 10.5 }); // điểm xuất phát của thành
    }
    // người vào lại thành sau cùng thấy người kia kèm sign và level
    expect(wb.entities.find((e: any) => e.name === "An Nhiên")).toMatchObject({ sign: "xu_nu", level: 1 });
    expect(wb.entities.find((e: any) => e.id === wb.you)).toMatchObject({ sign: "kim_nguu", level: 1 });
    expect(server!.matchCount).toBe(0);

    // sau trận lại mời được (không cooldown vì không bị từ chối)
    b.c.send({ type: "challenge", targetEntityId: wa.you });
    await b.c.waitFor("challenge_sent");
    await a.c.waitFor("challenge_received");
  }, 30000);

  it("hòa khi cả hai cùng bị hạ trong một lượt", async () => {
    await boot(duel);
    const a = await joinCity("Hòa Một", "xu_nu");
    const b = await joinCity("Hòa Hai", "xu_nu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    b.c.send({ type: "challenge_reply", challengeId, accept: true });
    await a.c.waitFor("match_start");
    await b.c.waitFor("match_start");
    await a.c.waitFor("phase");
    a.c.send({ type: "battle_move", col: 6 });
    b.c.send({ type: "battle_move", col: 10 });
    await a.c.waitFor((m) => m.type === "phase" && m.phase === "aim");
    a.c.send({ type: "battle_shot", angle: 45, power: 28, facing: 1, gunId: "thuoc_no_nho" });
    b.c.send({ type: "battle_shot", angle: 45, power: 28, facing: -1, gunId: "thuoc_no_nho" });
    expect((await a.c.waitFor("match_end")).result).toBe("draw");
    const eb = await b.c.waitFor("match_end");
    expect(eb).toMatchObject({ result: "draw", character: { pvp: { draws: 1 } } });
    await a.c.waitFor("world_state");
    await b.c.waitFor("world_state");
  }, 30000);
});

describe("thách đấu: từ chối, cooldown, hết hạn, hủy", () => {
  it("từ chối: cả hai nhận declined; mời lại đúng người đó phải chờ, người khác thì được", async () => {
    await boot((d) => {
      d.settings.challengeRetrySeconds = 20; // 1 giây thật
    });
    const a = await joinCity("Mời Một", "bach_duong");
    const b = await joinCity("Nhận Hai", "bao_binh");
    const c = await joinCity("Ba Người", "kim_nguu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    b.c.send({ type: "challenge_reply", challengeId, accept: false });
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "declined" });
    expect(await b.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "declined" });

    a.c.send({ type: "challenge", targetEntityId: b.id });
    expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    // người khác thì được
    a.c.send({ type: "challenge", targetEntityId: c.id });
    const other = await a.c.waitFor("challenge_sent");
    await c.c.waitFor("challenge_received");
    a.c.send({ type: "challenge_cancel", challengeId: other.challengeId });
    await a.c.waitFor(closed("cancelled"));
    // hết thời gian chờ thì mời lại được
    await new Promise((r) => setTimeout(r, 1200));
    a.c.send({ type: "challenge", targetEntityId: b.id });
    await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
  }, 30000);

  it("hết hạn: cả hai nhận expired, không có cooldown", async () => {
    await boot((d) => {
      d.settings.challengeTimeoutSeconds = 2; // 100 ms thật
      d.settings.challengeRetrySeconds = 10000;
    });
    const a = await joinCity("Hết Một", "xu_nu");
    const b = await joinCity("Hết Hai", "xu_nu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "expired" });
    expect(await b.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "expired" });
    // trả lời lời mời đã hết hạn -> not_allowed
    b.c.send({ type: "challenge_reply", challengeId, accept: true });
    expect(await b.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    a.c.send({ type: "challenge", targetEntityId: b.id });
    await a.c.waitFor("challenge_sent");
  }, 30000);

  it("hủy: chỉ người mời; cả hai nhận cancelled; người nhận trả lời sau đó -> not_allowed", async () => {
    await boot();
    const a = await joinCity("Hủy Một", "xu_nu");
    const b = await joinCity("Hủy Hai", "xu_nu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");

    b.c.send({ type: "challenge_cancel", challengeId }); // người nhận không được hủy
    expect(await b.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    a.c.send({ type: "challenge_reply", challengeId, accept: true }); // người mời không được trả lời
    expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    a.c.send({ type: "challenge_cancel", challengeId: "khong-co" });
    expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });

    a.c.send({ type: "challenge_cancel", challengeId });
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "cancelled" });
    expect(await b.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "cancelled" });
    b.c.send({ type: "challenge_reply", challengeId, accept: true });
    expect(await b.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    await a.c.expectNone((m) => m.type === "match_start");
    expect(server!.matchCount).toBe(0);
  }, 30000);

  it("không hợp lệ -> not_allowed: tự mời mình, đích không có, mỗi người một lời mời", async () => {
    await boot();
    const a = await joinCity("Luật Một", "xu_nu");
    const b = await joinCity("Luật Hai", "xu_nu");
    const c = await joinCity("Luật Ba", "xu_nu");
    const d = await joinCity("Luật Bốn", "xu_nu");
    for (const target of [a.id, 99999]) {
      a.c.send({ type: "challenge", targetEntityId: target });
      expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    }
    a.c.send({ type: "challenge", targetEntityId: b.id });
    await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    a.c.send({ type: "challenge", targetEntityId: c.id }); // a đã có lời mời gửi đi
    expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    c.c.send({ type: "challenge", targetEntityId: b.id }); // b đã có lời mời nhận
    expect(await c.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    b.c.send({ type: "challenge", targetEntityId: d.id }); // b đang có lời mời
    expect(await b.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    d.c.send({ type: "challenge", targetEntityId: a.id }); // a đang có lời mời
    expect(await d.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    d.c.send({ type: "challenge", targetEntityId: c.id }); // hai người rảnh thì được
    await d.c.waitFor("challenge_sent");
  }, 30000);

  it("chưa vào thế giới gửi challenge -> not_allowed", async () => {
    await boot();
    const c = await Client.open(server!.port);
    clients.push(c);
    for (const m of [
      { type: "challenge", targetEntityId: 1 },
      { type: "challenge_reply", challengeId: "x", accept: true },
      { type: "challenge_cancel", challengeId: "x" },
    ]) {
      c.send(m);
      expect(await c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    }
  });
});

describe("thách đấu: unavailable", () => {
  it("người mời rời thành qua cổng: cả hai nhận unavailable, không còn mời được từ ngoài thành", async () => {
    await boot();
    const a = await joinCity("Đi Một", "xu_nu");
    const b = await joinCity("Ở Hai", "xu_nu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    a.c.send({ type: "move_to", x: 28.5, y: 9.5 });
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "unavailable" });
    expect(await b.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "unavailable" });
    expect((await a.c.waitFor("world_state")).mapId).toBe("vung_san_1");
    b.c.send({ type: "challenge_reply", challengeId, accept: true });
    expect(await b.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    // người đang ở vùng săn không mời được
    a.c.send({ type: "challenge", targetEntityId: b.id });
    expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
    expect(server!.matchCount).toBe(0);
  }, 30000);

  it("người nhận rời thành qua cổng: cả hai nhận unavailable", async () => {
    await boot();
    const a = await joinCity("Ở Một", "xu_nu");
    const b = await joinCity("Đi Hai", "xu_nu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    b.c.send({ type: "move_to", x: 28.5, y: 9.5 });
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "unavailable" });
    expect(await b.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "unavailable" });
  }, 30000);

  it("một bên mất kết nối: bên còn lại nhận unavailable và mời lại được người khác", async () => {
    await boot();
    const a = await joinCity("Rớt Một", "xu_nu");
    const b = await joinCity("Rớt Hai", "xu_nu");
    const c = await joinCity("Rớt Ba", "xu_nu");
    a.c.send({ type: "challenge", targetEntityId: b.id });
    const { challengeId } = await a.c.waitFor("challenge_sent");
    await b.c.waitFor("challenge_received");
    b.c.ws.terminate();
    expect(await a.c.waitFor("challenge_closed")).toMatchObject({ challengeId, reason: "unavailable" });
    a.c.send({ type: "challenge", targetEntityId: c.id });
    await a.c.waitFor("challenge_sent");
    // người mời rớt thì người nhận cũng được báo
    a.c.ws.terminate();
    expect(await c.c.waitFor(closed("unavailable"))).toMatchObject({ reason: "unavailable" });
  }, 30000);

  it("mời người đã rớt mạng/rời thành: not_allowed", async () => {
    await boot();
    const a = await joinCity("Mời Một", "xu_nu");
    const b = await joinCity("Đã Đi", "xu_nu");
    b.c.ws.terminate();
    await b.c.waitClosed();
    await new Promise((r) => setTimeout(r, 50));
    a.c.send({ type: "challenge", targetEntityId: b.id });
    expect(await a.c.waitFor("error")).toMatchObject({ code: "not_allowed" });
  }, 30000);
});
