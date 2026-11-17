/**
 * Bộ chạy trận: pha move -> aim -> tính lượt, đồng hồ do máy chủ giữ.
 * Một người chơi đấu quái (PvE, đội 0 đấu đội 1) hoặc hai người chơi đấu nhau (PvP, docs/08).
 */
import { randomBytes } from "node:crypto";
import {
  applyMoves,
  chooseMonsterShot,
  createBattleState,
  previewShot,
  resolveShots,
  validateShot,
  winnerTeam,
} from "./battle/engine.js";
import type { BattleState, MoveCommand, ShotCommand, SignId, Team, Unit } from "./battle/types.js";
import type { Clock } from "./clock.js";
import type { BattleMapDef, GameData, MonsterDef } from "./data.js";
import { PROTOCOL_VERSION, type Character, type ServerMessage, type UnitInfo, type UnitPhaseState } from "./protocol.js";

export interface MatchPlayer {
  name: string;
  /** Cung của nhân vật; quyết định bộ súng và nội tại. */
  sign: string;
  gunId: string;
  send(msg: ServerMessage): void;
  isConnected(): boolean;
}

export type MatchResult = "win" | "lose" | "draw";

interface BaseParams {
  id: string;
  data: GameData;
  clock: Clock;
  /** Seed 32 bit cho mỗi lượt; mặc định lấy từ crypto. */
  seed?: () => number;
  onDone(): void;
}
export interface PveMatchParams extends BaseParams {
  mode?: "pve";
  player: MatchPlayer;
  monster: MonsterDef;
  /** Cập nhật nhân vật theo kết quả; trả nhân vật mới để gửi trong match_end. */
  settle(result: MatchResult, exp: number): Promise<Character>;
}
export interface PvpMatchParams extends BaseParams {
  mode: "pvp";
  /** [người mời (đội 0, bên trái), người nhận (đội 1, bên phải)]. */
  players: [MatchPlayer, MatchPlayer];
  /** Kết quả theo thứ tự `players`; trả nhân vật mới theo cùng thứ tự. */
  settle(results: MatchResult[]): Promise<Character[]>;
}
export type MatchParams = PveMatchParams | PvpMatchParams;

type Phase = "move" | "aim" | "wait" | "ended";

const PREVIEW_WINDOW_MS = 1000;

/** Mỗi người chơi trong trận: đơn vị, lệnh đang chờ, số lượt bỏ lỡ. */
interface Slot {
  unitId: number;
  team: Team;
  player: MatchPlayer;
  missed: number;
  pendingMove: number | null;
  pendingShot: ShotCommand | null;
  previewTimes: number[];
}

export class Match {
  private readonly p: MatchParams;
  private readonly mode: "pve" | "pvp";
  private readonly slots: Slot[] = [];
  private state: BattleState;
  private phase: Phase = "wait";
  private turn = 1;
  private cancel: (() => void) | null = null;
  /** Giờ máy chủ lúc bắt đầu pha ngắm; mốc cho aimElapsedSeconds (không tin giờ client). */
  private aimStartedAt = 0;
  private readonly maxTurns: number;

