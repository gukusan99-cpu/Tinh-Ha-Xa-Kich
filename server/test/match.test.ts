import { describe, expect, it } from "vitest";
import type { Character, ServerMessage } from "../src/protocol.js";
import { Match } from "../src/match.js";
import type { GameData } from "../src/data.js";
import { ManualClock, flush, testData } from "./util.js";

interface Harness {
  data: GameData;
  clock: ManualClock;
  match: Match;
  sent: any[];
  state: { connected: boolean; done: boolean; settled: Array<[string, number]> };
  of(type: string): any[];
}

function harness(tweak: (d: GameData) => void = () => {}): Harness {
  const data = testData();
  tweak(data);
  const clock = new ManualClock();
  const sent: any[] = [];
  const state = { connected: true, done: false, settled: [] as Array<[string, number]> };
  const monster = data.monsters["am_thach_nho"]!;
  const match = new Match({
    id: "m1",
    data,
    clock,
    seed: () => 12345,
    player: {
      name: "Bob",
      gunId: data.character.startingGunId,
      send: (m: ServerMessage) => void sent.push(m),
      isConnected: () => state.connected,
    },
    monster,
    settle: async (outcome, exp): Promise<Character> => {
      state.settled.push([outcome, exp]);
      return { name: "Bob", sign: "xu_nu", level: 1, exp, gunId: "g" };
    },
    onDone: () => {
      state.done = true;
    },
  });
  return { data, clock, match, sent, state, of: (t) => sent.filter((m) => m.type === t) };
}

async function runUntilDone(h: Harness, stepMs = 500, maxSteps = 2000): Promise<void> {
  for (let i = 0; i < maxSteps && !h.state.done; i++) {
    h.clock.advance(stepMs);
    await flush();
  }
}

describe("Match: khởi động", () => {
  it("gửi match_start rồi phase move với hạn chót từ dữ liệu", () => {
    const h = harness();
    h.match.start();
    const start = h.of("match_start")[0];
    expect(start).toMatchObject({ v: 1, matchId: "m1", maxTurns: h.data.settings.maxTurnsPerMatch });
    expect(start.map).toMatchObject({ width: 60, height: 30 });
    expect(start.map.rows).toHaveLength(30);
    const units = start.units as any[];
    expect(units).toHaveLength(1 + h.data.monsters["am_thach_nho"]!.groupSize);
    const me = units.find((u) => u.id === start.you);
    expect(me).toMatchObject({ kind: "player", team: 0, col: 6, hp: h.data.character.baseHp, maxHp: h.data.character.baseHp, facing: 1, name: "Bob" });
    expect(me.y).toBe(18); // mặt đất hàng 18
    const ms = units.filter((u) => u.kind === "monster");
    expect(ms.map((u) => u.col)).toEqual([42, 48]);
    const mHp = h.data.monsters["am_thach_nho"]!.hp;
    for (const u of ms) expect(u).toMatchObject({ team: 1, hp: mHp, maxHp: mHp, facing: -1 });
    expect(Object.keys(me).sort()).toEqual(["col", "facing", "hp", "id", "kind", "maxHp", "name", "team", "y"]);
    const ph = h.of("phase")[0];
    expect(ph).toMatchObject({ turn: 1, phase: "move" });
    expect(ph.deadline - ph.serverTime).toBe(h.data.settings.movePhaseSeconds * 1000);
  });
});

describe("Match: lệnh đúng/sai pha", () => {
  it("battle_shot ngoài pha aim -> not_allowed; battle_move ngoài pha move -> not_allowed", () => {
    const h = harness();
    h.match.start();
    expect(h.match.handleShot(45, 50, 1)).toBe("not_allowed");
    expect(h.match.handleMove(8)).toBe("ok");
    // vì chỉ có một người chơi và đã gửi, pha move kết thúc sớm
    expect(h.of("moves_result")).toHaveLength(1);
    expect(h.match.handleMove(9)).toBe("not_allowed");
    expect(h.match.handleShot(45, 50, 1)).toBe("ok");
  });

  it("pha move kết thúc sớm khi người chơi gửi lệnh, moves_result có đường đi", () => {
    const h = harness();
    h.match.start();
    h.match.handleMove(9);
    const mr = h.of("moves_result")[0];
    expect(mr.turn).toBe(1);
    expect(mr.moves).toHaveLength(1);
    expect(mr.moves[0]).toMatchObject({ col: 9, path: [7, 8, 9], y: 18 });
    const phases = h.of("phase");
    expect(phases.map((p) => p.phase)).toEqual(["move", "aim"]);
    expect(phases[1].deadline - phases[1].serverTime).toBe(h.data.settings.aimPhaseSeconds * 1000);
  });

  it("gửi lại battle_move trong pha move: lệnh sau thay lệnh trước (người chơi duy nhất nên kết thúc ngay)", () => {
    const h = harness();
    h.data.settings.movePhaseSeconds = 15;
    h.match.start();
    expect(h.match.handleMove(7)).toBe("ok");
    expect(h.of("moves_result")[0].moves[0].col).toBe(7);
  });

  it("battle_shot hợp lệ -> turn_result đủ hình dạng, angle bị kẹp", () => {
    const h = harness();
    h.match.start();
    h.match.handleMove(6);
    expect(h.match.handleShot(500, 50, 1)).toBe("ok"); // 500 độ bị kẹp về 80
    const tr = h.of("turn_result")[0];
    expect(tr).toMatchObject({ v: 1, type: "turn_result", turn: 1 });
    for (const k of ["shots", "explosions", "damage", "falls", "deaths"]) expect(Array.isArray(tr[k])).toBe(true);
    expect(tr.shots).toHaveLength(1 + h.data.monsters["am_thach_nho"]!.groupSize); // người + mỗi quái
    const shot = tr.shots[0];
    for (const k of ["unitId", "points", "impact", "hitUnitId", "crit", "flightSeconds"]) expect(k in shot).toBe(true);
  });
});

