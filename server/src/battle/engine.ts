/**
 * Engine trận: hàm thuần, tất định theo seed (docs/06-kien-truc.md, "Luật vật lý trận").
 * Không I/O, không timer, không sửa đầu vào.
 */
import type {
  BattleConfig,
  BattleState,
  DamageEvent,
  Explosion,
  FallEvent,
  GunStats,
  MatchOutcome,
  MoveCommand,
  ShotCommand,
  ShotResult,
  TurnResult,
  Unit,
  UnitMove,
} from "./types.js";

const DEG = Math.PI / 180;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function solidAt(rows: readonly string[], c: number, r: number): boolean {
  return rows[r]?.[c] === "#";
}

function surfaceRow(rows: readonly string[], c: number, from = 0): number {
  for (let r = Math.max(0, from); r < rows.length; r++) if (solidAt(rows, c, r)) return r;
  return -1;
}

function cloneUnit(u: Unit): Unit {
  return { ...u };
}

export function createBattleState(
  map: { width: number; height: number; rows: string[] },
  units: Omit<Unit, "y" | "alive">[],
): BattleState {
  const rows = [...map.rows];
  return {
    width: map.width,
    height: map.height,
    rows,
    units: units.map((u) => ({ ...u, y: surfaceRow(rows, u.col), alive: true })),
    turn: 1,
  };
}

export function applyMoves(
  state: BattleState,
  cmds: MoveCommand[],
  cfg: BattleConfig,
): { state: BattleState; moves: UnitMove[] } {
  const units = state.units.map(cloneUnit);
  const moves: UnitMove[] = [];
  const sorted = [...cmds].sort((a, b) => a.unitId - b.unitId);
  for (const cmd of sorted) {
    const u = units.find((x) => x.id === cmd.unitId);
    if (!u || !u.alive) continue;
    const target = Math.max(0, Math.min(state.width - 1, Math.trunc(cmd.col)));
    const dir = Math.sign(target - u.col);
    const steps = Math.min(Math.abs(target - u.col), cfg.moveRangeTiles);
    const path: number[] = [];
    for (let i = 0; i < steps; i++) {
      const n = u.col + dir;
      let ny: number;
      if (solidAt(state.rows, n, u.y)) {
        let r = u.y;
        while (r - 1 >= 0 && solidAt(state.rows, n, r - 1)) r--;
        if (u.y - r > cfg.maxClimbTiles) break;
        ny = r;
      } else {
        ny = surfaceRow(state.rows, n, u.y);
        if (ny < 0) break; // hố không đáy: không bước vào
      }
      u.col = n;
      u.y = ny;
      path.push(n);
    }
    moves.push({ unitId: u.id, path, col: u.col, y: u.y });
  }
  return { state: { ...state, rows: [...state.rows], units }, moves };
}

interface FlightParams {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  shooterId: number;
}

