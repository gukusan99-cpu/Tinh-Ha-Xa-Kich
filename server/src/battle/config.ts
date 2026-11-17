import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BattleConfig, GunStats } from "./types.js";

const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));

const CONFIG_KEYS: (keyof Omit<BattleConfig, never>)[] = [
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
];

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
  return out as unknown as BattleConfig;
}

export function loadGuns(): Record<string, GunStats> {
  const raw = readJson("sung.json");
  const list = raw["guns"];
  if (!Array.isArray(list)) throw new Error('data/sung.json: thiếu mảng "guns"');
  const guns: Record<string, GunStats> = {};
  for (const item of list) {
    const g = item as Record<string, unknown>;
    const id = g["id"];
    if (typeof id !== "string" || id === "") throw new Error("data/sung.json: súng thiếu id");
    guns[id] = {
      id,
      damage: finite(g, "damage", `data/sung.json[${id}]`),
      blastRadiusTiles: finite(g, "blastRadiusTiles", `data/sung.json[${id}]`),
    };
  }
  return guns;
}
