/**
 * Engine trận: hàm thuần, tất định theo seed (docs/06-kien-truc.md, "Luật vật lý trận";
 * docs/07-cung-va-sung.md cho súng, nội tại, hiệu ứng).
 * Không I/O, không timer, không sửa đầu vào.
 */
import type {
  BattleConfig,
  BattleState,
  ChainHit,
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
  Zone,
  ZoneInfo,
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
    zones: [],
    nextZoneId: 1,
  };
}

/** Dạng gửi qua mạng của các vũng đang tồn tại. */
export function zoneInfos(state: BattleState): ZoneInfo[] {
  return state.zones.map((z) => ({ id: z.id, x: round2(z.x), y: round2(z.y), radius: z.radius, turnsLeft: z.turnsLeft, active: z.active }));
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
    let range = u.moveRangeTiles ?? cfg.moveRangeTiles;
    const stunned = u.statuses.some((s) => s.type === "stun" || s.type === "root");
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

// ---------- tia (laser) ----------

/** Bước lấy mẫu dọc tia (ô). Độ phân giải số học, không phải số cân bằng. */
const BEAM_STEP = 0.05;

export interface BeamTrace {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** true nếu bị đất chặn (đã xuyên hết pierceTiles). */
  blocked: boolean;
  /** Đơn vị địch (khác đội người bắn) mà tia đi qua, theo thứ tự từ gần tới xa. */
  hits: { unitId: number; dist: number }[];
}

/**
 * Tia thẳng từ tâm thân người bắn, không chịu trọng lực. Hướng: góc nâng `angle` (đã kẹp) về phía `facing`,
 * xoay thêm atan(offsetTiles / beamLengthTiles) (độ lệch ô -> góc; offset dương nâng tia lên).
 * Đi tối đa beamLengthTiles; mỗi ô đất mới đi vào tính một; vào ô đất thứ pierceTiles+1 thì dừng ngay trước ô đó.
 * Dừng khi ra ngoài bản đồ. Không phá đất. Đơn vị địch bị trúng nếu tâm cách đoạn tia ≤ unitRadius.
 */
export function traceBeam(
  state: BattleState,
  u: Unit,
  gun: GunStats,
  angleDeg: number,
  facingRaw: number,
  offsetTiles: number,
  cfg: BattleConfig,
): BeamTrace {
  const len = gun.beamLengthTiles ?? 0;
  const pierce = gun.pierceTiles ?? 0;
  const angle = clamp(angleDeg, cfg.aimAngleMinDegrees, cfg.aimAngleMaxDegrees);
  const facing = facingRaw < 0 ? -1 : 1;
  const theta = angle * DEG + (len > 0 ? Math.atan(offsetTiles / len) : 0);
  const dx = facing * Math.cos(theta);
  const dy = -Math.sin(theta);
  const x0 = u.col + 0.5;
  const y0 = u.y - cfg.unitRadiusTiles;
  let endT = len;
  let blocked = false;
  let solids = 0;
  let lastKey = `${Math.floor(x0)},${Math.floor(y0)}`;
  for (let k = 1; k * BEAM_STEP <= len; k++) {
    const t = k * BEAM_STEP;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) {
      endT = t - BEAM_STEP;
      break;
    }
    const key = `${Math.floor(x)},${Math.floor(y)}`;
    if (key === lastKey) continue;
    lastKey = key;
    if (solidAt(state.rows, Math.floor(x), Math.floor(y))) {
      solids++;
      if (solids > pierce) {
        endT = t - BEAM_STEP;
        blocked = true;
        break;
      }
    }
  }
  endT = Math.max(0, endT);
  const hits: { unitId: number; dist: number; along: number }[] = [];
  for (const t of state.units) {
    if (!t.alive || t.hp <= 0 || t.team === u.team) continue;
    const cx = t.col + 0.5 - x0;
    const cy = t.y - cfg.unitRadiusTiles - y0;
    const along = clamp(cx * dx + cy * dy, 0, endT);
    const dist = Math.hypot(cx - dx * along, cy - dy * along);
    if (dist <= cfg.unitRadiusTiles + 1e-9) hits.push({ unitId: t.id, dist, along });
  }
  hits.sort((a, b) => a.along - b.along || a.unitId - b.unitId);
  return {
    from: { x: x0, y: y0 },
    to: { x: x0 + dx * endT, y: y0 + dy * endT },
    blocked,
    hits: hits.map((h) => ({ unitId: h.unitId, dist: h.dist })),
  };
}