interface FlightOut {
  points: [number, number][];
  impact: { x: number; y: number } | null;
  hitUnitId: number | null;
  flightSeconds: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function simulate(
  state: BattleState,
  p: FlightParams,
  cfg: BattleConfig,
  wantPoints: boolean,
): FlightOut {
  const dt = 1 / cfg.simHz;
  const maxSteps = Math.floor(cfg.maxFlightSeconds * cfg.simHz);
  const every = Math.max(1, Math.round(cfg.simHz / cfg.trajectorySampleHz));
  const r2 = cfg.unitRadiusTiles * cfg.unitRadiusTiles;
  const points: [number, number][] = [];
  if (wantPoints) points.push([round2(p.x0), round2(p.y0)]);
  const targets = state.units.filter((u) => u.alive);
  const g = cfg.gravityTilesPerSec2;
  const { rows, width, height } = state;

  let x = p.x0;
  let y = p.y0;
  let lastPushed = 0;
  let k = 1;
  for (; k <= maxSteps; k++) {
    const t = k * dt;
    x = p.x0 + p.vx * t;
    y = p.y0 + p.vy * t + 0.5 * g * t * t;
    const out = x < 0 || x >= width || y >= height;
    let hit: number | null = null;
    let landed = false;
    if (!out) {
      for (const u of targets) {
        if (u.id === p.shooterId && t <= cfg.selfHitGraceSeconds) continue;
        const dx = x - (u.col + 0.5);
        const dy = y - (u.y - cfg.unitRadiusTiles);
        if (dx * dx + dy * dy <= r2) {
          hit = u.id;
          break;
        }
      }
      if (hit === null && y >= 0 && solidAt(rows, Math.floor(x), Math.floor(y))) landed = true;
    }
    if (out || hit !== null || landed) {
      if (wantPoints) points.push([round2(x), round2(y)]);
      return {
        points,
        impact: out ? null : { x, y },
        hitUnitId: hit,
        flightSeconds: t,
      };
    }
    if (wantPoints && k % every === 0) {
      points.push([round2(x), round2(y)]);
      lastPushed = k;
    }
  }
  // hết thời gian bay: coi như bay ra ngoài
  if (wantPoints && lastPushed !== maxSteps) points.push([round2(x), round2(y)]);
  return { points, impact: null, hitUnitId: null, flightSeconds: Math.min(maxSteps, k - 1) * dt };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function launch(
  u: Unit,
  cmd: ShotCommand,
  cfg: BattleConfig,
): { v: number; vx: number; vy: number; angle: number; x0: number; y0: number } {
  const angle = clamp(cmd.angle, cfg.aimAngleMinDegrees, cfg.aimAngleMaxDegrees);
  const power = clamp(cmd.power, 0, 100);
  const facing = cmd.facing < 0 ? -1 : 1;
  const v = (power / 100) * cfg.maxProjectileSpeedTilesPerSec;
  return {
    v,
    vx: facing * v * Math.cos(angle * DEG),
    vy: -v * Math.sin(angle * DEG),
    angle,
    x0: u.col + 0.5,
    y0: u.y - cfg.unitRadiusTiles,
  };
}

export function resolveShots(
  state: BattleState,
  cmds: ShotCommand[],
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
  seed: number,
): { state: BattleState; result: TurnResult } {
  const rng = mulberry32(seed);
  const units = state.units.map(cloneUnit);
  const byId = new Map(units.map((u) => [u.id, u]));

  // mỗi đơn vị một lệnh (lệnh cuối thắng), xử lý theo unitId tăng dần
  const latest = new Map<number, ShotCommand>();
  for (const c of cmds) latest.set(c.unitId, c);
  const ordered = [...latest.values()].sort((a, b) => a.unitId - b.unitId);

  interface Planned {
    unitId: number;
    shot: ShotResult;
    gun: GunStats;
  }
  const planned: Planned[] = [];
  const startState: BattleState = { ...state, units: state.units }; // địa hình & vị trí đầu pha
  for (const cmd of ordered) {
    const u = byId.get(cmd.unitId);
    if (!u || !u.alive) continue;
    const gun = guns[u.gunId];
    if (!gun) continue;
    const l = launch(u, cmd, cfg);
    const d = u.kind === "monster" && u.aiErrorTiles !== undefined ? u.aiErrorTiles : cfg.deviationMaxTiles;
    const offset = (rng() * 2 - 1) * d;
    const T = Math.max(0.5, (2 * l.v * Math.sin(Math.max(l.angle, 10) * DEG)) / cfg.gravityTilesPerSec2);
    const vx = l.vx + offset / T;
    const crit = rng() < cfg.critChance;
    const f = simulate(startState, { x0: l.x0, y0: l.y0, vx, vy: l.vy, shooterId: u.id }, cfg, true);
    planned.push({
      unitId: u.id,
      gun,
      shot: {
        unitId: u.id,
        points: f.points,
        impact: f.impact ? { x: round2(f.impact.x), y: round2(f.impact.y) } : null,
        hitUnitId: f.hitUnitId,
        crit,
        flightSeconds: round2(f.flightSeconds),
      },
    });
    // lưu thời điểm chính xác và điểm nổ chính xác để sắp xếp / nổ
    (planned[planned.length - 1] as Planned & { raw?: FlightOut }).raw = f;
  }

  const impacts = planned
    .filter((p) => p.shot.impact !== null)
    .map((p) => ({ p, raw: (p as Planned & { raw: FlightOut }).raw }))
    .sort((a, b) => a.raw.flightSeconds - b.raw.flightSeconds || a.p.unitId - b.p.unitId);

  const rows = state.rows.map((r) => r.split(""));
  const explosions: Explosion[] = [];
  const damage: DamageEvent[] = [];

  for (const { p, raw } of impacts) {
    const { x, y } = raw.impact as { x: number; y: number };
    const radius = p.gun.blastRadiusTiles;
    const removed: [number, number][] = [];
    const c0 = Math.max(0, Math.floor(x - radius - 1));
    const c1 = Math.min(state.width - 1, Math.ceil(x + radius + 1));
    const r0 = Math.max(0, Math.floor(y - radius - 1));
    const r1 = Math.min(state.height - 1, Math.ceil(y + radius + 1));
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = c0; c <= c1; c++) {
        if (row[c] === "#" && Math.hypot(c + 0.5 - x, r + 0.5 - y) <= radius) {
          row[c] = ".";
          removed.push([c, r]);
        }
      }
    }
    explosions.push({ unitId: p.unitId, x: round2(x), y: round2(y), radius, removedTiles: removed });

    const mult = p.shot.crit ? cfg.critMultiplier : 1;
    for (const u of units) {
      if (!u.alive || u.hp <= 0) continue;
      const dist =
        p.shot.hitUnitId === u.id
          ? 0
          : Math.hypot(x - (u.col + 0.5), y - (u.y - cfg.unitRadiusTiles));
      const amount = Math.round(p.gun.damage * mult * Math.max(0, 1 - dist / (radius + cfg.unitRadiusTiles)));
      if (amount <= 0) continue;
      u.hp = Math.max(0, u.hp - amount);
      damage.push({ unitId: u.id, sourceUnitId: p.unitId, amount, hpAfter: u.hp });
    }
  }

