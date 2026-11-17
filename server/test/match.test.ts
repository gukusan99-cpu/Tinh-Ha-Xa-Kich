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

function harness(tweak: (d: GameData) => void = () => {}, sign = "xu_nu", turnSeed = 12345): Harness {
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
    seed: () => turnSeed,
    player: {
      name: "Bob",
      sign,
      gunId: data.character.commonGunIds[0]!,
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
    expect(Object.keys(me).sort()).toEqual([
      "col", "cooldowns", "energy", "facing", "guns", "hp", "id", "kind", "maxHp", "name", "statuses", "team", "y",
    ]);
    expect(me).toMatchObject({ energy: h.data.character.energyStart, cooldowns: {}, statuses: [] });
    expect(me.guns).toEqual([...h.data.character.signDefs["xu_nu"]!.gunIds, ...h.data.character.commonGunIds]);
    for (const m of ms) expect(m.guns).toBeUndefined();
    const ph = h.of("phase")[0];
    expect(ph).toMatchObject({ turn: 1, phase: "move" });
    expect(ph.deadline - ph.serverTime).toBe(h.data.settings.movePhaseSeconds * 1000);
  });
});

describe("Match: lệnh đúng/sai pha", () => {
  it("battle_shot ngoài pha aim -> not_allowed; battle_move ngoài pha move -> not_allowed", () => {
    const h = harness();
    h.match.start();
    expect(h.match.handleShot(45, 50, 1, "thuoc_no_nho")).toBe("not_allowed");
    expect(h.match.handleMove(8)).toBe("ok");
    // vì chỉ có một người chơi và đã gửi, pha move kết thúc sớm
    expect(h.of("moves_result")).toHaveLength(1);
    expect(h.match.handleMove(9)).toBe("not_allowed");
    expect(h.match.handleShot(45, 50, 1, "thuoc_no_nho")).toBe("ok");
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
    expect(h.match.handleShot(500, 50, 1, "thuoc_no_nho")).toBe("ok"); // 500 độ bị kẹp về 80
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
      expect(h.match.handleShot(45, 50, 1, "thuoc_no_nho")).toBe("ok");
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
    h.match.handleShot(45, 28, 1, "thuoc_no_nho");
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
    h.match.handleShot(45, 28, 1, "thuoc_no_nho");
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

const nearMonsters = (d: GameData): void => {
  d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [10, 12];
  d.battle.deviationMaxTiles = 0;
  d.battle.critChance = 0;
  d.character.baseHp = 100000;
};

/** Chạy tới pha move của lượt `turn` (đã gửi phase). */
async function toMovePhase(h: Harness, turn: number): Promise<void> {
  for (let i = 0; i < 200 && !h.of("phase").some((p) => p.phase === "move" && p.turn === turn); i++) {
    h.clock.advance(500);
    await flush();
  }
}

describe("Match: Giai đoạn 2 (súng, nội lực, nội tại)", () => {
  it("phase gửi kèm trạng thái đơn vị: nội lực, hồi chiêu, trạng thái, súng (chỉ người chơi)", () => {
    const h = harness(undefined, "kim_nguu");
    h.match.start();
    const ph = h.of("phase")[0];
    expect(ph.units).toHaveLength(3);
    const me = ph.units.find((u: any) => u.id === 1);
    expect(me).toMatchObject({ hp: h.data.character.baseHp, energy: h.data.character.energyStart, cooldowns: {}, statuses: [] });
    expect(me.guns).toEqual(["sung_tieu_lien", "khien_dan", "sung_nang", "thuoc_no_nho"]);
    expect(ph.units.filter((u: any) => u.id !== 1).every((u: any) => u.guns === undefined && u.energy === 0)).toBe(true);
  });

  it("battle_shot với súng ngoài bộ, không tồn tại, thiếu nội lực -> not_allowed", () => {
    const h = harness((d) => (d.character.energyStart = 1), "xu_nu");
    h.match.start();
    h.match.handleMove(6);
    expect(h.match.handleShot(45, 50, 1, "phao_dan_no")).toBe("not_allowed"); // súng của cung khác
    expect(h.match.handleShot(45, 50, 1, "khong_co")).toBe("not_allowed");
    expect(h.match.handleShot(45, 50, 1, "dan_lanh")).toBe("not_allowed"); // cần 2 nội lực, có 1
    expect(h.of("turn_result")).toHaveLength(0);
    expect(h.match.handleShot(45, 50, 1, "sung_bang")).toBe("ok");
  });

  it("nội lực và hồi chiêu cập nhật trong turn_result và phase kế tiếp", async () => {
    const h = harness(nearMonsters, "kim_nguu");
    h.match.start();
    h.match.handleMove(6);
    expect(h.match.handleShot(45, 28, 1, "sung_nang")).toBe("ok"); // cost 2, cooldown 1
    const tr = h.of("turn_result")[0];
    const regen = h.data.battle.energyRegenPerTurn;
    expect(tr.units.find((u: any) => u.id === 1)).toMatchObject({
      energy: h.data.character.energyStart - 2 + regen,
      cooldowns: { sung_nang: 1 },
    });
    expect(tr.shots[0]).toMatchObject({ gunId: "sung_nang", parentIndex: null });
    for (const k of ["selfEffects", "shieldAbsorbed", "statusEvents", "knockbacks", "burnTicks"]) expect(Array.isArray(tr[k])).toBe(true);
    await toMovePhase(h, 2);
    const ph = h.of("phase").find((p) => p.turn === 2 && p.phase === "move");
    expect(ph.units.find((u: any) => u.id === 1)).toMatchObject({ cooldowns: { sung_nang: 1 } });
    h.match.handleMove(6);
    expect(h.match.handleShot(45, 28, 1, "sung_nang")).toBe("not_allowed"); // còn hồi chiêu
    expect(h.match.handleShot(45, 28, 1, "thuoc_no_nho")).toBe("ok");
  });

  it("aimElapsedSeconds tính từ đầu pha ngắm theo giờ máy chủ: Bạch Dương bắn sớm mạnh hơn", async () => {
    const dmg = async (waitMs: number): Promise<number> => {
      const h = harness(nearMonsters, "bach_duong");
      h.match.start();
      h.match.handleMove(6);
      h.clock.advance(waitMs);
      h.match.handleShot(45, 28, 1, "phao_dan_no"); // 40 sát thương, đúng cung
      await flush();
      const tr = h.of("turn_result")[0];
      return Math.max(...tr.damage.filter((d: any) => d.sourceUnitId === 1).map((d: any) => d.amount));
    };
    const early = await dmg(5_000);
    const late = await dmg(12_000);
    expect(early).toBe(Math.round(40 * 1.25));
    expect(late).toBe(40);
  });

  it("aim_preview: chỉ khi có Ngắm chuẩn, giới hạn mỗi giây, bỏ qua lặng lẽ phần vượt", async () => {
    const h = harness(
      (d) => {
        nearMonsters(d);
        d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [40, 45];
      },
      "xu_nu",
    );
    h.match.start();
    expect(h.match.handlePreview(45, 50, 1, "sung_bang")).toBe("not_allowed"); // sai pha
    h.match.handleMove(6);
    expect(h.match.handlePreview(45, 50, 1, "sung_bang")).toBe("not_allowed"); // chưa có Ngắm chuẩn
    expect(h.match.handleShot(45, 50, 1, "sung_kinh")).toBe("ok"); // self: áp Ngắm chuẩn cho lượt sau
    await toMovePhase(h, 2);
    h.match.handleMove(6);
    expect(h.of("phase").at(-1)).toMatchObject({ turn: 2, phase: "aim" });
    expect(h.of("phase").at(-1).units.find((u: any) => u.id === 1).statuses).toEqual([{ type: "trueAim", turns: 1 }]);

    expect(h.match.handlePreview(45, 50, 1, "sung_kinh")).toBe("not_allowed"); // súng self
    expect(h.match.handlePreview(45, 50, 1, "phao_dan_no")).toBe("not_allowed"); // ngoài bộ
    const limit = h.data.character.signDefs["xu_nu"]!.passive.type === "precision" ? (h.data.character.signDefs["xu_nu"]!.passive as any).aimPreviewPerSecond : 0;
    const results = Array.from({ length: limit + 3 }, () => h.match.handlePreview(45, 50, 1, "sung_bang"));
    expect(results.filter((r) => r === "ok")).toHaveLength(limit);
    expect(results.filter((r) => r === "dropped")).toHaveLength(3);
    const prev = h.of("aim_preview");
    expect(prev).toHaveLength(limit);
    expect(prev[0]).toMatchObject({ v: 1, type: "aim_preview" });
    expect(prev[0].points.length).toBeGreaterThan(2);
    // sang giây mới thì lại được
    h.clock.advance(1000);
    expect(h.match.handlePreview(45, 50, 1, "sung_bang")).toBe("ok");
  });

  it("phát bắn sau Ngắm chuẩn không lệch (bất kể seed)", async () => {
    const impacts: number[] = [];
    for (const seed of [1, 2, 3]) {
      const h = harness(
        (d) => {
          nearMonsters(d);
          d.battle.deviationMaxTiles = 3;
          d.monsters["am_thach_nho"]!.aiErrorTiles = 0; // địa hình sau lượt 1 giống nhau ở mọi seed
          d.battleMaps["dong_am_thach_1"]!.monsterSpawnCols = [40, 45];
        },
        "xu_nu",
        seed,
      );
      h.match.start();
      h.match.handleMove(6);
      h.match.handleShot(45, 50, 1, "sung_kinh");
      await toMovePhase(h, 2);
      h.match.handleMove(6);
      h.match.handleShot(45, 50, 1, "sung_bang");
      const tr = h.of("turn_result")[1];
      impacts.push(tr.shots.find((s: any) => s.unitId === 1).impact.x);
    }
    expect(new Set(impacts).size).toBe(1);
  });
});
