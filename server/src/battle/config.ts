import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BattleConfig, GunStats, SignId } from "./types.js";

const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));

/** Khóa số lấy từ data/can-bang-v0.json. */
const CONFIG_KEYS = [
  "gravityTilesPerSec2",
  "maxProjectileSpeedTilesPerSec",
  "simHz",
  "trajectorySampleHz",
  "maxFlightSeconds",
  "selfHitGraceSeconds",
  "unitRadiusTiles",
  "moveRangeTiles",
  "maxClimbTiles",
  "aimAngleMinDegrees",
  "aimAngleMaxDegrees",
  "aiAngleStepDegrees",
  "deviationMaxTiles",
  "critChance",
  "critMultiplier",
  "energyRegenPerTurn",
  "burnMaxTurns",
  "stunMaxTurns",
  "slowMaxTurns",
  "poisonMaxTurns",
  "rootMaxTurns",
] as const;

const SIGN_IDS: readonly string[] = ["bach_duong", "kim_nguu", "xu_nu", "bao_binh"];

function readJson(name: string): Record<string, unknown> {
  const text = readFileSync(DATA_DIR + name, "utf8").replace(/^﻿/, "");
  return JSON.parse(text) as Record<string, unknown>;
}

function finite(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${where}: thiếu hoặc sai khóa số "${key}"`);
  }
  return v;
}

export function loadBattleConfig(): BattleConfig {
  const raw = readJson("can-bang-v0.json");
  const out: Record<string, number> = {};
  for (const k of CONFIG_KEYS) out[k] = finite(raw, k, "data/can-bang-v0.json");
  out["energyMax"] = finite(readJson("nhan-vat.json"), "energyMax", "data/nhan-vat.json");
  return out as unknown as BattleConfig;
}

function obj(v: unknown, w: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${w}: phải là object`);
  return v as Record<string, unknown>;
}

function optNum(o: Record<string, unknown>, k: string, w: string): number | undefined {
  return o[k] === undefined ? undefined : finite(o, k, w);
}

export function loadGuns(): Record<string, GunStats> {
  const raw = readJson("sung.json");
  const list = raw["guns"];
  if (!Array.isArray(list)) throw new Error('data/sung.json: thiếu mảng "guns"');
  const guns: Record<string, GunStats> = {};
  for (const item of list) {
    const g = obj(item, "data/sung.json: súng");
    const id = g["id"];
    if (typeof id !== "string" || id === "") throw new Error("data/sung.json: súng thiếu id");
    const w = `data/sung.json[${id}]`;
    const sign = g["sign"];
    if (sign !== null && (typeof sign !== "string" || !SIGN_IDS.includes(sign))) {
      throw new Error(`${w}: "sign" phải là null hoặc một cung hợp lệ`);
    }
    const kind = g["kind"];
    if (kind !== "projectile" && kind !== "burst" && kind !== "shower" && kind !== "self" && kind !== "spread" && kind !== "beam") {
      throw new Error(`${w}: "kind" không hợp lệ`);
    }
    const gun: GunStats = {
      id,
      sign: sign as SignId | null,
      kind,
      damage: finite(g, "damage", w),
      blastRadiusTiles: finite(g, "blastRadiusTiles", w),
      energyCost: finite(g, "energyCost", w),
      cooldownTurns: finite(g, "cooldownTurns", w),
    };
    const tang = g["tang"];
    if (tang === "thuong" || tang === "hiem" || tang === "cung" || tang === "quai") gun.tier = tang;
    if (kind === "spread") {
      const offs = g["angleOffsets"];
      if (!Array.isArray(offs) || offs.length < 1 || offs.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        throw new Error(`${w}: "angleOffsets" phải là mảng số không rỗng`);
      }
      gun.angleOffsets = offs as number[];
      gun.count = offs.length;
      if (g["count"] !== undefined && g["count"] !== offs.length) throw new Error(`${w}: "count" phải bằng độ dài angleOffsets`);
    } else if (kind === "beam") {
      gun.beamLengthTiles = finite(g, "beamLengthTiles", w);
      gun.pierceTiles = finite(g, "pierceTiles", w);
    } else if (kind === "burst") {
      gun.count = finite(g, "count", w);
      const offs = g["powerOffsets"];
      if (!Array.isArray(offs) || offs.length !== gun.count || offs.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        throw new Error(`${w}: "powerOffsets" phải là mảng ${gun.count} số`);
      }
      gun.powerOffsets = offs as number[];
    } else if (kind === "shower") {
      gun.count = finite(g, "count", w);
      gun.spreadTiles = finite(g, "spreadTiles", w);
    } else if (kind === "self") {
      const se = obj(g["selfEffect"], `${w}.selfEffect`);
      if (se["type"] === "shield") gun.selfEffect = { type: "shield", amount: finite(se, "amount", `${w}.selfEffect`) };
      else if (se["type"] === "trueAim") gun.selfEffect = { type: "trueAim", turns: finite(se, "turns", `${w}.selfEffect`) };
      else throw new Error(`${w}: selfEffect.type không hợp lệ`);
    }
    if (g["burn"] !== undefined) {
      const b = obj(g["burn"], `${w}.burn`);
      gun.burn = { turns: finite(b, "turns", `${w}.burn`), damagePerTurn: finite(b, "damagePerTurn", `${w}.burn`) };
    }
    if (g["slow"] !== undefined) {
      const s = obj(g["slow"], `${w}.slow`);
      gun.slow = { turns: finite(s, "turns", `${w}.slow`), tiles: finite(s, "tiles", `${w}.slow`) };
    }
    if (g["stun"] !== undefined) {
      gun.stun = { turns: finite(obj(g["stun"], `${w}.stun`), "turns", `${w}.stun`) };
    }
    if (g["root"] !== undefined) gun.root = { turns: finite(obj(g["root"], `${w}.root`), "turns", `${w}.root`) };
    const mp = optNum(g, "maxPower", w);
    if (mp !== undefined) gun.maxPower = mp;
    if (g["zone"] !== undefined) {
      const z = obj(g["zone"], `${w}.zone`);
      const p = obj(z["poison"], `${w}.zone.poison`);
      gun.zone = {
        radiusTiles: finite(z, "radiusTiles", `${w}.zone`),
        turns: finite(z, "turns", `${w}.zone`),
        poison: { turns: finite(p, "turns", `${w}.zone.poison`), damagePerTurn: finite(p, "damagePerTurn", `${w}.zone.poison`) },
      };
    }
    if (g["chain"] !== undefined) {
      const c = obj(g["chain"], `${w}.chain`);
      gun.chain = {
        maxTargets: finite(c, "maxTargets", `${w}.chain`),
        radiusTiles: finite(c, "radiusTiles", `${w}.chain`),
        falloff: finite(c, "falloff", `${w}.chain`),
      };
    }
    const kb = optNum(g, "knockbackTiles", w);
    if (kb !== undefined) gun.knockbackTiles = kb;
    const cd = optNum(g, "craterDepthTiles", w);
    if (cd !== undefined) gun.craterDepthTiles = cd;
    guns[id] = gun;
  }
  return guns;
}
