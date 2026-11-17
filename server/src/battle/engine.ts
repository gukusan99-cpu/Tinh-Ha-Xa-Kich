/**
 * Engine trận: hàm thuần, tất định theo seed (docs/06-kien-truc.md, "Luật vật lý trận";
 * docs/07-cung-va-sung.md cho súng, nội tại, hiệu ứng).
 * Không I/O, không timer, không sửa đầu vào.
 */
import type {
  BattleConfig,
  BattleState,
  DamageEvent,
  Explosion,
  FallEvent,
  GunStats,
  KnockbackEvent,
  MatchOutcome,
  MoveCommand,
  ShotCommand,
  ShotResult,
  Status,
  StatusEvent,
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

function cloneStatus(s: Status): Status {
  return { ...s };
}

function cloneUnit(u: Unit): Unit {
  return {
    ...u,
    guns: [...u.guns],
    cooldowns: { ...u.cooldowns },
    statuses: u.statuses.map(cloneStatus),
  };
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
    units: units.map((u) => ({ ...cloneUnit({ ...u, y: 0, alive: true }), y: surfaceRow(rows, u.col), alive: true })),
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
    let range = cfg.moveRangeTiles;
    const stunned = u.statuses.some((s) => s.type === "stun");
    for (const s of u.statuses) if (s.type === "slow") range = Math.max(0, range - s.tiles);
    if (stunned) range = 0;
    const steps = Math.min(Math.abs(target - u.col), range);
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
  angleDeg: number,
  powerRaw: number,
  facingRaw: number,
  cfg: BattleConfig,
): { v: number; vx: number; vy: number; angle: number; x0: number; y0: number } {
  const angle = clamp(angleDeg, cfg.aimAngleMinDegrees, cfg.aimAngleMaxDegrees);
  const power = clamp(powerRaw, 0, 100);
  const facing = facingRaw < 0 ? -1 : 1;
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

// ---------- trạng thái ----------

function statusValue(s: Status): number {
  switch (s.type) {
    case "burn":
      return s.damagePerTurn;
    case "slow":
      return s.tiles;
    case "shield":
      return s.amount;
    default:
      return 0;
  }
}

/** true nếu `a` mạnh hơn `b`: nhiều lượt hơn, hoặc bằng lượt thì trị số lớn hơn. */
function stronger(a: Status, b: Status): boolean {
  return a.turns > b.turns || (a.turns === b.turns && statusValue(a) > statusValue(b));
}

function capTurns(s: Status, cfg: BattleConfig): Status {
  const c = cloneStatus(s);
  if (c.type === "burn") c.turns = Math.min(c.turns, cfg.burnMaxTurns);
  else if (c.type === "slow") c.turns = Math.min(c.turns, cfg.slowMaxTurns);
  else if (c.type === "stun") c.turns = Math.min(c.turns, cfg.stunMaxTurns);
  return c;
}

/**
 * Áp hiệu ứng lên đơn vị. `fresh` ghi các (đơn vị, loại) đã nhận hiệu ứng trong lượt này:
 * hai nguồn trong cùng lượt thì giữ cái mạnh hơn; hiệu ứng cũ từ lượt trước luôn bị thay.
 */
function applyStatus(u: Unit, s: Status, fresh: Set<string>, cfg: BattleConfig): Status {
  const capped = capTurns(s, cfg);
  const key = `${u.id}:${s.type}`;
  const i = u.statuses.findIndex((x) => x.type === s.type);
  if (i < 0) {
    u.statuses.push(capped);
    fresh.add(key);
    return cloneStatus(capped);
  }
  const old = u.statuses[i]!;
  if (!fresh.has(key) || stronger(capped, old)) {
    u.statuses[i] = capped;
    fresh.add(key);
    return cloneStatus(capped);
  }
  return cloneStatus(old);
}

// ---------- kiểm tra lệnh bắn ----------

export function validateShot(
  state: BattleState,
  cmd: ShotCommand,
  guns: Record<string, GunStats>,
): "ok" | "not_allowed" {
  const u = state.units.find((x) => x.id === cmd.unitId);
  if (!u || !u.alive) return "not_allowed";
  if (!u.guns.includes(cmd.gunId)) return "not_allowed";
  const gun = guns[cmd.gunId];
  if (!gun) return "not_allowed";
  if (u.kind === "player") {
    if (u.energy < gun.energyCost) return "not_allowed";
    if ((u.cooldowns[gun.id] ?? 0) > 0) return "not_allowed";
  }
  return "ok";
}

// ---------- tính lượt bắn ----------

interface Planned {
  unitId: number;
  gun: GunStats;
  shotIndex: number;
  raw: FlightOut;
  /** giây từ đầu pha bắn tới lúc nổ */
  time: number;
  seq: number;
  crit: boolean;
  dmgMult: number;
  dig: number;
}

function deviationFor(u: Unit, gun: GunStats, hadTrueAim: boolean, cfg: BattleConfig): number {
  if (hadTrueAim) return 0;
  let d = u.kind === "monster" && u.aiErrorTiles !== undefined ? u.aiErrorTiles : cfg.deviationMaxTiles;
  const p = u.passive;
  if (p?.type === "precision") {
    d *= 1 - p.deviationReduction;
    if (gun.sign !== null && gun.sign === u.sign) d *= 1 - p.lineBonus;
  }
  return d;
}

function damageMultiplier(u: Unit, gun: GunStats, cmd: ShotCommand): number {
  const p = u.passive;
  const own = gun.sign !== null && gun.sign === u.sign;
  let bonus = 0;
  if (p?.type === "earlyShot" && cmd.aimElapsedSeconds <= p.earlyShotSeconds) {
    bonus += p.earlyShotDamageBonus + (own ? p.lineBonus : 0);
  }
  if (p?.type === "meteorPush" && own && gun.kind !== "shower") bonus += p.lineBonus;
  return 1 + bonus;
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
  const fresh = new Set<string>();

  // mỗi đơn vị một lệnh (lệnh cuối thắng), xử lý theo unitId tăng dần; lệnh sai bị bỏ qua
  const latest = new Map<number, ShotCommand>();
  for (const c of cmds) latest.set(c.unitId, c);
  const ordered = [...latest.values()]
    .sort((a, b) => a.unitId - b.unitId)
    .filter((c) => validateShot(state, c, guns) === "ok");

  const hadTrueAim = new Set<number>();
  for (const u of state.units) if (u.statuses.some((s) => s.type === "trueAim")) hadTrueAim.add(u.id);
  /** Đơn vị đã bắn một súng thuộc đúng cung của mình lượt này (dòng riêng Kim Ngưu). */
  const firedOwnSign = new Set<number>();

  // chi phí & hồi chiêu ghi nhận ngay khi lệnh hợp lệ
  for (const cmd of ordered) {
    const u = byId.get(cmd.unitId)!;
    const gun = guns[cmd.gunId]!;
    if (gun.sign !== null && gun.sign === u.sign) firedOwnSign.add(u.id);
  }

  // 1. hiệu ứng self, áp trước mọi vụ nổ
  const selfEffects: StatusEvent[] = [];
  for (const cmd of ordered) {
    const gun = guns[cmd.gunId]!;
    if (gun.kind !== "self" || !gun.selfEffect) continue;
    const u = byId.get(cmd.unitId)!;
    const eff = gun.selfEffect;
    const st: Status =
      eff.type === "shield"
        ? { type: "shield", turns: 1, amount: eff.amount }
        : { type: "trueAim", turns: eff.turns };
    selfEffects.push({ unitId: u.id, sourceUnitId: u.id, status: applyStatus(u, st, fresh, cfg) });
  }

  // 2. quỹ đạo, tính trên địa hình và vị trí đầu pha
  const shots: ShotResult[] = [];
  const planned: Planned[] = [];
  const startState: BattleState = { ...state, units: state.units };
  let seq = 0;
  for (const cmd of ordered) {
    const u = byId.get(cmd.unitId)!;
    const gun = guns[cmd.gunId]!;
    if (gun.kind === "self") continue;
    const d = deviationFor(u, gun, hadTrueAim.has(u.id), cfg);
    const dmgMult = damageMultiplier(u, gun, cmd);
    const digs = u.passive?.type === "meteorPush" ? u.passive.digBelowOnHit : 0;

    const count = gun.kind === "burst" ? Math.max(1, gun.count ?? 1) : 1;
    let rootIndex: number | null = null;
    for (let i = 0; i < count; i++) {
      const off = gun.kind === "burst" ? (gun.powerOffsets?.[i] ?? 0) : 0;
      const l = launch(u, cmd.angle, cmd.power + off, cmd.facing, cfg);
      const offset = (rng() * 2 - 1) * d;
      const T = Math.max(0.5, (2 * l.v * Math.sin(Math.max(l.angle, 10) * DEG)) / cfg.gravityTilesPerSec2);
      const vx = l.vx + offset / T;
      const crit = rng() < cfg.critChance;
      const f = simulate(startState, { x0: l.x0, y0: l.y0, vx, vy: l.vy, shooterId: u.id }, cfg, true);
      const shotIndex = shots.length;
      shots.push({
        unitId: u.id,
        gunId: gun.id,
        parentIndex: rootIndex,
        points: f.points,
        impact: f.impact ? { x: round2(f.impact.x), y: round2(f.impact.y) } : null,
        hitUnitId: f.hitUnitId,
        crit: gun.kind === "shower" ? false : crit,
        flightSeconds: round2(f.flightSeconds),
      });
      if (rootIndex === null) rootIndex = shotIndex;
      if (gun.kind === "shower") {
        // viên dẫn đường: không nổ; sao băng rơi tại điểm chạm
        if (f.impact) {
          const stones = Math.max(1, (gun.count ?? 1) + (u.passive?.type === "meteorPush" && gun.sign === u.sign ? u.passive.lineBonusStones : 0));
          const spread = gun.spreadTiles ?? 0;
          for (let k = 0; k < stones; k++) {
            const x = stones === 1 ? f.impact.x : f.impact.x - spread + (2 * spread * k) / (stones - 1);
            const sc = rng() < cfg.critChance;
            const sf = simulate(startState, { x0: x, y0: 0, vx: 0, vy: 0, shooterId: -1 }, cfg, true);
            const idx = shots.length;
            const total = f.flightSeconds + sf.flightSeconds;
            shots.push({
              unitId: u.id,
              gunId: gun.id,
              parentIndex: shotIndex,
              points: sf.points,
              impact: sf.impact ? { x: round2(sf.impact.x), y: round2(sf.impact.y) } : null,
              hitUnitId: sf.hitUnitId,
              crit: sc,
              flightSeconds: round2(total),
            });
            if (sf.impact) {
              planned.push({ unitId: u.id, gun, shotIndex: idx, raw: sf, time: total, seq: seq++, crit: sc, dmgMult, dig: digs });
            }
          }
        }
      } else if (f.impact) {
        planned.push({ unitId: u.id, gun, shotIndex, raw: f, time: f.flightSeconds, seq: seq++, crit, dmgMult, dig: digs });
      }
    }
  }

  const impacts = [...planned].sort((a, b) => a.time - b.time || a.unitId - b.unitId || a.seq - b.seq);

  const rows = state.rows.map((r) => r.split(""));
  const explosions: Explosion[] = [];
  const damage: DamageEvent[] = [];
  const shieldAbsorbed: { unitId: number; amount: number }[] = [];
  interface Pending {
    unitId: number;
    sourceUnitId: number;
    gun: GunStats;
    x: number;
  }
  const pending: Pending[] = [];

  // 3. nổ
  for (const p of impacts) {
    const { x, y } = p.raw.impact as { x: number; y: number };
    const gun = p.gun;
    const radius = gun.blastRadiusTiles;
    const depth = gun.craterDepthTiles ?? 0;
    const removed: [number, number][] = [];
    const c0 = Math.max(0, Math.floor(x - radius - 1));
    const c1 = Math.min(state.width - 1, Math.ceil(x + radius + 1));
    const r0 = Math.max(0, Math.floor(y - radius - 1));
    const r1 = Math.min(state.height - 1, Math.ceil(y + radius + 1 + depth));
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = c0; c <= c1; c++) {
        if (row[c] !== "#") continue;
        const dy = r + 0.5 - y;
        const dyEff = dy > 0 ? Math.max(0, dy - depth) : dy;
        if (Math.hypot(c + 0.5 - x, dyEff) <= radius) {
          row[c] = ".";
          removed.push([c, r]);
        }
      }
    }
    const shot = shots[p.shotIndex]!;
    if (p.dig > 0 && shot.hitUnitId !== null) {
      const hu = byId.get(shot.hitUnitId);
      if (hu && hu.y >= 0) {
        for (let k = 0; k < p.dig; k++) {
          const row = rows[hu.y + k];
          if (row && row[hu.col] === "#") {
            row[hu.col] = ".";
            removed.push([hu.col, hu.y + k]);
          }
        }
      }
    }
    explosions.push({ unitId: p.unitId, x: round2(x), y: round2(y), radius, removedTiles: removed });

    const mult = (p.crit ? cfg.critMultiplier : 1) * p.dmgMult;
    for (const u of units) {
      if (!u.alive || u.hp <= 0) continue;
      const dist = shot.hitUnitId === u.id ? 0 : Math.hypot(x - (u.col + 0.5), y - (u.y - cfg.unitRadiusTiles));
      let reduction = 0;
      if (u.passive?.type === "toughness") {
        reduction = u.passive.damageTakenReduction + (firedOwnSign.has(u.id) ? u.passive.lineBonus : 0);
      }
      let amount = Math.round(
        gun.damage * mult * Math.max(0, 1 - dist / (radius + cfg.unitRadiusTiles)) * Math.max(0, 1 - reduction),
      );
      if (amount <= 0) continue;
      const sh = u.statuses.find((s) => s.type === "shield");
      if (sh && sh.type === "shield" && sh.amount > 0) {
        const absorb = Math.min(sh.amount, amount);
        sh.amount -= absorb;
        amount -= absorb;
        shieldAbsorbed.push({ unitId: u.id, amount: absorb });
      }
      if (amount <= 0) continue;
      u.hp = Math.max(0, u.hp - amount);
      damage.push({ unitId: u.id, sourceUnitId: p.unitId, amount, hpAfter: u.hp });
      pending.push({ unitId: u.id, sourceUnitId: p.unitId, gun, x });
    }
  }

  const newRows = rows.map((r) => r.join(""));

  // 4. hiệu ứng khi trúng
  const statusEvents: StatusEvent[] = [];
  for (const e of pending) {
    const u = byId.get(e.unitId)!;
    if (u.hp <= 0) continue;
    const add = (st: Status): void => {
      statusEvents.push({ unitId: u.id, sourceUnitId: e.sourceUnitId, status: applyStatus(u, st, fresh, cfg) });
    };
    if (e.gun.burn) add({ type: "burn", turns: e.gun.burn.turns, damagePerTurn: e.gun.burn.damagePerTurn });
    if (e.gun.slow) add({ type: "slow", turns: e.gun.slow.turns, tiles: e.gun.slow.tiles });
    if (e.gun.stun) add({ type: "stun", turns: e.gun.stun.turns });
  }

  // 5. đẩy lùi
  const knockbacks: KnockbackEvent[] = [];
  for (const e of pending) {
    const tiles = e.gun.knockbackTiles ?? 0;
    const u = byId.get(e.unitId)!;
    if (tiles <= 0 || u.hp <= 0) continue;
    const away = Math.sign(u.col + 0.5 - e.x);
    const dir = away !== 0 ? away : -u.facing;
    const from = u.col;
    for (let i = 0; i < tiles; i++) {
      const n = u.col + dir;
      if (n < 0 || n >= state.width) break;
      if (solidAt(newRows, n, u.y)) {
        let r = u.y;
        while (r - 1 >= 0 && solidAt(newRows, n, r - 1)) r--;
        if (u.y - r > cfg.maxClimbTiles) break;
        u.y = r;
      }
      u.col = n;
    }
    if (u.col !== from) knockbacks.push({ unitId: u.id, fromCol: from, toCol: u.col });
  }

  // 6. rơi
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

  // 7. cháy (không qua khiên và giảm sát thương; sourceUnitId = 0: không rõ nguồn)
  const burnTicks: DamageEvent[] = [];
  for (const u of units) {
    if (!u.alive || u.hp <= 0) continue;
    const b = u.statuses.find((s) => s.type === "burn");
    if (!b || b.type !== "burn") continue;
    u.hp = Math.max(0, u.hp - b.damagePerTurn);
    burnTicks.push({ unitId: u.id, sourceUnitId: 0, amount: b.damagePerTurn, hpAfter: u.hp });
  }

  // 8. giảm thời lượng (cháy luôn giảm; hiệu ứng khác nhận trong lượt này giữ nguyên tới lượt kế)
  for (const u of units) {
    u.statuses = u.statuses
      .map((s) => (s.type === "burn" || !fresh.has(`${u.id}:${s.type}`) ? { ...s, turns: s.turns - 1 } : s))
      .filter((s) => s.turns > 0 && !(s.type === "shield" && s.amount <= 0));
  }

  // 9. chết
  for (const u of units) if (u.alive && u.hp <= 0) deaths.add(u.id);
  for (const u of units) if (deaths.has(u.id)) u.alive = false;

  // 10. nội lực và hồi chiêu (chỉ người chơi)
  for (const u of units) {
    if (u.kind !== "player") continue;
    for (const k of Object.keys(u.cooldowns)) {
      const v = (u.cooldowns[k] ?? 0) - 1;
      if (v > 0) u.cooldowns[k] = v;
      else delete u.cooldowns[k];
    }
  }
  for (const cmd of ordered) {
    const u = byId.get(cmd.unitId)!;
    if (u.kind !== "player") continue;
    const gun = guns[cmd.gunId]!;
    u.energy -= gun.energyCost;
    if (gun.cooldownTurns > 0) u.cooldowns[gun.id] = gun.cooldownTurns;
  }
  for (const u of units) {
    if (u.kind === "player" && u.alive) u.energy = Math.min(cfg.energyMax, u.energy + cfg.energyRegenPerTurn);
  }

  return {
    state: { ...state, rows: newRows, units, turn: state.turn + 1 },
    result: {
      turn: state.turn,
      selfEffects,
      shots,
      explosions,
      damage,
      shieldAbsorbed,
      statusEvents,
      knockbacks,
      falls,
      burnTicks,
      deaths: [...deaths].sort((a, b) => a - b),
      units: units.map((u) => ({
        id: u.id,
        hp: u.hp,
        energy: u.energy,
        cooldowns: { ...u.cooldowns },
        statuses: u.statuses.map(cloneStatus),
      })),
    },
  };
}

