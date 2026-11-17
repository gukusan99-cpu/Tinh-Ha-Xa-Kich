/** Bộ chạy trận: pha move -> aim -> tính lượt, đồng hồ do máy chủ giữ. */
import { randomBytes } from "node:crypto";
import {
  applyMoves,
  chooseMonsterShot,
  createBattleState,
  outcome,
  resolveShots,
} from "./battle/engine.js";
import type { BattleState, MoveCommand, ShotCommand } from "./battle/types.js";
import type { Clock } from "./clock.js";
import type { GameData, MonsterDef } from "./data.js";
import { PROTOCOL_VERSION, type Character, type ServerMessage, type UnitInfo } from "./protocol.js";

export interface MatchPlayer {
  name: string;
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

export class Match {
  private readonly p: MatchParams;
  private state: BattleState;
  private phase: Phase = "wait";
  private turn = 1;
  private missed = 0;
  private cancel: (() => void) | null = null;
  private pendingMove: number | null = null;
  private pendingShot: ShotCommand | null = null;
  private readonly maxTurns: number;

  constructor(p: MatchParams) {
    this.p = p;
    const map = p.data.battleMaps[p.monster.battleMapId]!;
    this.maxTurns = p.data.settings.maxTurnsPerMatch;
    const units = [
      {
        id: PLAYER_ID,
        kind: "player" as const,
        name: p.player.name,
        team: 0 as const,
        col: map.playerSpawnCols[0]!,
        hp: p.data.character.baseHp,
        maxHp: p.data.character.baseHp,
        facing: 1 as const,
        gunId: p.player.gunId,
      },
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
        aiErrorTiles: p.monster.aiErrorTiles,
      })),
    ];
    this.state = createBattleState(map, units);
  }

  private send(msg: ServerMessage): void {
    this.p.player.send(msg);
  }

  start(): void {
    const s = this.state;
    const units: UnitInfo[] = s.units.map((u) => ({
      id: u.id,
      kind: u.kind,
      name: u.name,
      team: u.team,
      col: u.col,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      facing: u.facing,
    }));
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

  handleShot(angle: number, power: number, facing: -1 | 1): "ok" | "not_allowed" {
    if (this.phase !== "aim" || !this.playerAlive()) return "not_allowed";
    const cfg = this.p.data.battle;
    const a = Math.max(cfg.aimAngleMinDegrees, Math.min(cfg.aimAngleMaxDegrees, angle));
    this.pendingShot = { unitId: PLAYER_ID, angle: a, power, facing };
    this.endEarlyIfReady();
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
    this.send({ v: PROTOCOL_VERSION, type: "phase", turn: this.turn, phase, deadline: now + secs * 1000, serverTime: now });
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
    if (this.playerAlive() && this.missed >= this.p.data.settings.disconnectMissedTurnsToKick) {
      this.state = {
        ...this.state,
        units: this.state.units.map((u) => (u.id === PLAYER_ID ? { ...u, hp: 0, alive: false } : u)),
      };
      deaths.push(PLAYER_ID);
    }
    this.send({ v: PROTOCOL_VERSION, type: "turn_result", ...r.result, deaths });

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
