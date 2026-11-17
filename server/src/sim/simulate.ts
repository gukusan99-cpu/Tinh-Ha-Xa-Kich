/**
 * Mô phỏng cân bằng trận: dựng trận giống hệt match.ts (cùng cột xuất phát, groupSize, hp, bộ súng theo cung,
 * nội lực, maxTurns, độ lệch) từ dữ liệu thật, cho bot người chơi đánh, trả kết quả. Hàm thuần, tất định theo seed.
 * Ghi đè giá trị chỉ áp dụng trong bộ nhớ, không đụng file data/. Bot người chơi không di chuyển;
 * quái có moveRangeTiles > 0 di chuyển mỗi lượt như trong Match (docs/09).
 */
import {
  applyMoves,
  chooseMonsterMove,
  chooseMonsterShot,
  createBattleState,
  monsterMoveRng,
  mulberry32,
  outcome,
  probeShot,
  resolveShots,
  traceBeam,
  validateShot,
  winnerTeam,
} from "../battle/engine.js";
import type { BattleConfig, BattleState, GunStats, MoveCommand, ShotCommand, SignId, TurnResult, Unit } from "../battle/types.js";
import { isGeneralGun, loadGameData, type GameData } from "../data.js";

export type Policy = "gioi" | "ngau_nhien" | "trung_binh";
export const POLICIES: Policy[] = ["gioi", "trung_binh", "ngau_nhien"];

export interface Overrides {
  playerBaseHp?: number;
  monsterHp?: number;
  aiErrorTiles?: number;
  groupSize?: number;
  gunDamage?: number;
  blastRadiusTiles?: number;
  deviationMaxTiles?: number;
  maxTurnsPerMatch?: number;
}
export const OVERRIDE_KEYS: (keyof Overrides)[] = [
  "playerBaseHp",
  "monsterHp",
  "aiErrorTiles",
  "groupSize",
  "gunDamage",
  "blastRadiusTiles",
  "deviationMaxTiles",
  "maxTurnsPerMatch",
];

export interface SimOptions {
  policy: Policy;
  seed: number;
  /** Cung của bot; bỏ trống = chỉ súng chung, không nội tại. */
  sign?: string;
  /** Súng chung mang theo (toàn bộ loadout, thay mặc định `commonGunIds`); kiểm như set_loadout. */
  loadout?: string[];
  /** Mặc định: quái đầu tiên trong data/quai.json. */
  monsterId?: string;
  overrides?: Overrides;
  data?: GameData;
  /** Móc đo đạc: gọi sau mỗi lượt bắn với trạng thái trước lượt và kết quả lượt. */
  onTurn?: (before: BattleState, result: TurnResult) => void;
}

export interface SimResult {
  outcome: "win" | "lose" | "draw";
  turns: number;
  playerHpLeft: number;
  monstersKilled: number;
}

/** Kiểm loadout như máy chủ: súng chung có thật, không trùng, tối đa extraGunSlots. Trả bản sao. */
export function checkLoadout(data: GameData, loadout: string[]): string[] {
  if (loadout.length > data.character.extraGunSlots) throw new Error(`loadout quá ${data.character.extraGunSlots} ô: ${loadout.join(",")}`);
  if (new Set(loadout).size !== loadout.length) throw new Error(`loadout trùng súng: ${loadout.join(",")}`);
  for (const id of loadout) {
    const g = data.guns[id];
    if (!g || !isGeneralGun(g)) throw new Error(`loadout: "${id}" không phải súng chung`);
  }
  return [...loadout];
}

let cached: GameData | null = null;
export function getData(): GameData {
  return (cached ??= loadGameData());
}

const PLAYER_ID = 1;

// ---------- bot "giỏi": chọn súng tốt nhất bằng mô phỏng ứng viên ----------