describe("Match: hạn chót và kick", () => {
  it("hết giờ mà chưa có lệnh: không di chuyển, không bắn", () => {
    const h = harness((d) => (d.guns["thuoc_no_nho"]!.damage = 0));
    h.match.start();
    h.clock.advance(h.data.settings.movePhaseSeconds * 1000 - 1);
    expect(h.of("moves_result")).toHaveLength(0);
    h.clock.advance(1);
    expect(h.of("moves_result")[0].moves).toEqual([]);
    h.clock.advance(h.data.settings.aimPhaseSeconds * 1000);
    const tr = h.of("turn_result")[0];
    expect(tr.shots.map((s: any) => s.unitId).sort()).not.toContain(1); // người chơi không bắn
  });

  it("vắng disconnectMissedTurnsToKick lượt liên tiếp thì bị loại; trận kết thúc thua, exp 0", async () => {
    const h = harness((d) => (d.guns["thuoc_no_nho"]!.damage = 0));
    h.match.start();
    await runUntilDone(h, 1000);
    expect(h.state.done).toBe(true);
    const results = h.of("turn_result");
    expect(results).toHaveLength(h.data.settings.disconnectMissedTurnsToKick);
    expect(results[results.length - 1].deaths).toContain(h.of("match_start")[0].you);
    expect(h.state.settled).toEqual([["lose", 0]]);
    expect(h.of("match_end")[0]).toMatchObject({ matchId: "m1", result: "lose", rewards: { exp: 0 } });
  });

  it("bắn mỗi lượt thì không bị kick", async () => {
    const h = harness((d) => {
      d.guns["thuoc_no_nho"]!.damage = 0;
      d.settings.maxTurnsPerMatch = 5;
    });
    h.match.start();
    for (let t = 0; t < 5; t++) {
      expect(h.match.handleMove(6)).toBe("ok");
      expect(h.match.handleShot(45, 50, 1)).toBe("ok");
      for (let i = 0; i < 40; i++) {
        h.clock.advance(1000);
        await flush();
        if (h.of("phase").filter((p) => p.phase === "move").length > t + 1 || h.state.done) break;
      }
    }
    await runUntilDone(h, 1000);
    expect(h.of("match_end")[0].result).toBe("draw");
    expect(h.state.settled).toEqual([["draw", 0]]);
  });
});

describe("Match: kết thúc", () => {
  it("thắng: exp bằng tổng expReward của quái", async () => {
    const h = harness((d) => {
      d.monsters["am_thach_nho"]!.hp = 1;
      d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [10, 12];
      d.battle.deviationMaxTiles = 0;
      d.battle.critChance = 0;
      d.character.baseHp = 1000;
    });
    h.match.start();
    h.match.handleMove(6);
    h.match.handleShot(45, 28, 1);
    await runUntilDone(h, 500);
    const exp = 2 * h.data.monsters["am_thach_nho"]!.expReward;
    expect(h.state.settled).toEqual([["win", exp]]);
    const end = h.of("match_end")[0];
    expect(end).toMatchObject({ v: 1, matchId: "m1", result: "win", rewards: { exp } });
    expect(end.character).toMatchObject({ name: "Bob" });
    expect(h.state.done).toBe(true);
  });

  it("match_end chỉ gửi sau turn_result cuối", async () => {
    const h = harness((d) => {
      d.monsters["am_thach_nho"]!.hp = 1;
      d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [10, 12];
      d.battle.deviationMaxTiles = 0;
      d.battle.critChance = 0;
      d.character.baseHp = 1000;
    });
    h.match.start();
    h.match.handleMove(6);
    h.match.handleShot(45, 28, 1);
    expect(h.of("match_end")).toHaveLength(0);
    await runUntilDone(h, 500);
    const types = h.sent.map((m) => m.type);
    expect(types.indexOf("match_end")).toBeGreaterThan(types.lastIndexOf("turn_result"));
  });

  it("người chơi mất kết nối vẫn ở lại trận, không cần lệnh, không chờ hạn chót", async () => {
    const h = harness((d) => (d.guns["thuoc_no_nho"]!.damage = 0));
    h.state.connected = false;
    h.match.start();
    await runUntilDone(h, 100, 200); // tối đa 20 giây mô phỏng, ít hơn một pha move
    expect(h.state.done).toBe(true);
    expect(h.state.settled[0]![0]).toBe("lose");
  });

  it("abort dừng mọi timer", () => {
    const h = harness();
    h.match.start();
    h.match.abort();
    expect(h.clock.pending()).toBe(0);
  });
});
