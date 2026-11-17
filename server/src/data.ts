/**
 * Nạp và kiểm tra toàn bộ `data/`. Không có con số cân bằng nào hard-code ở đây:
 * mọi giá trị đến từ JSON; lỗi dữ liệu làm máy chủ không khởi động (fail fast).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBattleConfig, loadGuns } from "./battle/config.js";
import type { BattleConfig, GunStats, Passive, SignId } from "./battle/types.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Portal extends Rect {
  toMapId: string;
  toSpawn: { x: number; y: number };
}
export interface MonsterSpawn {
  monsterId: string;
  count: number;
  area: Rect;
}
export interface WorldMapDef {
  id: string;
  name: string;
  kind: "thanh" | "vung_san";
  width: number;
  height: number;
  rows: string[];
  spawn: { x: number; y: number };
  portals: Portal[];
  monsterSpawns: MonsterSpawn[];
}
export interface BattleMapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  playerSpawnCols: number[];
  monsterSpawnCols: number[];
}
export interface MonsterDef {
  id: string;
  name: string;
  hp: number;
  gunId: string;
  aiErrorTiles: number;
  expReward: number;
  worldSpeedTilesPerSec: number;
  battleMapId: string;
  groupSize: number;
}
export interface SignDef {
  id: SignId;
  name: string;
  gunIds: string[];
  passive: Passive;
}
export interface CharacterRules {
  baseHp: number;
  worldSpeedTilesPerSec: number;
  /** Súng chung, ai cũng mang; phần tử đầu là `Character.gunId` khi tạo nhân vật. */
  commonGunIds: string[];
  expPerLevel: number;
  energyStart: number;
  energyMax: number;
  /** Danh sách id cung, theo thứ tự trong dữ liệu. */
  signs: string[];
  signDefs: Record<string, SignDef>;
}
export interface Settings {
  movePhaseSeconds: number;
  aimPhaseSeconds: number;
  replayPaddingSeconds: number;
  disconnectMissedTurnsToKick: number;
  maxTurnsPerMatch: number;
  contactRadiusTiles: number;
  monsterRespawnSeconds: number;
  worldTickHz: number;
}
export interface GameData {
  battle: BattleConfig;
  guns: Record<string, GunStats>;
  settings: Settings;
  character: CharacterRules;
  monsters: Record<string, MonsterDef>;
  worldMaps: Record<string, WorldMapDef>;
  battleMaps: Record<string, BattleMapDef>;
  /** Bản đồ `thanh` duy nhất: nơi người chơi vào thế giới. */
  startMapId: string;
}

type Obj = Record<string, unknown>;

function readJson(rel: string): Obj {
  const text = readFileSync(DATA_DIR + rel, "utf8").replace(/^﻿/, "");
  const v: unknown = JSON.parse(text);
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`data/${rel}: không phải object`);
  return v as Obj;
}