/** Giá một điểm nội lực quy ra sát thương, để bot không phung phí nội lực. */
const ENERGY_PRICE = 1.5;
/** Số ứng viên (góc, lực) mỗi súng được đánh giá chính xác bằng engine. */
const TOP_CANDIDATES = 3;
/** Giá trị tối thiểu của một đòn tấn công để coi là "bắn trúng được". */
const MIN_ATTACK_VALUE = 1;

interface Probe {
  angle: number;
  power: number;
  facing: -1 | 1;
  impact: { x: number; y: number } | null;
  hit: number | null;
}

function probeTable(state: BattleState, me: Unit, cfg: BattleConfig): Probe[] {
  const facings = new Set<-1 | 1>();
  for (const u of state.units) if (u.team !== me.team && u.alive) facings.add(u.col >= me.col ? 1 : -1);
  if (facings.size === 0) facings.add(me.facing);
  const out: Probe[] = [];
  const step = cfg.aiAngleStepDegrees;
  for (const facing of facings) {
    for (let angle = step; angle <= cfg.aimAngleMaxDegrees; angle += step) {
      if (angle < cfg.aimAngleMinDegrees) continue;
      for (let power = 10; power <= 100; power += 5) {
        const f = probeShot(state, me.id, angle, power, facing, cfg);
        if (f?.impact) out.push({ angle, power, facing, impact: f.impact, hit: f.hitUnitId });
      }
    }
  }
  return out;
}

/** Điểm thô của một điểm chạm: sát thương xấp xỉ lên địch trừ lên phe mình (dùng để chọn ứng viên). */
function proxyScore(state: BattleState, me: Unit, gun: GunStats, p: Probe, cfg: BattleConfig): number {
  const imp = p.impact!;
  const reach = gun.kind === "shower" ? gun.blastRadiusTiles + (gun.spreadTiles ?? 0) : gun.blastRadiusTiles;
  const scale =
    gun.kind === "shower" ? (gun.count ?? 1) * 0.5 : gun.kind === "burst" ? (gun.count ?? 1) : gun.kind === "spread" ? (gun.count ?? 1) * 0.6 : 1;
  let s = 0;
  for (const u of state.units) {
    if (!u.alive) continue;
    const cx = u.col + 0.5;
    const cy = u.y - cfg.unitRadiusTiles;
    const dist = p.hit === u.id ? 0 : gun.kind === "shower" ? Math.abs(imp.x - cx) : Math.hypot(imp.x - cx, imp.y - cy);
    const v = gun.damage * scale * Math.max(0, 1 - dist / (reach + cfg.unitRadiusTiles));
    s += u.team === me.team ? -v : v;
  }
  return s;
}

function evalCmd(state: BattleState, me: Unit, cmd: ShotCommand, guns: Record<string, GunStats>, cfg0: BattleConfig): number {
  const r = resolveShots(state, [cmd], guns, cfg0, 1);
  let v = 0;
  for (const after of r.result.units) {
    const before = state.units.find((u) => u.id === after.id)!;
    const lost = before.hp - after.hp;
    if (before.team === me.team) {
      v -= lost * (before.id === me.id ? 1.2 : 1);
      if (before.id === me.id && after.hp <= 0) v -= 1000;
    } else {
      v += lost;
      for (const s of after.statuses) if ((s.type === "burn" || s.type === "poison") && after.hp > 0) v += s.turns * s.damagePerTurn;
    }
  }
  // vũng độc mới: địch đang đứng trong vũng sẽ chịu độc (chiết khấu 0.5 vì có thể bước ra)
  for (const z of r.state.zones) {
    if (z.team !== me.team || z.id < state.nextZoneId) continue;
    for (const u of r.state.units) {
      if (!u.alive || u.team === me.team) continue;
      if (Math.hypot(u.col + 0.5 - z.x, u.y - cfg0.unitRadiusTiles - z.y) <= z.radius) v += 0.5 * z.poison.damagePerTurn * z.turnsLeft;
    }
  }
  return v - guns[cmd.gunId]!.energyCost * ENERGY_PRICE;
}

interface Pick {
  cmd: ShotCommand;
  value: number;
}