  const newRows = rows.map((r) => r.join(""));
  const deaths = new Set<number>();
  for (const u of units) if (u.alive && u.hp <= 0) deaths.add(u.id);

  const falls: FallEvent[] = [];
  for (const u of units) {
    if (!u.alive || u.hp <= 0) continue;
    if (solidAt(newRows, u.col, u.y)) continue;
    const ny = surfaceRow(newRows, u.col, u.y);
    if (ny < 0) {
      u.y = -1;
      u.hp = 0;
      deaths.add(u.id);
      falls.push({ unitId: u.id, y: -1 });
    } else {
      u.y = ny;
      falls.push({ unitId: u.id, y: ny });
    }
  }
  for (const u of units) if (deaths.has(u.id)) u.alive = false;

  return {
    state: { ...state, rows: newRows, units, turn: state.turn + 1 },
    result: {
      turn: state.turn,
      shots: planned.map((p) => p.shot),
      explosions,
      damage,
      falls,
      deaths: [...deaths].sort((a, b) => a - b),
    },
  };
}

export function chooseMonsterShot(
  state: BattleState,
  unitId: number,
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
): ShotCommand {
  void guns;
  const me = state.units.find((u) => u.id === unitId);
  const fallback: ShotCommand = { unitId, angle: 45, power: 50, facing: me?.facing ?? -1 };
  if (!me) return fallback;
  let target: Unit | null = null;
  let best = Infinity;
  for (const u of state.units) {
    if (u.team === me.team || !u.alive) continue;
    const d = Math.abs(u.col - me.col);
    if (d < best) {
      best = d;
      target = u;
    }
  }
  if (!target) return fallback;
  const tx = target.col + 0.5;
  const ty = target.y - cfg.unitRadiusTiles;

  let bestCmd = fallback;
  let bestDist = Infinity;
  const x0 = me.col + 0.5;
  const y0 = me.y - cfg.unitRadiusTiles;
  const step = cfg.aiAngleStepDegrees;
  for (const facing of [-1, 1] as const) {
    for (let angle = step; angle <= cfg.aimAngleMaxDegrees; angle += step) {
      if (angle < cfg.aimAngleMinDegrees) continue;
      for (let power = 10; power <= 100; power += 5) {
        const v = (power / 100) * cfg.maxProjectileSpeedTilesPerSec;
        const f = simulate(
          state,
          {
            x0,
            y0,
            vx: facing * v * Math.cos(angle * DEG),
            vy: -v * Math.sin(angle * DEG),
            shooterId: me.id,
          },
          cfg,
          false,
        );
        if (!f.impact) continue;
        const dist = f.hitUnitId === target.id ? 0 : Math.hypot(f.impact.x - tx, f.impact.y - ty);
        if (dist < bestDist) {
          bestDist = dist;
          bestCmd = { unitId, angle, power, facing };
        }
      }
    }
  }
  return bestCmd;
}

export function outcome(state: BattleState, maxTurns: number): MatchOutcome {
  const players = state.units.some((u) => u.team === 0 && u.alive);
  const monsters = state.units.some((u) => u.team === 1 && u.alive);
  if (!players) return "lose";
  if (!monsters) return "win";
  if (state.turn > maxTurns) return "draw";
  return null;
}