const num = (o: Obj, k: string, w: string): number => {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${w}: thiếu hoặc sai khóa số "${k}"`);
  return v;
};
const str = (o: Obj, k: string, w: string): string => {
  const v = o[k];
  if (typeof v !== "string" || v === "") throw new Error(`${w}: thiếu hoặc sai khóa chuỗi "${k}"`);
  return v;
};
const arr = (o: Obj, k: string, w: string): unknown[] => {
  const v = o[k];
  if (!Array.isArray(v)) throw new Error(`${w}: thiếu mảng "${k}"`);
  return v;
};
const obj = (v: unknown, w: string): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${w}: phải là object`);
  return v as Obj;
};
const point = (v: unknown, w: string): { x: number; y: number } => {
  const o = obj(v, w);
  return { x: num(o, "x", w), y: num(o, "y", w) };
};
const rect = (v: unknown, w: string): Rect => {
  const o = obj(v, w);
  return { x: num(o, "x", w), y: num(o, "y", w), w: num(o, "w", w), h: num(o, "h", w) };
};
const intList = (o: Obj, k: string, w: string): number[] =>
  arr(o, k, w).map((v) => {
    if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${w}: "${k}" phải là số nguyên`);
    return v;
  });

function parsePassive(o: Obj, w: string): Passive {
  const type = str(o, "type", w);
  switch (type) {
    case "earlyShot":
      return {
        type,
        earlyShotSeconds: num(o, "earlyShotSeconds", w),
        earlyShotDamageBonus: num(o, "earlyShotDamageBonus", w),
        lineBonus: num(o, "lineBonus", w),
      };
    case "toughness":
      return { type, damageTakenReduction: num(o, "damageTakenReduction", w), lineBonus: num(o, "lineBonus", w) };
    case "precision":
      return {
        type,
        deviationReduction: num(o, "deviationReduction", w),
        lineBonus: num(o, "lineBonus", w),
        aimPreviewFraction: num(o, "aimPreviewFraction", w),
        aimPreviewPerSecond: num(o, "aimPreviewPerSecond", w),
      };
    case "meteorPush":
      return {
        type,
        digBelowOnHit: num(o, "digBelowOnHit", w),
        lineBonusStones: num(o, "lineBonusStones", w),
        lineBonus: num(o, "lineBonus", w),
      };
    default:
      throw new Error(`${w}: loại nội tại không hợp lệ "${type}"`);
  }
}

function loadWorldMap(file: string): WorldMapDef {
  const w = `data/ban-do/${file}`;
  const o = readJson(`ban-do/${file}`);
  const kind = str(o, "loai", w);
  if (kind !== "thanh" && kind !== "vung_san") throw new Error(`${w}: loai không hợp lệ "${kind}"`);
  return {
    id: str(o, "id", w),
    name: str(o, "ten", w),
    kind,
    width: num(o, "width", w),
    height: num(o, "height", w),
    rows: arr(o, "rows", w).map((r) => {
      if (typeof r !== "string") throw new Error(`${w}: rows phải là chuỗi`);
      return r;
    }),
    spawn: point(o["spawn"], `${w}.spawn`),
    portals: arr(o, "portals", w).map((p, i) => {
      const po = obj(p, `${w}.portals[${i}]`);
      return {
        ...rect(po, `${w}.portals[${i}]`),
        toMapId: str(po, "toMapId", `${w}.portals[${i}]`),
        toSpawn: point(po["toSpawn"], `${w}.portals[${i}].toSpawn`),
      };
    }),
    monsterSpawns: arr(o, "monsterSpawns", w).map((s, i) => {
      const so = obj(s, `${w}.monsterSpawns[${i}]`);
      return {
        monsterId: str(so, "monsterId", `${w}.monsterSpawns[${i}]`),
        count: num(so, "count", `${w}.monsterSpawns[${i}]`),
        area: rect(so["area"], `${w}.monsterSpawns[${i}].area`),
      };
    }),
  };
}

function loadBattleMap(file: string): BattleMapDef {
  const w = `data/tran/${file}`;
  const o = readJson(`tran/${file}`);
  return {
    id: str(o, "id", w),
    name: str(o, "ten", w),
    width: num(o, "width", w),
    height: num(o, "height", w),
    rows: arr(o, "rows", w).map((r) => {
      if (typeof r !== "string") throw new Error(`${w}: rows phải là chuỗi`);
      return r;
    }),
    playerSpawnCols: intList(o, "playerSpawnCols", w),
    monsterSpawnCols: intList(o, "monsterSpawnCols", w),
  };
}

export function loadGameData(): GameData {
  const bal = readJson("can-bang-v0.json");
  const wb = "data/can-bang-v0.json";
  const settings: Settings = {
    movePhaseSeconds: num(bal, "movePhaseSeconds", wb),
    aimPhaseSeconds: num(bal, "aimPhaseSeconds", wb),
    replayPaddingSeconds: num(bal, "replayPaddingSeconds", wb),
    disconnectMissedTurnsToKick: num(bal, "disconnectMissedTurnsToKick", wb),
    maxTurnsPerMatch: num(bal, "maxTurnsPerMatch", wb),
    contactRadiusTiles: num(bal, "contactRadiusTiles", wb),
    monsterRespawnSeconds: num(bal, "monsterRespawnSeconds", wb),
    worldTickHz: num(bal, "worldTickHz", wb),
  };

  const nv = readJson("nhan-vat.json");
  const wn = "data/nhan-vat.json";
  const signDefs: Record<string, SignDef> = {};
  for (const [i, s] of arr(nv, "signs", wn).entries()) {
    const so = obj(s, `${wn}.signs[${i}]`);
    const id = str(so, "id", `${wn}.signs[${i}]`);
    const w = `${wn}[${id}]`;
    signDefs[id] = {
      id: id as SignId,
      name: str(so, "ten", w),
      gunIds: arr(so, "gunIds", w).map((g) => {
        if (typeof g !== "string" || g === "") throw new Error(`${w}: gunIds phải là chuỗi`);
        return g;
      }),
      passive: parsePassive(obj(so["passive"], `${w}.passive`), `${w}.passive`),
    };
  }
  const character: CharacterRules = {
    baseHp: num(nv, "baseHp", wn),
    worldSpeedTilesPerSec: num(nv, "worldSpeedTilesPerSec", wn),
    commonGunIds: arr(nv, "commonGunIds", wn).map((g) => {
      if (typeof g !== "string" || g === "") throw new Error(`${wn}: commonGunIds phải là chuỗi`);
      return g;
    }),
    expPerLevel: num(nv, "expPerLevel", wn),
    energyStart: num(nv, "energyStart", wn),
    energyMax: num(nv, "energyMax", wn),
    signs: Object.keys(signDefs),
    signDefs,
  };

  const monsters: Record<string, MonsterDef> = {};
  const wq = "data/quai.json";
  for (const [i, m] of arr(readJson("quai.json"), "monsters", wq).entries()) {
    const mo = obj(m, `${wq}[${i}]`);
    const id = str(mo, "id", wq);
    const w = `${wq}[${id}]`;
    monsters[id] = {
      id,
      name: str(mo, "ten", w),
      hp: num(mo, "hp", w),
      gunId: str(mo, "gunId", w),
      aiErrorTiles: num(mo, "aiErrorTiles", w),
      expReward: num(mo, "expReward", w),
      worldSpeedTilesPerSec: num(mo, "worldSpeedTilesPerSec", w),
      battleMapId: str(mo, "battleMapId", w),
      groupSize: num(mo, "groupSize", w),
    };
  }

  const worldMaps: Record<string, WorldMapDef> = {};
  for (const f of readdirSync(DATA_DIR + "ban-do").filter((n) => n.endsWith(".json")).sort()) {
    const m = loadWorldMap(f);
    worldMaps[m.id] = m;
  }
  const battleMaps: Record<string, BattleMapDef> = {};
  for (const f of readdirSync(DATA_DIR + "tran").filter((n) => n.endsWith(".json")).sort()) {
    const m = loadBattleMap(f);
    battleMaps[m.id] = m;
  }

  const thanh = Object.values(worldMaps).filter((m) => m.kind === "thanh");
  if (thanh.length !== 1) throw new Error(`data/ban-do: cần đúng một bản đồ loai "thanh", có ${thanh.length}`);

  const data: GameData = {
    battle: loadBattleConfig(),
    guns: loadGuns(),
    settings,
    character,
    monsters,
    worldMaps,
    battleMaps,
    startMapId: thanh[0]!.id,
  };
  validateGameData(data);
  return data;
}

// ---------- kiểm tra chéo ----------

const solid = (rows: string[], c: number, r: number): boolean => rows[r]?.[c] === "#";

function checkGrid(m: { id: string; width: number; height: number; rows: string[] }, w: string): void {
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width <= 0 || m.height <= 0) {
    throw new Error(`${w}: width/height phải là số nguyên dương`);
  }
  if (m.rows.length !== m.height) throw new Error(`${w}: số hàng ${m.rows.length} ≠ height ${m.height}`);
  m.rows.forEach((r, i) => {
    if (r.length !== m.width) throw new Error(`${w}: hàng ${i} dài ${r.length} ≠ width ${m.width}`);
    if (/[^#.]/.test(r)) throw new Error(`${w}: hàng ${i} có ký tự ngoài "#" và "."`);
  });
}

function checkFloorPoint(m: WorldMapDef, p: { x: number; y: number }, w: string): void {
  if (p.x < 0 || p.y < 0 || p.x >= m.width || p.y >= m.height || solid(m.rows, Math.floor(p.x), Math.floor(p.y))) {
    throw new Error(`${w}: điểm (${p.x}, ${p.y}) nằm ngoài bản đồ hoặc trong tường`);
  }
}

function positive(v: number, w: string): void {
  if (!(v > 0)) throw new Error(`${w}: phải > 0`);
}

export function validateGameData(d: GameData): void {
  const s = d.settings;
  for (const k of ["movePhaseSeconds", "aimPhaseSeconds", "contactRadiusTiles", "monsterRespawnSeconds", "worldTickHz"] as const) {
    positive(s[k], `settings.${k}`);
  }
  if (s.replayPaddingSeconds < 0) throw new Error("settings.replayPaddingSeconds: phải ≥ 0");
  if (!Number.isInteger(s.disconnectMissedTurnsToKick) || s.disconnectMissedTurnsToKick < 1) {
    throw new Error("settings.disconnectMissedTurnsToKick: phải là số nguyên ≥ 1");
  }
  if (!Number.isInteger(s.maxTurnsPerMatch) || s.maxTurnsPerMatch < 1) {
    throw new Error("settings.maxTurnsPerMatch: phải là số nguyên ≥ 1");
  }
  for (const k of ["simHz", "trajectorySampleHz", "maxFlightSeconds", "maxProjectileSpeedTilesPerSec", "unitRadiusTiles"] as const) {
    positive(d.battle[k], `battle.${k}`);
  }
  positive(d.character.baseHp, "character.baseHp");
  positive(d.character.worldSpeedTilesPerSec, "character.worldSpeedTilesPerSec");
  positive(d.character.expPerLevel, "character.expPerLevel");
  if (d.character.signs.length === 0) throw new Error("character.signs: rỗng");
  if (d.character.commonGunIds.length === 0) throw new Error("character.commonGunIds: rỗng");
  for (const id of d.character.commonGunIds) {
    const g = d.guns[id];
    if (!g) throw new Error(`súng chung "${id}" không có trong sung.json`);
    if (g.sign !== null) throw new Error(`súng chung "${id}" phải có sign null`);
  }
  if (d.character.energyMax < d.character.energyStart || d.character.energyStart < 0) {
    throw new Error("character: energyStart phải nằm trong [0, energyMax]");
  }
  for (const sign of d.character.signs) {
    const sd = d.character.signDefs[sign]!;
    if (sd.gunIds.length === 0) throw new Error(`cung ${sign}: gunIds rỗng`);
    for (const id of sd.gunIds) {
      const g = d.guns[id];
      if (!g) throw new Error(`cung ${sign}: súng "${id}" không có trong sung.json`);
      if (g.sign !== sign) throw new Error(`cung ${sign}: súng "${id}" thuộc cung "${g.sign}"`);
    }
  }
  for (const g of Object.values(d.guns)) {
    const w = `súng ${g.id}`;
    if (g.kind === "burst" && (!g.count || !g.powerOffsets || g.powerOffsets.length !== g.count)) {
      throw new Error(`${w}: burst cần count và powerOffsets cùng độ dài`);
    }
    if (g.kind === "shower" && (!g.count || g.spreadTiles === undefined)) {
      throw new Error(`${w}: shower cần count và spreadTiles`);
    }
    if (g.kind === "self" && !g.selfEffect) throw new Error(`${w}: self cần selfEffect`);
  }

  for (const m of Object.values(d.monsters)) {
    const w = `quái ${m.id}`;
    if (!d.guns[m.gunId]) throw new Error(`${w}: súng "${m.gunId}" không có`);
    const bm = d.battleMaps[m.battleMapId];
    if (!bm) throw new Error(`${w}: bản đồ trận "${m.battleMapId}" không có`);
    if (!Number.isInteger(m.groupSize) || m.groupSize < 1) throw new Error(`${w}: groupSize phải là số nguyên ≥ 1`);
    if (m.groupSize > bm.monsterSpawnCols.length) {
      throw new Error(`${w}: groupSize ${m.groupSize} > số cột xuất phát của quái (${bm.monsterSpawnCols.length}) ở ${bm.id}`);
    }
    positive(m.hp, `${w}.hp`);
    positive(m.worldSpeedTilesPerSec, `${w}.worldSpeedTilesPerSec`);
  }

  for (const m of Object.values(d.battleMaps)) {
    const w = `bản đồ trận ${m.id}`;
    checkGrid(m, w);
    if (m.playerSpawnCols.length < 1) throw new Error(`${w}: thiếu playerSpawnCols`);
    for (const c of [...m.playerSpawnCols, ...m.monsterSpawnCols]) {
      if (c < 0 || c >= m.width) throw new Error(`${w}: cột xuất phát ${c} ngoài bản đồ`);
      if (!m.rows.some((r) => r[c] === "#")) throw new Error(`${w}: cột xuất phát ${c} không có đất`);
    }
  }

  for (const m of Object.values(d.worldMaps)) {
    const w = `bản đồ thế giới ${m.id}`;
    checkGrid(m, w);
    checkFloorPoint(m, m.spawn, `${w}.spawn`);
    for (const p of m.portals) {
      const dest = d.worldMaps[p.toMapId];
      if (!dest) throw new Error(`${w}: cổng trỏ tới bản đồ "${p.toMapId}" không có`);
      checkFloorPoint(dest, p.toSpawn, `${w}: toSpawn của cổng tới ${dest.id}`);
      if (p.w <= 0 || p.h <= 0) throw new Error(`${w}: cổng có kích thước ≤ 0`);
    }
    if (m.kind === "thanh" && m.monsterSpawns.length > 0) throw new Error(`${w}: thành không có quái`);
    for (const sp of m.monsterSpawns) {
      if (!d.monsters[sp.monsterId]) throw new Error(`${w}: quái "${sp.monsterId}" không có`);
      if (!Number.isInteger(sp.count) || sp.count < 0) throw new Error(`${w}: count phải là số nguyên ≥ 0`);
      const a = sp.area;
      if (a.w <= 0 || a.h <= 0 || a.x < 0 || a.y < 0 || a.x + a.w > m.width || a.y + a.h > m.height) {
        throw new Error(`${w}: vùng spawn nằm ngoài bản đồ`);
      }
      let floor = false;
      for (let r = Math.floor(a.y); r < a.y + a.h && !floor; r++) {
        for (let c = Math.floor(a.x); c < a.x + a.w; c++) {
          if (!solid(m.rows, c, r)) {
            floor = true;
            break;
          }
        }
      }
      if (!floor) throw new Error(`${w}: vùng spawn không có ô trống`);
    }
  }
}

export type { BattleConfig, GunStats };