function bestAttack(
  state: BattleState,
  me: Unit,
  usable: GunStats[],
  table: Probe[],
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
  cfg0: BattleConfig,
  elapsed: number,
): Pick | null {
  let best: Pick | null = null;
  for (const gun of usable) {
    if (gun.kind === "self" || (gun.damage <= 0 && !gun.root && !gun.zone)) continue;
    if (gun.kind === "beam") {
      const cands: { angle: number; facing: -1 | 1; s: number }[] = [];
      const facings = new Set(table.map((p) => p.facing));
      if (facings.size === 0) facings.add(me.facing);
      for (const facing of facings) {
        for (let angle = cfg.aimAngleMinDegrees; angle <= cfg.aimAngleMaxDegrees; angle += cfg.aiAngleStepDegrees) {
          const tr = traceBeam(state, me, gun, angle, facing, 0, cfg);
          if (tr.hits.length > 0) cands.push({ angle, facing, s: tr.hits.length });
        }
      }
      cands.sort((a, b) => b.s - a.s);
      for (const c of cands.slice(0, TOP_CANDIDATES)) {
        const cmd: ShotCommand = { unitId: me.id, angle: c.angle, power: 50, facing: c.facing, gunId: gun.id, aimElapsedSeconds: elapsed };
        const value = evalCmd(state, me, cmd, guns, cfg0);
        if (!best || value > best.value) best = { cmd, value };
      }
      continue;
    }
    const ranked = table
      .filter((p) => gun.maxPower === undefined || p.power <= gun.maxPower)
      .map((p) => ({ p, s: proxyScore(state, me, gun, p, cfg) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, TOP_CANDIDATES);
    for (const { p } of ranked) {
      const cmd: ShotCommand = {
        unitId: me.id,
        angle: p.angle,
        power: p.power,
        facing: p.facing,
        gunId: gun.id,
        aimElapsedSeconds: elapsed,
      };
      const value = evalCmd(state, me, cmd, guns, cfg0);
      if (!best || value > best.value) best = { cmd, value };
    }
  }
  return best;
}

/** Sát thương dự kiến quái gây lên `me` nếu bắn chuẩn (nhân 0.5 vì quái bắn lệch). */
function predictedIncoming(state: BattleState, me: Unit, guns: Record<string, GunStats>, cfg: BattleConfig, cfg0: BattleConfig): number {
  const exact: BattleState = { ...state, units: state.units.map((u) => (u.team === 1 ? { ...u, aiErrorTiles: 0 } : u)) };
  const cmds: ShotCommand[] = [];
  for (const u of exact.units) if (u.team !== me.team && u.alive) cmds.push(chooseMonsterShot(exact, u.id, guns, cfg));
  if (cmds.length === 0) return 0;
  const r = resolveShots(exact, cmds, guns, cfg0, 1);
  return r.result.damage.filter((d) => d.unitId === me.id).reduce((s, d) => s + d.amount, 0) * 0.5;
}

function goodShot(
  state: BattleState,
  me: Unit,
  guns: Record<string, GunStats>,
  cfg: BattleConfig,
  elapsed: number,
): ShotCommand {
  const cfg0: BattleConfig = { ...cfg, deviationMaxTiles: 0, critChance: 0 };
  const usable = me.guns
    .map((id) => guns[id]!)
    .filter((g) => validateShot(state, { unitId: me.id, angle: 0, power: 0, facing: 1, gunId: g.id, aimElapsedSeconds: 0 }, guns) === "ok");
  const table = probeTable(state, me, cfg);
  const attack = bestAttack(state, me, usable, table, guns, cfg, cfg0, elapsed);

  let best: Pick | null = attack;
  const attackValue = attack?.value ?? 0;
  const selfGuns = usable.filter((g) => g.kind === "self");
  const needIncoming = selfGuns.some((g) => g.selfEffect?.type === "shield");
  const incoming = needIncoming ? predictedIncoming(state, me, guns, cfg, cfg0) : 0;
  for (const g of selfGuns) {
    let value = -Infinity;
    if (g.selfEffect?.type === "shield") {
      value = Math.min(g.selfEffect.amount, incoming) - g.energyCost * ENERGY_PRICE;
    } else if (g.selfEffect?.type === "trueAim") {
      // chỉ đáng dùng khi lượt này không bắn trúng được (lượt sau bắn không lệch)
      const has = me.statuses.some((s) => s.type === "trueAim");
      value = !has && attackValue < MIN_ATTACK_VALUE ? MIN_ATTACK_VALUE : -Infinity;
    }
    if (value > (best?.value ?? -Infinity) && (value > 0 || attackValue < MIN_ATTACK_VALUE)) {
      best = { cmd: { unitId: me.id, angle: 45, power: 50, facing: me.facing, gunId: g.id, aimElapsedSeconds: elapsed }, value };
    }
  }
  if (best) return best.cmd;
  // không khẩu nào dùng được hiệu quả: bắn súng rẻ nhất vào mục tiêu gần nhất
  const fallback = usable.find((g) => g.kind !== "self") ?? usable[0];
  const gunId = fallback?.id ?? me.gunId;
  return { ...chooseMonsterShot(state, me.id, guns, cfg), gunId, aimElapsedSeconds: elapsed };
}

// ---------- mô phỏng một trận ----------

export function simulateMatch(opts: SimOptions): SimResult {
  const data = opts.data ?? getData();
  const ov = opts.overrides ?? {};
  const monsterDef = opts.monsterId ? data.monsters[opts.monsterId] : Object.values(data.monsters)[0];
  if (!monsterDef) throw new Error("không tìm thấy quái để mô phỏng");
  const map = data.battleMaps[monsterDef.battleMapId]!;

  const cfg = { ...data.battle };
  if (ov.deviationMaxTiles !== undefined) cfg.deviationMaxTiles = ov.deviationMaxTiles;
  const guns: Record<string, GunStats> = Object.fromEntries(
    Object.entries(data.guns).map(([id, g]) => [
      id,
      g.kind === "self"
        ? g
        : {
            ...g,
            damage: ov.gunDamage ?? g.damage,
            blastRadiusTiles: ov.blastRadiusTiles ?? g.blastRadiusTiles,
          },
    ]),
  );
  const maxTurns = ov.maxTurnsPerMatch ?? data.settings.maxTurnsPerMatch;
  const baseHp = ov.playerBaseHp ?? data.character.baseHp;
  const monsterHp = ov.monsterHp ?? monsterDef.hp;
  const aiError = ov.aiErrorTiles ?? monsterDef.aiErrorTiles;
  const groupSize = Math.min(ov.groupSize ?? monsterDef.groupSize, map.monsterSpawnCols.length);

  const ch = data.character;
  const signDef = opts.sign !== undefined ? ch.signDefs[opts.sign] : undefined;
  if (opts.sign !== undefined && !signDef) throw new Error(`cung không có trong dữ liệu: ${opts.sign}`);

  const loadout = opts.loadout !== undefined ? checkLoadout(data, opts.loadout) : [...ch.commonGunIds];
  // giống Match: người chơi id 1, quái id 2..; cột xuất phát theo map
  const units: Omit<Unit, "y" | "alive">[] = [
    {
      id: PLAYER_ID,
      kind: "player",
      name: "bot",
      team: 0,
      col: map.playerSpawnCols[0]!,
      hp: baseHp,
      maxHp: baseHp,
      facing: 1,
      gunId: ch.commonGunIds[0]!,
      guns: [...(signDef?.gunIds ?? []), ...loadout],
      sign: (signDef?.id ?? null) as SignId | null,
      passive: signDef?.passive ?? null,
      energy: ch.energyStart,
      cooldowns: {},
      statuses: [],
    },
    ...Array.from({ length: groupSize }, (_, i) => ({
      id: PLAYER_ID + 1 + i,
      kind: "monster" as const,
      name: monsterDef.name,
      team: 1 as const,
      col: map.monsterSpawnCols[i]!,
      hp: monsterHp,
      maxHp: monsterHp,
      facing: -1 as const,
      gunId: monsterDef.gunId,
      guns: [monsterDef.gunId],
      sign: null,
      passive: null,
      energy: 0,
      cooldowns: {},
      statuses: [],
      aiErrorTiles: aiError,
      moveRangeTiles: monsterDef.moveRangeTiles,
      monsterId: monsterDef.id,
    })),
  ];
  let state: BattleState = createBattleState(map, units);

  const turnRng = mulberry32(opts.seed);
  const botRng = mulberry32((opts.seed ^ 0x9e3779b9) >>> 0);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const aimSeconds = data.settings.aimPhaseSeconds;

  const playerShot = (): ShotCommand => {
    const me = state.units.find((u) => u.id === PLAYER_ID)!;
    if (opts.policy === "ngau_nhien") {
      let nearest = Infinity;
      let facing: -1 | 1 = 1;
      for (const u of state.units) {
        if (u.team === 0 || !u.alive) continue;
        const d = Math.abs(u.col - me.col);
        if (d < nearest) {
          nearest = d;
          facing = u.col >= me.col ? 1 : -1;
        }
      }
      const usable = me.guns.filter(
        (id) => validateShot(state, { unitId: PLAYER_ID, angle: 0, power: 0, facing: 1, gunId: id, aimElapsedSeconds: 0 }, guns) === "ok",
      );
      const gunId = usable[Math.floor(botRng() * usable.length)] ?? me.gunId;
      const angle = cfg.aimAngleMinDegrees + botRng() * (cfg.aimAngleMaxDegrees - cfg.aimAngleMinDegrees);
      return { unitId: PLAYER_ID, angle, power: 10 + botRng() * 90, facing, gunId, aimElapsedSeconds: botRng() * aimSeconds };
    }
    if (opts.policy === "gioi") return goodShot(state, me, guns, cfg, 1);
    const good = goodShot(state, me, guns, cfg, botRng() * aimSeconds);
    if (guns[good.gunId]?.kind === "self") return good;
    return {
      ...good,
      power: clamp(good.power + (botRng() * 2 - 1) * 8, 0, 100),
      angle: clamp(good.angle + (botRng() * 2 - 1) * 5, cfg.aimAngleMinDegrees, cfg.aimAngleMaxDegrees),
    };
  };

  let res = outcome(state, maxTurns);
  while (res === null) {
    const seed = (turnRng() * 4294967296) >>> 0;
    // pha di chuyển: quái biết đi chọn cột (bot người chơi đứng yên), rồi mới ngắm như Match
    const moveRng = monsterMoveRng(seed);
    const moves: MoveCommand[] = [];
    for (const u of state.units) {
      if (u.team !== 1 || !u.alive) continue;
      const c = chooseMonsterMove(state, u.id, guns, cfg, moveRng);
      if (c) moves.push(c);
    }
    if (moves.length > 0) state = applyMoves(state, moves, cfg).state;
    const cmds: ShotCommand[] = [];
    const me = state.units.find((u) => u.id === PLAYER_ID)!;
    if (me.alive) cmds.push(playerShot());
    for (const u of state.units) {
      if (u.team === 1 && u.alive) cmds.push(chooseMonsterShot(state, u.id, guns, cfg));
    }
    const resolved = resolveShots(state, cmds, guns, cfg, seed);
    opts.onTurn?.(state, resolved.result);
    state = resolved.state;
    res = outcome(state, maxTurns);
  }
  const me = state.units.find((u) => u.id === PLAYER_ID)!;
  return {
    outcome: res,
    turns: state.turn - 1,
    playerHpLeft: me.alive ? me.hp : 0,
    monstersKilled: state.units.filter((u) => u.team === 1 && !u.alive).length,
  };
}

export interface Summary {
  n: number;
  win: number;
  lose: number;
  draw: number;
  avgTurns: number;
  avgHpOnWin: number;
}

export function runMany(
  policy: Policy,
  n: number,
  overrides: Overrides = {},
  baseSeed = 1,
  sign?: string,
  monsterId?: string,
  loadout?: string[],
): Summary {
  let win = 0;
  let lose = 0;
  let draw = 0;
  let turns = 0;
  let hpWin = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateMatch({ policy, seed: (baseSeed + i * 7919) >>> 0, overrides, sign, monsterId, loadout });
    turns += r.turns;
    if (r.outcome === "win") {
      win++;
      hpWin += r.playerHpLeft;
    } else if (r.outcome === "lose") lose++;
    else draw++;
  }
  return { n, win: win / n, lose: lose / n, draw: draw / n, avgTurns: turns / n, avgHpOnWin: win ? hpWin / win : 0 };
}

// ---------- PvP (docs/08): hai bot "giỏi" có di chuyển né ----------

export interface PvpOptions {
  signA: string;
  signB: string;
  seed: number;
  /** true: A đứng đội 1 (bên phải), B đội 0. Đổi bên để loại bỏ thiên vị của bản đồ. */
  swap: boolean;
  data?: GameData;
  /** Loadout đầy đủ của A / B (mặc định commonGunIds). */
  loadoutA?: string[];
  loadoutB?: string[];
}
export interface PvpResult {
  winner: "a" | "b" | "draw";
  winnerTeam: 0 | 1 | "draw";
  turns: number;
}

/**
 * Một trận PvP: dựng giống Match (bản đồ pvpBattleMapId, cột team0/team1, nội lực, bộ súng theo cung, pvpMaxTurns).
 * Mỗi lượt cả hai né: đích ngẫu nhiên (theo seed) trong moveRangeTiles, nằm trong bản đồ; rồi bắn bằng chính sách "gioi".
 */
export function simulatePvpMatch(opts: PvpOptions): PvpResult {
  const data = opts.data ?? getData();
  const ch = data.character;
  for (const s of [opts.signA, opts.signB]) if (!ch.signDefs[s]) throw new Error(`cung không có trong dữ liệu: ${s}`);
  const map = data.battleMaps[data.settings.pvpBattleMapId]!;
  const cfg = data.battle;
  const guns = data.guns;
  const maxTurns = data.settings.pvpMaxTurns;

  const signOf = (team: 0 | 1): string => ((team === 0) !== opts.swap ? opts.signA : opts.signB);
  const loadoutOf = (team: 0 | 1): string[] => {
    const l = (team === 0) !== opts.swap ? opts.loadoutA : opts.loadoutB;
    return l !== undefined ? checkLoadout(data, l) : [...ch.commonGunIds];
  };
  const mk = (id: number, team: 0 | 1, col: number): Omit<Unit, "y" | "alive"> => {
    const def = ch.signDefs[signOf(team)]!;
    return {
      id,
      kind: "player",
      name: `bot${id}`,
      team,
      col,
      hp: ch.baseHp,
      maxHp: ch.baseHp,
      facing: team === 0 ? 1 : -1,
      gunId: ch.commonGunIds[0]!,
      guns: [...def.gunIds, ...loadoutOf(team)],
      sign: def.id,
      passive: def.passive,
      energy: ch.energyStart,
      cooldowns: {},
      statuses: [],
    };
  };
  let state: BattleState = createBattleState(map, [mk(1, 0, map.team0SpawnCols[0]!), mk(2, 1, map.team1SpawnCols[0]!)]);

  const turnRng = mulberry32(opts.seed);
  const dodgeRng = mulberry32((opts.seed ^ 0x51ed270b) >>> 0);
  const range = cfg.moveRangeTiles;

  let w = winnerTeam(state, maxTurns);
  while (w === null) {
    const moves = state.units
      .filter((u) => u.alive)
      .map((u) => ({
        unitId: u.id,
        col: Math.max(0, Math.min(state.width - 1, u.col + Math.floor(dodgeRng() * (2 * range + 1)) - range)),
      }));
    state = applyMoves(state, moves, cfg).state;
    const cmds: ShotCommand[] = [];
    for (const u of state.units) if (u.alive) cmds.push(goodShot(state, u, guns, cfg, 1));
    const seed = (turnRng() * 4294967296) >>> 0;
    state = resolveShots(state, cmds, guns, cfg, seed).state;
    w = winnerTeam(state, maxTurns);
  }
  const winner = w === "draw" ? "draw" : (w === 0) !== opts.swap ? "a" : "b";
  return { winner, winnerTeam: w, turns: state.turn - 1 };
}

export interface PvpPairSummary {
  a: string;
  b: string;
  n: number;
  aWins: number;
  bWins: number;
  draws: number;
  /** Số trận đội 0 (bên trái) thắng, bất kể cung: đo độ thiên vị của bản đồ. */
  team0Wins: number;
  /** Số trận A đứng bên phải. */
  swapped: number;
  avgTurns: number;
}

/** Mọi cặp cung (i ≤ j), kể cả cùng cung. */
export function pvpPairs(signs: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < signs.length; i++) for (let j = i; j < signs.length; j++) out.push([signs[i]!, signs[j]!]);
  return out;
}

