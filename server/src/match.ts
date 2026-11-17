/** Bộ chạy trận: pha move -> aim -> tính lượt, đồng hồ do máy chủ giữ. */
import { randomBytes } from "node:crypto";
import {
  applyMoves,
  chooseMonsterShot,
  createBattleState,
  outcome,
  previewShot,
  resolveShots,
  validateShot,
} from "./battle/engine.js";
import type { BattleState, MoveCommand, ShotCommand, SignId, Unit } from "./battle/types.js";
import type { Clock } from "./clock.js";
import type { GameData, MonsterDef } from "./data.js";
import { PROTOCOL_VERSION, type Character, type ServerMessage, type UnitInfo, type UnitPhaseState } from "./protocol.js";

export interface MatchPlayer {
  name: string;
  /** Cung của nhân vật; quyết định bộ súng và nội tại. */
  sign: string;
  gunId: string;
  send(msg: ServerMessage): void;
  isConnected(): boolean;
}

export interface MatchParams {
  id: string;
  data: GameData;
  clock: Clock;
  /** Seed 32 bit cho mỗi lượt; mặc định lấy từ crypto. */
  seed?: () => number;
  player: MatchPlayer;
  monster: MonsterDef;
  /** Cập nhật nhân vật theo kết quả; trả nhân vật mới để gửi trong match_end. */
  settle(result: "win" | "lose" | "draw", exp: number): Promise<Character>;
  onDone(): void;
}

type Phase = "move" | "aim" | "wait" | "ended";

const PLAYER_ID = 1;
const PREVIEW_WINDOW_MS = 1000;

export class Match {
  private readonly p: MatchParams;
  private state: BattleState;
  private phase: Phase = "wait";
  private turn = 1;
  private missed = 0;
  private cancel: (() => void) | null = null;
  private pendingMove: number | null = null;
  private pendingShot: ShotCommand | null = null;
  /** Giờ máy chủ lúc bắt đầu pha ngắm; mốc cho aimElapsedSeconds (không tin giờ client). */
  private aimStartedAt = 0;
  private previewTimes: number[] = [];
  private readonly maxTurns: number;

  constructor(p: MatchParams) {
    this.p = p;
    const map = p.data.battleMaps[p.monster.battleMapId]!;
    this.maxTurns = p.data.settings.maxTurnsPerMatch;
    const ch = p.data.character;
    const signDef = ch.signDefs[p.player.sign];
    const playerUnit: Omit<Unit, "y" | "alive"> = {
      id: PLAYER_ID,
      kind: "player",
      name: p.player.name,
      team: 0,
      col: map.playerSpawnCols[0]!,
      hp: ch.baseHp,
      maxHp: ch.baseHp,
      facing: 1,
      gunId: p.player.gunId,
      guns: [...(signDef?.gunIds ?? []), ...ch.commonGunIds],
      sign: (signDef?.id ?? null) as SignId | null,
      passive: signDef?.passive ?? null,
      energy: ch.energyStart,
      cooldowns: {},
      statuses: [],
    };
    const units: Omit<Unit, "y" | "alive">[] = [
      playerUnit,
      ...Array.from({ length: p.monster.groupSize }, (_, i) => ({
        id: PLAYER_ID + 1 + i,
        kind: "monster" as const,
        name: p.monster.name,
        team: 1 as const,
        col: map.monsterSpawnCols[i]!,
        hp: p.monster.hp,
        maxHp: p.monster.hp,
        facing: -1 as const,
        gunId: p.monster.gunId,
        guns: [p.monster.gunId],
        sign: null,
        passive: null,
        energy: 0,
        cooldowns: {},
        statuses: [],
        aiErrorTiles: p.monster.aiErrorTiles,
      })),
    ];
    this.state = createBattleState(map, units);
  }

  private send(msg: ServerMessage): void {
    this.p.player.send(msg);
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
    this.send({
      v: PROTOCOL_VERSION,
      type: "match_start",
      matchId: this.p.id,
      map: { width: s.width, height: s.height, rows: s.rows },
      units,
      you: PLAYER_ID,
      maxTurns: this.maxTurns,
    });
    this.beginPhase("move");
  }

  abort(): void {
    this.phase = "ended";
    this.cancel?.();
    this.cancel = null;
  }

  handleMove(col: number): "ok" | "not_allowed" {
    if (this.phase !== "move" || !this.playerAlive()) return "not_allowed";
    this.pendingMove = col;
    this.endEarlyIfReady();
    return "ok";
  }

  handleShot(angle: number, power: number, facing: -1 | 1, gunId: string): "ok" | "not_allowed" {
    if (this.phase !== "aim" || !this.playerAlive()) return "not_allowed";
    const cfg = this.p.data.battle;
    const a = Math.max(cfg.aimAngleMinDegrees, Math.min(cfg.aimAngleMaxDegrees, angle));
    const cmd: ShotCommand = {
      unitId: PLAYER_ID,
      angle: a,
      power,
      facing,
      gunId,
      aimElapsedSeconds: Math.max(0, (this.p.clock.now() - this.aimStartedAt) / 1000),
    };
    if (validateShot(this.state, cmd, this.p.data.guns) !== "ok") return "not_allowed";
    this.pendingShot = cmd;
    this.endEarlyIfReady();
    return "ok";
  }