  constructor(p: MatchParams) {
    this.p = p;
    this.mode = p.mode === "pvp" ? "pvp" : "pve";
    const ch = p.data.character;
    const mkPlayerUnit = (id: number, team: Team, col: number, who: MatchPlayer): Omit<Unit, "y" | "alive"> => {
      const signDef = ch.signDefs[who.sign];
      return {
        id,
        kind: "player",
        name: who.name,
        team,
        col,
        hp: ch.baseHp,
        maxHp: ch.baseHp,
        facing: team === 0 ? 1 : -1,
        gunId: who.gunId,
        guns: [...(signDef?.gunIds ?? []), ...ch.commonGunIds],
        sign: (signDef?.id ?? null) as SignId | null,
        passive: signDef?.passive ?? null,
        energy: ch.energyStart,
        cooldowns: {},
        statuses: [],
      };
    };
    const newSlot = (unitId: number, team: Team, player: MatchPlayer): Slot => ({
      unitId,
      team,
      player,
      missed: 0,
      pendingMove: null,
      pendingShot: null,
      previewTimes: [],
    });

    let map: BattleMapDef;
    let units: Omit<Unit, "y" | "alive">[];
    if (p.mode === "pvp") {
      map = p.data.battleMaps[p.data.settings.pvpBattleMapId]!;
      this.maxTurns = p.data.settings.pvpMaxTurns;
      const [a, b] = p.players;
      units = [mkPlayerUnit(1, 0, map.team0SpawnCols[0]!, a), mkPlayerUnit(2, 1, map.team1SpawnCols[0]!, b)];
      this.slots.push(newSlot(1, 0, a), newSlot(2, 1, b));
    } else {
      map = p.data.battleMaps[p.monster.battleMapId]!;
      this.maxTurns = p.data.settings.maxTurnsPerMatch;
      const monster = p.monster;
      const spawns = map.monsterSpawnCols;
      units = [
        mkPlayerUnit(1, 0, map.playerSpawnCols[0]!, p.player),
        ...Array.from({ length: monster.groupSize }, (_, i) => ({
          id: 2 + i,
          kind: "monster" as const,
          name: monster.name,
          team: 1 as const,
          col: spawns[i]!,
          hp: monster.hp,
          maxHp: monster.hp,
          facing: -1 as const,
          gunId: monster.gunId,
          guns: [monster.gunId],
          sign: null,
          passive: null,
          energy: 0,
          cooldowns: {},
          statuses: [],
          aiErrorTiles: monster.aiErrorTiles,
        })),
      ];
      this.slots.push(newSlot(1, 0, p.player));
    }
    this.state = createBattleState(map, units);
  }

  private broadcast(msg: ServerMessage): void {
    for (const s of this.slots) s.player.send(msg);
  }

  private phaseUnits(): UnitPhaseState[] {
    return this.state.units.map((u) => {
      const s: UnitPhaseState = {
        id: u.id,
        hp: u.hp,
        energy: u.energy,
        cooldowns: { ...u.cooldowns },
        statuses: u.statuses.map((x) => ({ ...x })),
      };
      if (u.kind === "player") s.guns = [...u.guns];
      return s;
    });
  }

  start(): void {
    const s = this.state;
    const units: UnitInfo[] = s.units.map((u) => {
      const info: UnitInfo = {
        id: u.id,
        kind: u.kind,
        name: u.name,
        team: u.team,
        col: u.col,
        y: u.y,
        hp: u.hp,
        maxHp: u.maxHp,
        facing: u.facing,
        energy: u.energy,
        cooldowns: { ...u.cooldowns },
        statuses: u.statuses.map((x) => ({ ...x })),
      };
      if (u.kind === "player") info.guns = [...u.guns];
      return info;
    });
    for (const slot of this.slots) {
      slot.player.send({
        v: PROTOCOL_VERSION,
        type: "match_start",
        matchId: this.p.id,
        mode: this.mode,
        map: { width: s.width, height: s.height, rows: s.rows },
        units,
        you: slot.unitId,
        maxTurns: this.maxTurns,
      });
    }
    this.beginPhase("move");
  }

  abort(): void {
    this.phase = "ended";
    this.cancel?.();
    this.cancel = null;
  }

  handleMove(col: number, who = 0): "ok" | "not_allowed" {
    const slot = this.slots[who];
    if (!slot || this.phase !== "move" || !this.alive(slot)) return "not_allowed";
    slot.pendingMove = col;
    this.endEarlyIfReady();
    return "ok";
  }

  handleShot(angle: number, power: number, facing: -1 | 1, gunId: string, who = 0): "ok" | "not_allowed" {
    const slot = this.slots[who];
    if (!slot || this.phase !== "aim" || !this.alive(slot)) return "not_allowed";
    const cfg = this.p.data.battle;
    const a = Math.max(cfg.aimAngleMinDegrees, Math.min(cfg.aimAngleMaxDegrees, angle));
    const cmd: ShotCommand = {
      unitId: slot.unitId,
      angle: a,
      power,
      facing,
      gunId,
      aimElapsedSeconds: Math.max(0, (this.p.clock.now() - this.aimStartedAt) / 1000),
    };
    if (validateShot(this.state, cmd, this.p.data.guns) !== "ok") return "not_allowed";
    slot.pendingShot = cmd;
    this.endEarlyIfReady();
    return "ok";
  }

