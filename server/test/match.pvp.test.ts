import { describe, expect, it } from "vitest";
import type { GameData } from "../src/data.js";
import { Match } from "../src/match.js";
import type { Character, ServerMessage } from "../src/protocol.js";
import { ManualClock, flush, testData } from "./util.js";

interface Side {
  sent: any[];
  connected: boolean;
  of(type: string): any[];
}
interface Harness {
  data: GameData;
  clock: ManualClock;
  match: Match;
  a: Side;
  b: Side;
  state: { done: boolean; settled: Array<[string, string]>; calls: number };
}

const flatArena = (d: GameData): void => {
  const m = d.battleMaps["dau_truong_1"]!;
  m.rows = Array.from({ length: m.height }, (_, r) => (r >= 18 ? "#" : ".").repeat(m.width));
  m.team0SpawnCols = [6];
  m.team1SpawnCols = [10];
};

function harness(tweak: (d: GameData) => void = () => {}, signA = "xu_nu", signB = "kim_nguu"): Harness {
  const data = testData();
  flatArena(data);
  tweak(data);
  const clock = new ManualClock();
  const mkSide = (): Side => {
    const sent: any[] = [];
    return { sent, connected: true, of: (t) => sent.filter((m) => m.type === t) };
  };
  const a = mkSide();
  const b = mkSide();
  const state = { done: false, settled: [] as Array<[string, string]>, calls: 0 };
  const player = (side: Side, name: string, sign: string) => ({
    name,
    sign,
    gunId: data.character.commonGunIds[0]!,
    send: (m: ServerMessage) => void side.sent.push(m),
    isConnected: () => side.connected,
  });
  const match = new Match({
    mode: "pvp",
    id: "p1",
    data,
    clock,
    seed: () => 777,
    players: [player(a, "An", signA), player(b, "Bình", signB)],
    settle: async (results): Promise<Character[]> => {
      state.calls++;
      state.settled.push([results[0]!, results[1]!]);
      const mk = (name: string, sign: string, i: number): Character => ({
        name,
        sign,
        level: 1,
        exp: 0,
        gunId: "g",
        pvp: { wins: results[i] === "win" ? 1 : 0, losses: results[i] === "lose" ? 1 : 0, draws: results[i] === "draw" ? 1 : 0 },
      });
      return [mk("An", signA, 0), mk("Bình", signB, 1)];
    },
    onDone: () => {
      state.done = true;
    },
  });
  return { data, clock, match, a, b, state };
}

async function runUntilDone(h: Harness, stepMs = 500, maxSteps = 4000): Promise<void> {
  for (let i = 0; i < maxSteps && !h.state.done; i++) {
    h.clock.advance(stepMs);
    await flush();
  }
}

async function waitPhase(h: Harness, turn: number, phase: "move" | "aim"): Promise<void> {
  for (let i = 0; i < 400 && !h.a.of("phase").some((p) => p.turn === turn && p.phase === phase); i++) {
    h.clock.advance(500);
    await flush();
  }
}

describe("Match PvP: khởi động", () => {
  it("match_start mode pvp cho từng người, you khác nhau, hai đội đối mặt trên bản đồ đấu trường", () => {
    const h = harness();
    h.match.start();
    const sa = h.a.of("match_start")[0];
    const sb = h.b.of("match_start")[0];
    expect(sa).toMatchObject({ v: 1, mode: "pvp", matchId: "p1", maxTurns: h.data.settings.pvpMaxTurns });
    expect(sb.mode).toBe("pvp");
    expect(sa.you).toBe(1);
    expect(sb.you).toBe(2);
    expect(sa.units).toHaveLength(2);
    expect(sa.units).toEqual(sb.units);
    const [u1, u2] = sa.units;
    expect(u1).toMatchObject({ id: 1, kind: "player", name: "An", team: 0, col: 6, facing: 1, hp: h.data.character.baseHp });
    expect(u2).toMatchObject({ id: 2, kind: "player", name: "Bình", team: 1, col: 10, facing: -1, hp: h.data.character.baseHp });
    expect(u1.guns).toEqual([...h.data.character.signDefs["xu_nu"]!.gunIds, ...h.data.character.commonGunIds]);
    expect(u2.guns).toEqual([...h.data.character.signDefs["kim_nguu"]!.gunIds, ...h.data.character.commonGunIds]);
    expect(u1).toMatchObject({ energy: h.data.character.energyStart });
    expect(h.a.of("phase")[0]).toMatchObject({ turn: 1, phase: "move" });
    expect(h.b.of("phase")[0]).toMatchObject({ turn: 1, phase: "move" });
  });

  it("dùng cột xuất phát thật của dau_truong_1 khi không ghi đè", () => {
    const data = testData();
    const m = data.battleMaps["dau_truong_1"]!;
    const h = harness((d) => {
      d.battleMaps["dau_truong_1"] = m;
    });
    h.match.start();
    const [u1, u2] = h.a.of("match_start")[0].units;
    expect(u1.col).toBe(m.team0SpawnCols[0]);
    expect(u2.col).toBe(m.team1SpawnCols[0]);
  });
});