  /**
   * Đường ngắm dự đoán (Xử Nữ, có Ngắm chuẩn). "not_allowed": sai pha / không có Ngắm chuẩn / súng không hợp lệ;
   * "dropped": quá giới hạn mỗi giây, bỏ qua lặng lẽ.
   */
  handlePreview(angle: number, power: number, facing: -1 | 1, gunId: string): "ok" | "not_allowed" | "dropped" {
    if (this.phase !== "aim") return "not_allowed";
    const me = this.state.units.find((u) => u.id === PLAYER_ID);
    const gun = this.p.data.guns[gunId];
    if (!me || !me.alive || !gun || gun.kind === "self" || !me.guns.includes(gunId)) return "not_allowed";
    if (!me.statuses.some((s) => s.type === "trueAim")) return "not_allowed";
    const pas = me.passive;
    if (pas?.type !== "precision") return "not_allowed";
    const now = this.p.clock.now();
    this.previewTimes = this.previewTimes.filter((t) => now - t < PREVIEW_WINDOW_MS);
    if (this.previewTimes.length >= pas.aimPreviewPerSecond) return "dropped";
    this.previewTimes.push(now);
    const cfg = this.p.data.battle;
    const a = Math.max(cfg.aimAngleMinDegrees, Math.min(cfg.aimAngleMaxDegrees, angle));
    const cmd: ShotCommand = { unitId: PLAYER_ID, angle: a, power, facing, gunId, aimElapsedSeconds: 0 };
    const points = previewShot(this.state, cmd, this.p.data.guns, cfg, pas.aimPreviewFraction);
    this.send({ v: PROTOCOL_VERSION, type: "aim_preview", points });
    return "ok";
  }

  private playerAlive(): boolean {
    return this.state.units.find((u) => u.id === PLAYER_ID)?.alive === true;
  }

  private submitted(): boolean {
    if (!this.p.player.isConnected() || !this.playerAlive()) return true;
    return this.phase === "move" ? this.pendingMove !== null : this.pendingShot !== null;
  }

  private endEarlyIfReady(): void {
    if (this.submitted()) this.finishPhase();
  }

  private beginPhase(phase: "move" | "aim"): void {
    this.phase = phase;
    const secs = phase === "move" ? this.p.data.settings.movePhaseSeconds : this.p.data.settings.aimPhaseSeconds;
    const now = this.p.clock.now();
    if (phase === "aim") {
      this.aimStartedAt = now;
      this.previewTimes = [];
    }
    this.send({
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
    if (this.submitted()) {
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
    if (this.pendingMove !== null && this.playerAlive()) cmds.push({ unitId: PLAYER_ID, col: this.pendingMove });
    this.pendingMove = null;
    const r = applyMoves(this.state, cmds, this.p.data.battle);
    this.state = r.state;
    this.send({ v: PROTOCOL_VERSION, type: "moves_result", turn: this.turn, moves: r.moves });
    this.beginPhase("aim");
  }

  private finishAim(): void {
    this.phase = "wait";
    const cfg = this.p.data.battle;
    const cmds: ShotCommand[] = [];
    const playerShot = this.pendingShot;
    this.pendingShot = null;
    if (this.playerAlive()) {
      if (playerShot) {
        cmds.push(playerShot);
        this.missed = 0;
      } else {
        this.missed++;
      }
    }
    for (const u of this.state.units) {
      if (u.team === 1 && u.alive) cmds.push(chooseMonsterShot(this.state, u.id, this.p.data.guns, cfg));
    }
    const seed = (this.p.seed ?? randomSeed)() >>> 0;
    const r = resolveShots(this.state, cmds, this.p.data.guns, cfg, seed);
    this.state = r.state;
    const deaths = [...r.result.deaths];

    // bỏ lỡ quá số lượt cho phép: loại khỏi trận (hp = 0)
    let resultUnits = r.result.units;
    if (this.playerAlive() && this.missed >= this.p.data.settings.disconnectMissedTurnsToKick) {
      this.state = {
        ...this.state,
        units: this.state.units.map((u) => (u.id === PLAYER_ID ? { ...u, hp: 0, alive: false } : u)),
      };
      deaths.push(PLAYER_ID);
      resultUnits = resultUnits.map((u) => (u.id === PLAYER_ID ? { ...u, hp: 0 } : u));
    }
    this.send({ v: PROTOCOL_VERSION, type: "turn_result", ...r.result, deaths, units: resultUnits });

    const flight = r.result.shots.reduce((m, s) => Math.max(m, s.flightSeconds), 0);
    const waitMs = (flight + this.p.data.settings.replayPaddingSeconds) * 1000;
    const res = outcome(this.state, this.maxTurns);
    this.cancel = this.p.clock.setTimeout(() => {
      this.cancel = null;
      if (res === null) {
        this.turn = this.state.turn;
        this.beginPhase("move");
      } else {
        void this.end(res);
      }
    }, waitMs);
  }

  private async end(result: "win" | "lose" | "draw"): Promise<void> {
    this.phase = "ended";
    const exp =
      result === "win"
        ? this.state.units.filter((u) => u.team === 1).reduce((sum) => sum + this.p.monster.expReward, 0)
        : 0;
    try {
      const character = await this.p.settle(result, exp);
      this.send({
        v: PROTOCOL_VERSION,
        type: "match_end",
        matchId: this.p.id,
        result,
        rewards: { exp },
        character,
      });
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