  /**
   * Đường ngắm dự đoán (Xử Nữ, có Ngắm chuẩn). "not_allowed": sai pha / không có Ngắm chuẩn / súng không hợp lệ;
   * "dropped": quá giới hạn mỗi giây, bỏ qua lặng lẽ. Chỉ gửi cho người ngắm.
   */
  handlePreview(angle: number, power: number, facing: -1 | 1, gunId: string, who = 0): "ok" | "not_allowed" | "dropped" {
    const slot = this.slots[who];
    if (!slot || this.phase !== "aim") return "not_allowed";
    const me = this.state.units.find((u) => u.id === slot.unitId);
    const gun = this.p.data.guns[gunId];
    if (!me || !me.alive || !gun || gun.kind === "self" || !me.guns.includes(gunId)) return "not_allowed";
    if (!me.statuses.some((s) => s.type === "trueAim")) return "not_allowed";
    const pas = me.passive;
    if (pas?.type !== "precision") return "not_allowed";
    const now = this.p.clock.now();
    slot.previewTimes = slot.previewTimes.filter((t) => now - t < PREVIEW_WINDOW_MS);
    if (slot.previewTimes.length >= pas.aimPreviewPerSecond) return "dropped";
    slot.previewTimes.push(now);
    const cfg = this.p.data.battle;
    const a = Math.max(cfg.aimAngleMinDegrees, Math.min(cfg.aimAngleMaxDegrees, angle));
    const cmd: ShotCommand = { unitId: slot.unitId, angle: a, power, facing, gunId, aimElapsedSeconds: 0 };
    const points = previewShot(this.state, cmd, this.p.data.guns, cfg, pas.aimPreviewFraction);
    slot.player.send({ v: PROTOCOL_VERSION, type: "aim_preview", points });
    return "ok";
  }

  private alive(slot: Slot): boolean {
    return this.state.units.find((u) => u.id === slot.unitId)?.alive === true;
  }

  private submitted(slot: Slot): boolean {
    if (!slot.player.isConnected() || !this.alive(slot)) return true;
    return this.phase === "move" ? slot.pendingMove !== null : slot.pendingShot !== null;
  }

  private allSubmitted(): boolean {
    return this.slots.every((s) => this.submitted(s));
  }

  private endEarlyIfReady(): void {
    if (this.allSubmitted()) this.finishPhase();
  }