/**
 * Quỹ đạo dự đoán (Súng kính): không lệch, trên địa hình hiện tại, chỉ phần đầu `fraction` thời gian bay.
 * Dùng góc, lực, hướng của lệnh; không tính độ lệch hay `powerOffsets`.
 */
export function previewShot(
  state: BattleState,
  cmd: ShotCommand,
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
  fraction: number,
): [number, number][] {
  void guns;
  const u = state.units.find((x) => x.id === cmd.unitId);
  if (!u || !u.alive) return [];
  const l = launch(u, cmd.angle, cmd.power, cmd.facing, cfg);
  const f = simulate(state, { x0: l.x0, y0: l.y0, vx: l.vx, vy: l.vy, shooterId: u.id }, cfg, true);
  const n = Math.min(f.points.length, Math.max(2, Math.floor(clamp(fraction, 0, 1) * (f.points.length - 1)) + 1));
  return f.points.slice(0, n);
}

/** Điểm chạm của một phát không lệch (dùng cho bot và AI): không sinh quỹ đạo. */
export function probeShot(
  state: BattleState,
  unitId: number,
  angle: number,
  power: number,
  facing: -1 | 1,
  cfg: BattleConfig,
): { impact: { x: number; y: number } | null; hitUnitId: number | null; flightSeconds: number } | null {
  const u = state.units.find((x) => x.id === unitId);
  if (!u) return null;
  const l = launch(u, angle, power, facing, cfg);
  const f = simulate(state, { x0: l.x0, y0: l.y0, vx: l.vx, vy: l.vy, shooterId: u.id }, cfg, false);
  return { impact: f.impact, hitUnitId: f.hitUnitId, flightSeconds: f.flightSeconds };
}