describe("Match PvP: lệnh theo từng người, kết thúc pha sớm khi mọi người còn kết nối đã gửi", () => {
  it("pha move chỉ kết thúc khi cả hai đã gửi; lệnh mỗi người áp cho đơn vị của mình", () => {
    const h = harness();
    h.match.start();
    expect(h.match.handleMove(8, 0)).toBe("ok");
    expect(h.a.of("moves_result")).toHaveLength(0);
    expect(h.match.handleMove(8, 1)).toBe("ok");
    const mr = h.a.of("moves_result")[0];
    expect(mr.turn).toBe(1);
    expect(mr.moves.map((m: any) => [m.unitId, m.col]).sort()).toEqual([[1, 8], [2, 8]].sort());
    expect(h.b.of("moves_result")).toHaveLength(1);
    expect(h.a.of("phase").at(-1)).toMatchObject({ phase: "aim" });
    expect(h.b.of("phase").at(-1)).toMatchObject({ phase: "aim" });
  });

  it("pha aim: hai phát bắn một lượt, turn_result gửi cho cả hai", () => {
    const h = harness();
    h.match.start();
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    expect(h.match.handleShot(45, 28, 1, "thuoc_no_nho", 0)).toBe("ok");
    expect(h.a.of("turn_result")).toHaveLength(0);
    expect(h.match.handleShot(45, 28, -1, "thuoc_no_nho", 1)).toBe("ok");
    const tr = h.a.of("turn_result")[0];
    expect(tr.shots.map((s: any) => s.unitId).sort()).toEqual([1, 2]);
    expect(h.b.of("turn_result")).toHaveLength(1);
  });

  it("người đã mất kết nối không chặn kết thúc sớm", () => {
    const h = harness();
    h.b.connected = false;
    h.match.start();
    h.match.handleMove(6, 0);
    expect(h.a.of("moves_result")).toHaveLength(1);
  });

  it("người chỉ bắn được bằng súng của mình; chỉ số người ngoài phạm vi -> not_allowed", () => {
    const h = harness();
    h.match.start();
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    // A là Xử Nữ, B là Kim Ngưu: súng của Kim Ngưu không dùng được cho A
    expect(h.match.handleShot(45, 28, 1, "sung_nang", 0)).toBe("not_allowed");
    expect(h.match.handleShot(45, 28, -1, "sung_nang", 1)).toBe("ok");
    expect(h.match.handleShot(45, 28, 1, "thuoc_no_nho", 5)).toBe("not_allowed");
  });

  it("aim_preview chỉ gửi cho người ngắm", async () => {
    const h = harness(undefined, "xu_nu", "kim_nguu");
    h.match.start();
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    h.match.handleShot(45, 50, 1, "sung_kinh", 0); // áp Ngắm chuẩn cho A
    h.match.handleShot(45, 50, -1, "thuoc_no_nho", 1);
    for (let i = 0; i < 200 && !h.a.of("phase").some((p) => p.turn === 2 && p.phase === "move"); i++) {
      h.clock.advance(500);
      await flush();
    }
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    expect(h.match.handlePreview(45, 50, 1, "sung_bang", 0)).toBe("ok");
    expect(h.a.of("aim_preview")).toHaveLength(1);
    expect(h.b.of("aim_preview")).toHaveLength(0);
    expect(h.match.handlePreview(45, 50, -1, "thuoc_no_nho", 1)).toBe("not_allowed");
  });
});

