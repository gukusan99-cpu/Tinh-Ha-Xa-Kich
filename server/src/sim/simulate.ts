/**
 * Mô phỏng cân bằng trận: dựng trận giống hệt match.ts (cùng cột xuất phát, groupSize, hp, súng,
 * maxTurns, độ lệch) từ dữ liệu thật, cho bot người chơi đánh, trả kết quả. Hàm thuần, tất định theo seed.
 * Ghi đè giá trị chỉ áp dụng trong bộ nhớ, không đụng file data/.
 */
import { chooseMonsterShot, createBattleState, mulberry32, outcome, resolveShots } from "../battle/engine.js";
import type { BattleState, ShotCommand } from "../battle/types.js";
import { loadGameData, type GameData } from "../data.js";

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
  /** Mặc định: quái đầu tiên trong data/quai.json. */
  monsterId?: string;
  overrides?: Overrides;
  data?: GameData;
}

export interface SimResult {
  outcome: "win" | "lose" | "draw";
  turns: number;
  playerHpLeft: number;
  monstersKilled: number;
}

let cached: GameData | null = null;
export function getData(): GameData {
  return (cached ??= loadGameData());
}

const PLAYER_ID = 1;

export function simulateMatch(opts: SimOptions): SimResult {
  const data = opts.data ?? getData();
  const ov = opts.overrides ?? {};
  const monsterDef = opts.monsterId ? data.monsters[opts.monsterId] : Object.values(data.monsters)[0];
  if (!monsterDef) throw new Error("không tìm thấy quái để mô phỏng");
  const map = data.battleMaps[monsterDef.battleMapId]!;

  const cfg = { ...data.battle };
  if (ov.deviationMaxTiles !== undefined) cfg.deviationMaxTiles = ov.deviationMaxTiles;
  const guns = Object.fromEntries(
    Object.entries(data.guns).map(([id, g]) => [
      id,
      {
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

  // giống Match: người chơi id 1, quái id 2..; cột xuất phát theo map
  const units = [
    {
      id: PLAYER_ID,
      kind: "player" as const,
      name: "bot",
      team: 0 as const,
      col: map.playerSpawnCols[0]!,
      hp: baseHp,
      maxHp: baseHp,
      facing: 1 as const,
      gunId: data.character.startingGunId,
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
      aiErrorTiles: aiError,
    })),
  ];
  let state: BattleState = createBattleState(map, units);

  const turnRng = mulberry32(opts.seed);
  const botRng = mulberry32((opts.seed ^ 0x9e3779b9) >>> 0);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
      const angle = cfg.aimAngleMinDegrees + botRng() * (cfg.aimAngleMaxDegrees - cfg.aimAngleMinDegrees);
      return { unitId: PLAYER_ID, angle, power: 10 + botRng() * 90, facing };
    }
    const good = chooseMonsterShot(state, PLAYER_ID, guns, cfg);
    if (opts.policy === "gioi") return good;
    return {
      ...good,
      power: clamp(good.power + (botRng() * 2 - 1) * 8, 0, 100),
      angle: clamp(good.angle + (botRng() * 2 - 1) * 5, cfg.aimAngleMinDegrees, cfg.aimAngleMaxDegrees),
    };
  };

  let res = outcome(state, maxTurns);
  while (res === null) {
    const cmds: ShotCommand[] = [];
    const me = state.units.find((u) => u.id === PLAYER_ID)!;
    if (me.alive) cmds.push(playerShot());
    for (const u of state.units) {
      if (u.team === 1 && u.alive) cmds.push(chooseMonsterShot(state, u.id, guns, cfg));
    }
    const seed = (turnRng() * 4294967296) >>> 0;
    state = resolveShots(state, cmds, guns, cfg, seed).state;
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

export function runMany(policy: Policy, n: number, overrides: Overrides = {}, baseSeed = 1): Summary {
  let win = 0;
  let lose = 0;
  let draw = 0;
  let turns = 0;
  let hpWin = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateMatch({ policy, seed: (baseSeed + i * 7919) >>> 0, overrides });
    turns += r.turns;
    if (r.outcome === "win") {
      win++;
      hpWin += r.playerHpLeft;
    } else if (r.outcome === "lose") lose++;
    else draw++;
  }
  return { n, win: win / n, lose: lose / n, draw: draw / n, avgTurns: turns / n, avgHpOnWin: win ? hpWin / win : 0 };
}
