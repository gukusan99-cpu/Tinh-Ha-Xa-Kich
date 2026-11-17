import type { BattleConfig, BattleState, GunStats, Unit } from "../../src/battle/types.js";
import { createBattleState } from "../../src/battle/engine.js";

export const CFG: BattleConfig = {
  gravityTilesPerSec2: 30,
  maxProjectileSpeedTilesPerSec: 40,
  simHz: 60,
  trajectorySampleHz: 20,
  maxFlightSeconds: 10,
  selfHitGraceSeconds: 0.2,
  unitRadiusTiles: 0.75,
  moveRangeTiles: 5,
  maxClimbTiles: 1,
  aimAngleMinDegrees: -30,
  aimAngleMaxDegrees: 80,
  aiAngleStepDegrees: 5,
  deviationMaxTiles: 0,
  critChance: 0,
  critMultiplier: 1.5,
};

export const GUNS: Record<string, GunStats> = {
  g: { id: "g", damage: 35, blastRadiusTiles: 2 },
};

export function flatMap(width = 60, height = 30, groundTop = 20): { width: number; height: number; rows: string[] } {
  const rows: string[] = [];
  for (let r = 0; r < height; r++) rows.push((r >= groundTop ? "#" : ".").repeat(width));
  return { width, height, rows };
}

export function unit(id: number, col: number, team: 0 | 1, extra: Partial<Unit> = {}): Omit<Unit, "y" | "alive"> {
  return {
    id,
    kind: team === 0 ? "player" : "monster",
    name: `u${id}`,
    team,
    col,
    hp: 100,
    maxHp: 100,
    facing: team === 0 ? 1 : -1,
    gunId: "g",
    ...extra,
  };
}

export function mkState(
  units: Omit<Unit, "y" | "alive">[],
  map = flatMap(),
): BattleState {
  return createBattleState(map, units);
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

export function center(u: Unit, cfg = CFG): [number, number] {
  return [u.col + 0.5, u.y - cfg.unitRadiusTiles];
}