describe("Match PvP: kết thúc", () => {
  const oneHit = (d: GameData): void => {
    d.character.baseHp = 1;
    d.battle.deviationMaxTiles = 0;
    d.battle.critChance = 0;
  };

  it("một bên bắn hạ bên kia: người thắng win, người thua lose, không exp", async () => {
    const h = harness(oneHit);
    h.match.start();
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    h.match.handleShot(45, 28, 1, "thuoc_no_nho", 0); // trúng B; B không bắn
    await runUntilDone(h);
    expect(h.state.settled).toEqual([["win", "lose"]]);
    const ea = h.a.of("match_end")[0];
    const eb = h.b.of("match_end")[0];
    expect(ea).toMatchObject({ v: 1, matchId: "p1", result: "win", rewards: { exp: 0 } });
    expect(eb).toMatchObject({ result: "lose", rewards: { exp: 0 } });
    expect(ea.character).toMatchObject({ name: "An", pvp: { wins: 1 } });
    expect(eb.character).toMatchObject({ name: "Bình", pvp: { losses: 1 } });
    const types = h.a.sent.map((m) => m.type);
    expect(types.indexOf("match_end")).toBeGreaterThan(types.lastIndexOf("turn_result"));
    expect(h.state.done).toBe(true);
  });

  it("đội team 1 thắng được tính win cho người đó", async () => {
    const h = harness(oneHit);
    h.match.start();
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    h.match.handleShot(45, 28, -1, "thuoc_no_nho", 1);
    await runUntilDone(h);
    expect(h.state.settled).toEqual([["lose", "win"]]);
    expect(h.a.of("match_end")[0].result).toBe("lose");
    expect(h.b.of("match_end")[0].result).toBe("win");
  });

  it("cả hai chết cùng lượt -> hòa cho cả hai", async () => {
    const h = harness((d) => {
      oneHit(d);
    });
    h.match.start();
    h.match.handleMove(6, 0);
    h.match.handleMove(10, 1);
    h.match.handleShot(45, 28, 1, "thuoc_no_nho", 0);
    h.match.handleShot(45, 28, -1, "thuoc_no_nho", 1);
    await runUntilDone(h);
    expect(h.state.settled).toEqual([["draw", "draw"]]);
    expect(h.a.of("match_end")[0].result).toBe("draw");
    expect(h.b.of("match_end")[0].result).toBe("draw");
  });

  it("hết pvpMaxTurns thì hòa (maxTurnsPerMatch không áp dụng)", async () => {
    const h = harness((d) => {
      for (const g of Object.values(d.guns)) if (g.kind !== "self") g.damage = 0;
      d.settings.pvpMaxTurns = 2;
      d.settings.maxTurnsPerMatch = 99;
    });
    h.match.start();
    for (let t = 1; t <= 2; t++) {
      for (let i = 0; i < 200 && !h.a.of("phase").some((p) => p.turn === t && p.phase === "move"); i++) {
        h.clock.advance(500);
        await flush();
      }
      h.match.handleMove(6, 0);
      h.match.handleMove(10, 1);
      h.match.handleShot(45, 28, 1, "thuoc_no_nho", 0);
      h.match.handleShot(45, 28, -1, "thuoc_no_nho", 1);
    }
    await runUntilDone(h);
    expect(h.a.of("turn_result")).toHaveLength(2);
    expect(h.state.settled).toEqual([["draw", "draw"]]);
    expect(h.a.of("match_start")[0].maxTurns).toBe(2);
  });

  it("vắng disconnectMissedTurnsToKick lượt liên tiếp: người vắng bị loại và thua, người kia thắng", async () => {
    const h = harness((d) => {
      for (const g of Object.values(d.guns)) if (g.kind !== "self") g.damage = 0;
    });
    h.match.start();
    const kick = h.data.settings.disconnectMissedTurnsToKick;
    for (let t = 1; t <= kick; t++) {
      await waitPhase(h, t, "move");
      h.match.handleMove(6, 0);
      await waitPhase(h, t, "aim"); // B không gửi nên phải chờ hết giờ
      h.match.handleShot(45, 28, 1, "thuoc_no_nho", 0); // B bỏ lượt
    }
    await runUntilDone(h);
    const results = h.a.of("turn_result");
    expect(results).toHaveLength(kick);
    expect(results.at(-1).deaths).toContain(2);
    expect(results.at(-1).deaths).not.toContain(1);
    expect(h.state.settled).toEqual([["win", "lose"]]);
  });

  it("cả hai mất kết nối: bị loại cùng lúc -> hòa", async () => {
    const h = harness((d) => {
      for (const g of Object.values(d.guns)) if (g.kind !== "self") g.damage = 0;
    });
    h.a.connected = false;
    h.b.connected = false;
    h.match.start();
    await runUntilDone(h, 100, 400);
    expect(h.state.done).toBe(true);
    expect(h.state.settled).toEqual([["draw", "draw"]]);
  });

  it("abort dừng mọi timer; settle gọi đúng một lần", async () => {
    const h = harness(oneHit);
    h.match.start();
    h.match.abort();
    expect(h.clock.pending()).toBe(0);
    const h2 = harness(oneHit);
    h2.match.start();
    h2.match.handleMove(6, 0);
    h2.match.handleMove(10, 1);
    h2.match.handleShot(45, 28, 1, "thuoc_no_nho", 0);
    await runUntilDone(h2);
    expect(h2.state.calls).toBe(1);
  });
});