  private beginPhase(phase: "move" | "aim"): void {
    this.phase = phase;
    const secs = phase === "move" ? this.p.data.settings.movePhaseSeconds : this.p.data.settings.aimPhaseSeconds;
    const now = this.p.clock.now();
    if (phase === "aim") {
      this.aimStartedAt = now;
      for (const s of this.slots) s.previewTimes = [];
    }
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: "phase",
      turn: this.turn,
      phase,
      deadline: now + secs * 1000,
      serverTime: now,
      units: this.phaseUnits(),
    });
    this.cancel?.();
    this.cancel = this.p.clock.setTimeout(() => this.finishPhase(), secs * 1000);
    // không còn ai để chờ: kết thúc pha ở nhịp kế tiếp (không đệ quy đồng bộ)
    if (this.allSubmitted()) {
      this.cancel();
      this.cancel = this.p.clock.setTimeout(() => this.finishPhase(), 0);
    }
  }

  private finishPhase(): void {
    this.cancel?.();
    this.cancel = null;
    if (this.phase === "move") this.finishMove();
    else if (this.phase === "aim") this.finishAim();
  }

  private finishMove(): void {
    this.phase = "wait";
    const cmds: MoveCommand[] = [];
    for (const s of this.slots) {
      if (s.pendingMove !== null && this.alive(s)) cmds.push({ unitId: s.unitId, col: s.pendingMove });
      s.pendingMove = null;
    }
    const r = applyMoves(this.state, cmds, this.p.data.battle);
    this.state = r.state;
    this.broadcast({ v: PROTOCOL_VERSION, type: "moves_result", turn: this.turn, moves: r.moves });
    this.beginPhase("aim");
  }

  private finishAim(): void {
    this.phase = "wait";
    const cfg = this.p.data.battle;
    const cmds: ShotCommand[] = [];
    for (const s of this.slots) {
      const shot = s.pendingShot;
      s.pendingShot = null;
      if (!this.alive(s)) continue;
      if (shot) {
        cmds.push(shot);
        s.missed = 0;
      } else {
        s.missed++;
      }
    }
    for (const u of this.state.units) {
      if (u.kind === "monster" && u.alive) cmds.push(chooseMonsterShot(this.state, u.id, this.p.data.guns, cfg));
    }
    const seed = (this.p.seed ?? randomSeed)() >>> 0;
    const r = resolveShots(this.state, cmds, this.p.data.guns, cfg, seed);
    this.state = r.state;
    const deaths = [...r.result.deaths];

    // bỏ lỡ quá số lượt cho phép: loại khỏi trận (hp = 0)
    const kicked = this.slots.filter((s) => this.alive(s) && s.missed >= this.p.data.settings.disconnectMissedTurnsToKick);
    let resultUnits = r.result.units;
    if (kicked.length > 0) {
      const ids = new Set(kicked.map((s) => s.unitId));
      this.state = {
        ...this.state,
        units: this.state.units.map((u) => (ids.has(u.id) ? { ...u, hp: 0, alive: false } : u)),
      };
      for (const id of ids) deaths.push(id);
      resultUnits = resultUnits.map((u) => (ids.has(u.id) ? { ...u, hp: 0 } : u));
    }
    this.broadcast({ v: PROTOCOL_VERSION, type: "turn_result", ...r.result, deaths, units: resultUnits });

    const flight = r.result.shots.reduce((m, s) => Math.max(m, s.flightSeconds), 0);
    const waitMs = (flight + this.p.data.settings.replayPaddingSeconds) * 1000;
    const w = this.winner();
    this.cancel = this.p.clock.setTimeout(() => {
      this.cancel = null;
      if (w === null) {
        this.turn = this.state.turn;
        this.beginPhase("move");
      } else {
        void this.end(w);
      }
    }, waitMs);
  }

  /** Đội thắng; trong PvE, người chơi chết thì thua kể cả khi quái chết cùng lượt. */
  private winner(): 0 | 1 | "draw" | null {
    const w = winnerTeam(this.state, this.maxTurns);
    if (w === "draw" && this.mode === "pve" && !this.state.units.some((u) => u.team === 0 && u.alive)) return 1;
    return w;
  }

  private async end(w: 0 | 1 | "draw"): Promise<void> {
    this.phase = "ended";
    const resultOf = (team: Team): MatchResult => (w === "draw" ? "draw" : w === team ? "win" : "lose");
    try {
      const p = this.p;
      if (p.mode === "pvp") {
        const results = this.slots.map((s) => resultOf(s.team));
        const characters = await p.settle(results);
        this.slots.forEach((s, i) => {
          s.player.send({
            v: PROTOCOL_VERSION,
            type: "match_end",
            matchId: p.id,
            result: results[i]!,
            rewards: { exp: 0 },
            character: characters[i]!,
          });
        });
      } else {
        const result = resultOf(0);
        const exp =
          result === "win" ? this.state.units.filter((u) => u.team === 1).reduce((sum) => sum + p.monster.expReward, 0) : 0;
        const character = await p.settle(result, exp);
        this.slots[0]!.player.send({
          v: PROTOCOL_VERSION,
          type: "match_end",
          matchId: p.id,
          result,
          rewards: { exp },
          character,
        });
      }
    } catch (e) {
      console.error("lỗi kết thúc trận", e);
    } finally {
      this.p.onDone();
    }
  }
}

function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}