/** n trận giữa a và b; trận lẻ đổi bên (A đứng bên phải). */
export function runPvpPair(
  a: string,
  b: string,
  n: number,
  baseSeed = 1,
  data?: GameData,
  loadouts: { a?: string[]; b?: string[] } = {},
): PvpPairSummary {
  const s: PvpPairSummary = { a, b, n, aWins: 0, bWins: 0, draws: 0, team0Wins: 0, swapped: 0, avgTurns: 0 };
  let turns = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    if (swap) s.swapped++;
    const r = simulatePvpMatch({ signA: a, signB: b, seed: (baseSeed + i * 7919) >>> 0, swap, data, loadoutA: loadouts.a, loadoutB: loadouts.b });
    turns += r.turns;
    if (r.winner === "a") s.aWins++;
    else if (r.winner === "b") s.bWins++;
    else s.draws++;
    if (r.winnerTeam === 0) s.team0Wins++;
  }
  s.avgTurns = n > 0 ? turns / n : 0;
  return s;
}

// ---------- so sánh loadout (docs/10, mục Cân bằng) ----------

export interface LoadoutCompareRow {
  gunId: string;
  win: number;
  /** Chênh lệch tỉ lệ thắng so với loadout mặc định, đơn vị điểm phần trăm. */
  deltaPoints: number;
}
export interface LoadoutCompare {
  sign: string;
  baseline: number;
  rows: LoadoutCompareRow[];
}

/** Mọi súng chung ngoài loadout mặc định (thường + hiếm), theo thứ tự trong dữ liệu. */
export function candidateGuns(data: GameData): string[] {
  return Object.values(data.guns)
    .filter((g) => isGeneralGun(g) && !data.character.commonGunIds.includes(g.id))
    .map((g) => g.id);
}

/** Mỗi cung: PvE vs `monsterId` (mặc định am_thach_nho), loadout mặc định so với thêm từng súng chung. */
export function compareLoadouts(
  sign: string,
  n: number,
  policy: Policy = "trung_binh",
  baseSeed = 1,
  monsterId = "am_thach_nho",
  data: GameData = getData(),
): LoadoutCompare {
  const base = runMany(policy, n, {}, baseSeed, sign, monsterId, [...data.character.commonGunIds]).win;
  const rows = candidateGuns(data).map((gunId) => {
    const win = runMany(policy, n, {}, baseSeed, sign, monsterId, [...data.character.commonGunIds, gunId]).win;
    return { gunId, win, deltaPoints: (win - base) * 100 };
  });
  return { sign, baseline: base, rows };
}