// ---------- trạng thái ----------

function statusValue(s: Status): number {
  switch (s.type) {
    case "burn":
    case "poison":
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
  else if (c.type === "poison") c.turns = Math.min(c.turns, cfg.poisonMaxTurns);
  else if (c.type === "root") c.turns = Math.min(c.turns, cfg.rootMaxTurns);
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
  const beamPlans: { unitId: number; gun: GunStats; trace: BeamTrace; crit: boolean; dmgMult: number }[] = [];
  for (const cmd of ordered) {
    const u = byId.get(cmd.unitId)!;
    const gun = guns[cmd.gunId]!;
    if (gun.kind === "self") continue;
    const d = deviationFor(u, gun, hadTrueAim.has(u.id), cfg);
    const dmgMult = damageMultiplier(u, gun, cmd);
    const digs = u.passive?.type === "meteorPush" ? u.passive.digBelowOnHit : 0;

    if (gun.kind === "beam") {
      const offset = (rng() * 2 - 1) * d;
      const crit = rng() < cfg.critChance;
      const tr = traceBeam(startState, u, gun, cmd.angle, cmd.facing, offset, cfg);
      shots.push({
        unitId: u.id,
        gunId: gun.id,
        parentIndex: null,
        points: [
          [round2(tr.from.x), round2(tr.from.y)],
          [round2(tr.to.x), round2(tr.to.y)],
        ],
        impact: tr.blocked ? { x: round2(tr.to.x), y: round2(tr.to.y) } : null,
        hitUnitId: tr.hits[0]?.unitId ?? null,
        crit,
        flightSeconds: 0,
        beam: {
          from: { x: round2(tr.from.x), y: round2(tr.from.y) },
          to: { x: round2(tr.to.x), y: round2(tr.to.y) },
        },
      });
      beamPlans.push({ unitId: u.id, gun, trace: tr, crit, dmgMult });
      continue;
    }

    const count =
      gun.kind === "burst"
        ? Math.max(1, gun.count ?? 1)
        : gun.kind === "spread"
          ? Math.max(1, gun.angleOffsets?.length ?? gun.count ?? 1)
          : 1;
    const basePower = gun.maxPower !== undefined ? Math.min(cmd.power, gun.maxPower) : cmd.power;
    let rootIndex: number | null = null;
    for (let i = 0; i < count; i++) {
      const off = gun.kind === "burst" ? (gun.powerOffsets?.[i] ?? 0) : 0;
      const angOff = gun.kind === "spread" ? (gun.angleOffsets?.[i] ?? 0) : 0;
      const l = launch(u, cmd.angle + angOff, basePower + off, cmd.facing, cfg);
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
  const chainHits: ChainHit[] = [];
  const newZones: Zone[] = [];
  let nextZoneId = state.nextZoneId;

  const reductionOf = (u: Unit): number =>
    u.passive?.type === "toughness" ? u.passive.damageTakenReduction + (firedOwnSign.has(u.id) ? u.passive.lineBonus : 0) : 0;

  /** Gây `amount` sát thương (qua khiên); trả sát thương thật (hp mất). */
  const hurt = (u: Unit, raw: number, sourceUnitId: number, gun: GunStats, x: number): number => {
    let amount = raw;
    if (amount <= 0) return 0;
    const sh = u.statuses.find((s) => s.type === "shield");
    if (sh && sh.type === "shield" && sh.amount > 0) {
      const absorb = Math.min(sh.amount, amount);
      sh.amount -= absorb;
      amount -= absorb;
      shieldAbsorbed.push({ unitId: u.id, amount: absorb });
    }
    if (amount <= 0) return 0;
    u.hp = Math.max(0, u.hp - amount);
    damage.push({ unitId: u.id, sourceUnitId, amount, hpAfter: u.hp });
    pending.push({ unitId: u.id, sourceUnitId, gun, x });
    return amount;
  };

  // 2b. tia: tức thời, xử lý trước mọi vụ nổ
  for (const b of beamPlans) {
    const mult = (b.crit ? cfg.critMultiplier : 1) * b.dmgMult;
    for (const h of b.trace.hits) {
      const u = byId.get(h.unitId)!;
      if (!u.alive || u.hp <= 0) continue;
      hurt(u, Math.round(b.gun.damage * mult * Math.max(0, 1 - reductionOf(u))), b.unitId, b.gun, b.trace.from.x);
    }
  }

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
      const amount = Math.round(
        gun.damage * mult * Math.max(0, 1 - dist / (radius + cfg.unitRadiusTiles)) * Math.max(0, 1 - reductionOf(u)),
      );
      hurt(u, amount, p.unitId, gun, x);
    }

    // điện chuyền: chỉ khi trúng trực tiếp một đơn vị địch; nhảy lần lượt tới địch gần nhất chưa bị chuyền
    const shooter = byId.get(p.unitId)!;
    const src = shot.hitUnitId !== null ? byId.get(shot.hitUnitId) : undefined;
    if (gun.chain && src && src.team !== shooter.team) {
      const done = new Set<number>([src.id]);
      let cur = src;
      for (let k = 1; k <= gun.chain.maxTargets; k++) {
        let best: Unit | null = null;
        let bestD = Infinity;
        for (const t of units) {
          if (!t.alive || t.hp <= 0 || t.team === shooter.team || done.has(t.id)) continue;
          const dd = Math.hypot(t.col - cur.col, t.y - cur.y);
          if (dd <= gun.chain.radiusTiles && dd < bestD) {
            best = t;
            bestD = dd;
          }
        }
        if (!best) break;
        done.add(best.id);
        const raw = Math.round(gun.damage * mult * Math.pow(gun.chain.falloff, k) * Math.max(0, 1 - reductionOf(best)));
        const lost = hurt(best, raw, p.unitId, gun, cur.col + 0.5);
        chainHits.push({ fromUnitId: cur.id, toUnitId: best.id, amount: lost });
        cur = best;
      }
    }

    if (gun.zone) {
      newZones.push({
        id: nextZoneId++,
        ownerUnitId: p.unitId,
        team: shooter.team,
        x,
        y,
        radius: gun.zone.radiusTiles,
        turnsLeft: gun.zone.turns,
        active: false,
        poison: { ...gun.zone.poison },
      });
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
    if (e.gun.root) add({ type: "root", turns: e.gun.root.turns });
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

  // 6b. vũng độc: chỉ vũng tồn tại từ lượt trước (active=false lúc đầu lượt) mới tác dụng; vũng tạo lượt này chỉ cảnh báo
  const zonesNext: Zone[] = [];
  for (const z of state.zones) {
    for (const u of units) {
      if (!u.alive || u.hp <= 0 || u.team === z.team) continue;
      if (Math.hypot(u.col + 0.5 - z.x, u.y - cfg.unitRadiusTiles - z.y) > z.radius) continue;
      statusEvents.push({
        unitId: u.id,
        sourceUnitId: z.ownerUnitId,
        status: applyStatus(u, { type: "poison", turns: z.poison.turns, damagePerTurn: z.poison.damagePerTurn }, fresh, cfg),
      });
    }
    if (z.turnsLeft - 1 > 0) zonesNext.push({ ...z, active: true, turnsLeft: z.turnsLeft - 1 });
  }
  const zones = [...zonesNext, ...newZones];

  // 7. cháy (không qua khiên và giảm sát thương; sourceUnitId = 0: không rõ nguồn)
  const burnTicks: DamageEvent[] = [];
  for (const u of units) {
    if (!u.alive || u.hp <= 0) continue;
    const b = u.statuses.find((s) => s.type === "burn");
    if (!b || b.type !== "burn") continue;
    u.hp = Math.max(0, u.hp - b.damagePerTurn);
    burnTicks.push({ unitId: u.id, sourceUnitId: 0, amount: b.damagePerTurn, hpAfter: u.hp });
  }

  // 7b. độc (như cháy)
  const poisonTicks: DamageEvent[] = [];
  for (const u of units) {
    if (!u.alive || u.hp <= 0) continue;
    const b = u.statuses.find((s) => s.type === "poison");
    if (!b || b.type !== "poison") continue;
    u.hp = Math.max(0, u.hp - b.damagePerTurn);
    poisonTicks.push({ unitId: u.id, sourceUnitId: 0, amount: b.damagePerTurn, hpAfter: u.hp });
  }

  // 8. giảm thời lượng (cháy, độc luôn giảm; hiệu ứng khác nhận trong lượt này giữ nguyên tới lượt kế)
  for (const u of units) {
    u.statuses = u.statuses
      .map((s) => (s.type === "burn" || s.type === "poison" || !fresh.has(`${u.id}:${s.type}`) ? { ...s, turns: s.turns - 1 } : s))
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
    state: { ...state, rows: newRows, units, turn: state.turn + 1, zones, nextZoneId },
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
      poisonTicks,
      chainHits,
      zones: zoneInfos({ ...state, zones }),
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
  const u = state.units.find((x) => x.id === cmd.unitId);
  if (!u || !u.alive) return [];
  const g = guns[cmd.gunId];
  if (g?.kind === "beam") {
    const tr = traceBeam(state, u, g, cmd.angle, cmd.facing, 0, cfg);
    return [
      [round2(tr.from.x), round2(tr.from.y)],
      [round2(tr.to.x), round2(tr.to.y)],
    ];
  }
  const l = launch(u, cmd.angle, g?.maxPower !== undefined ? Math.min(cmd.power, g.maxPower) : cmd.power, cmd.facing, cfg);
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
  return planMonsterShot(state, unitId, cfg, guns).cmd;
}

/** RNG di chuyển của quái, suy ra từ seed của lượt (độc lập với RNG bắn). */
export function monsterMoveRng(turnSeed: number): () => number {
  return mulberry32((turnSeed ^ 0x6d6f7665) >>> 0);
}

/**
 * Quái có moveRangeTiles > 0 chọn cột đích trong tầm (docs/09): ưu tiên cột mà từ đó chooseMonsterShot
 * chạm gần người chơi nhất; hòa thì cột xa người chơi gần nhất hơn; còn hòa thì chọn theo rng.
 * Quyết định trên trạng thái đầu pha di chuyển (đồng thời với người chơi). Luôn gọi rng đúng một lần.
 */
export function chooseMonsterMove(
  state: BattleState,
  unitId: number,
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
  rng: () => number,
): MoveCommand | null {
  const me = state.units.find((u) => u.id === unitId);
  if (!me || !me.alive || me.kind !== "monster") return null;
  const range = me.moveRangeTiles ?? 0;
  if (range <= 0 || me.statuses.some((s) => s.type === "stun" || s.type === "root")) return null;
  const enemies = state.units.filter((u) => u.team !== me.team && u.alive);
  if (enemies.length === 0) return null;
  const farFrom = (col: number): number => Math.min(...enemies.map((e) => Math.abs(e.col - col)));

  // Đồng đội id nhỏ hơn đi trước (dự đoán bằng rng trung tính): tránh chồng lên cột của họ, vì đứng chồng là nổ vào nhau.
  let base = state;
  for (const a of state.units) {
    if (a.id >= unitId || a.team !== me.team || !a.alive || a.kind !== "monster") continue;
    const ac = chooseMonsterMove(state, a.id, guns, cfg, () => 0);
    if (ac) base = applyMoves(base, [ac], cfg).state;
  }

  const seen = new Set<number>();
  const cands: { col: number; harm: number; dist: number; far: number }[] = [];
  for (let c = Math.max(0, me.col - range); c <= Math.min(state.width - 1, me.col + range); c++) {
    const r = applyMoves(base, [{ unitId, col: c }], cfg);
    const moved = r.state.units.find((u) => u.id === unitId)!;
    if (seen.has(moved.col)) continue;
    seen.add(moved.col);
    const plan = planMonsterShot(r.state, unitId, cfg, guns);
    cands.push({ col: moved.col, harm: plan.harm, dist: plan.dist, far: farFrom(moved.col) });
  }
  const EPS = 1e-9;
  const bestHarm = Math.min(...cands.map((c) => c.harm));
  const safe = cands.filter((c) => c.harm === bestHarm);
  const bestDist = Math.min(...safe.map((c) => c.dist));
  const near = safe.filter((c) => c.dist <= bestDist + EPS);
  const bestFar = Math.max(...near.map((c) => c.far));
  const pool = near.filter((c) => c.far === bestFar).sort((a, b) => a.col - b.col);
  const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
  return { unitId, col: pick.col };
}

function planMonsterShot(
  state: BattleState,
  unitId: number,
  cfg: BattleConfig,
  guns: Record<string, GunStats>,
): { cmd: ShotCommand; dist: number; harm: number } {
  const me = state.units.find((u) => u.id === unitId);
  const gunId = me?.gunId ?? "";
  const gun = guns[gunId];
  const fallback: ShotCommand = { unitId, angle: 45, power: 50, facing: me?.facing ?? -1, gunId, aimElapsedSeconds: 0 };
  if (!me) return { cmd: fallback, dist: Infinity, harm: Infinity };
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
  if (!target) return { cmd: fallback, dist: Infinity, harm: Infinity };
  const tx = target.col + 0.5;
  const ty = target.y - cfg.unitRadiusTiles;

  const x0 = me.col + 0.5;
  const y0 = me.y - cfg.unitRadiusTiles;
  const step = cfg.aiAngleStepDegrees;
  const d = me.aiErrorTiles ?? cfg.deviationMaxTiles;
  const g = cfg.gravityTilesPerSec2;

  /** Điểm (hại phe mình, khoảng cách tới mục tiêu) của một phát, với độ lệch `offset` như resolveShots. */
  const evalAt = (facing: -1 | 1, angle: number, power: number, offset: number): { harm: number; dist: number } | null => {
    const v = (power / 100) * cfg.maxProjectileSpeedTilesPerSec;
    const T = Math.max(0.5, (2 * v * Math.sin(Math.max(angle, 10) * DEG)) / g);
    const f = simulate(
      state,
      {
        x0,
        y0,
        vx: facing * v * Math.cos(angle * DEG) + offset / T,
        vy: -v * Math.sin(angle * DEG),
        shooterId: me.id,
      },
      cfg,
      false,
    );
    if (!f.impact) return null;
    return {
      harm: gun ? friendlyDamage(state, me, f, gun, cfg) : 0,
      dist: f.hitUnitId === target.id ? 0 : Math.hypot(f.impact.x - tx, f.impact.y - ty),
    };
  };

  if (gun?.kind === "beam") {
    // tia chỉ hại địch: chọn góc đưa tia sát mục tiêu nhất
    let best: { facing: -1 | 1; angle: number; dist: number } | null = null;
    for (const facing of [-1, 1] as const) {
      for (let angle = cfg.aimAngleMinDegrees; angle <= cfg.aimAngleMaxDegrees; angle += step) {
        const tr = traceBeam(state, me, gun, angle, facing, 0, cfg);
        const dx = tr.to.x - tr.from.x;
        const dy = tr.to.y - tr.from.y;
        const l2 = dx * dx + dy * dy;
        const along = l2 > 0 ? clamp(((tx - tr.from.x) * dx + (ty - tr.from.y) * dy) / l2, 0, 1) : 0;
        const dist = Math.hypot(tx - tr.from.x - dx * along, ty - tr.from.y - dy * along);
        if (!best || dist < best.dist) best = { facing, angle, dist };
      }
    }
    if (!best) return { cmd: fallback, dist: Infinity, harm: Infinity };
    return {
      cmd: { unitId, angle: best.angle, power: 50, facing: best.facing, gunId, aimElapsedSeconds: 0 },
      dist: best.dist,
      harm: 0,
    };
  }
  const maxPower = gun?.maxPower !== undefined ? Math.min(100, gun.maxPower) : 100;

  // vòng 1: mọi phát không lệch
  const cands: { facing: -1 | 1; angle: number; power: number; harm: number; dist: number }[] = [];
  for (const facing of [-1, 1] as const) {
    for (let angle = step; angle <= cfg.aimAngleMaxDegrees; angle += step) {
      if (angle < cfg.aimAngleMinDegrees) continue;
      for (let power = 10; power <= maxPower; power += 5) {
        const e = evalAt(facing, angle, power, 0);
        if (e) cands.push({ facing, angle, power, ...e });
      }
    }
  }
  const byScore = (a: { harm: number; dist: number }, b: { harm: number; dist: number }): number =>
    a.harm - b.harm || a.dist - b.dist;
  cands.sort(byScore); // sort ổn định: hòa thì giữ thứ tự duyệt

  // vòng 2: các phát tốt nhất được chấm lại trung bình trên các độ lệch {-d, -d/2, 0, +d/2, +d}
  let finalists = cands;
  if (d > 0) {
    const offsets = [-d, -d / 2, 0, d / 2, d];
    finalists = cands.slice(0, REFINE_TOP).map((c) => {
      let harm = 0;
      let dist = 0;
      for (const o of offsets) {
        const e = o === 0 ? c : evalAt(c.facing, c.angle, c.power, o);
        harm += e ? e.harm : 0;
        dist += e ? e.dist : OFF_MAP_DIST;
      }
      return { ...c, harm: harm / offsets.length, dist: dist / offsets.length };
    });
    finalists.sort(byScore);
  }
  const b = finalists[0];
  if (!b) return { cmd: fallback, dist: Infinity, harm: Infinity };
  return {
    cmd: { unitId, angle: b.angle, power: b.power, facing: b.facing, gunId, aimElapsedSeconds: 0 },
    dist: b.dist,
    harm: b.harm,
  };
}

/** Số phát tốt nhất (không lệch) được chấm lại dưới độ lệch. */
const REFINE_TOP = 40;
/** Khoảng cách phạt khi một mẫu lệch bay ra ngoài bản đồ. */
const OFF_MAP_DIST = 100;

/**
 * Sát thương (không lệch, không chí mạng, không khiên/giảm sát thương) mà phát bắn này gây cho người bắn
 * và đồng đội còn sống, theo cùng công thức rơi sát thương như resolveShots.
 */
function friendlyDamage(state: BattleState, me: Unit, f: FlightOut, gun: GunStats, cfg: BattleConfig): number {
  if (!f.impact || gun.kind === "self" || gun.kind === "shower" || gun.kind === "beam") return 0;
  let total = 0;
  for (const u of state.units) {
    if (!u.alive || u.team !== me.team) continue;
    const dist = f.hitUnitId === u.id ? 0 : Math.hypot(f.impact.x - (u.col + 0.5), f.impact.y - (u.y - cfg.unitRadiusTiles));
    total += Math.round(gun.damage * Math.max(0, 1 - dist / (gun.blastRadiusTiles + cfg.unitRadiusTiles)));
  }
  return total;
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