export function chooseMonsterShot(
  state: BattleState,
  unitId: number,
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
): ShotCommand {
  void guns;
  const me = state.units.find((u) => u.id === unitId);
  const gunId = me?.gunId ?? "";
  const fallback: ShotCommand = { unitId, angle: 45, power: 50, facing: me?.facing ?? -1, gunId, aimElapsedSeconds: 0 };
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
          bestCmd = { unitId, angle, power, facing, gunId, aimElapsedSeconds: 0 };
        }
      }
    }
  }
  return bestCmd;
}

/**
 * Đội thắng: 0 hoặc 1 khi đội kia hết người sống; "draw" khi cả hai hết người cùng lúc
 * hoặc khi state.turn > maxTurns; null khi chưa kết thúc.
 */
export function winnerTeam(state: BattleState, maxTurns: number): 0 | 1 | "draw" | null {
  const a = state.units.some((u) => u.team === 0 && u.alive);
  const b = state.units.some((u) => u.team === 1 && u.alive);
  if (!a && !b) return "draw";
  if (!b) return 0;
  if (!a) return 1;
  if (state.turn > maxTurns) return "draw";
  return null;
}

/** Góc nhìn đội 0 (PvE): "lose" khi không còn người chơi sống, kể cả khi quái cũng chết cùng lượt. */
export function outcome(state: BattleState, maxTurns: number): MatchOutcome {
  const players = state.units.some((u) => u.team === 0 && u.alive);
  const monsters = state.units.some((u) => u.team === 1 && u.alive);
  if (!players) return "lose";
  if (!monsters) return "win";
  if (state.turn > maxTurns) return "draw";
  return null;
}
