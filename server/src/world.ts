/** Thế giới nhìn từ trên xuống: di chuyển, cổng, quái lang thang, chạm quái. Thuần logic, không timer. */
import type { GameData, MonsterSpawn, Rect, WorldMapDef } from "./data.js";
import type { Entity } from "./protocol.js";

/** Bước kiểm tra tường dọc đường đi (đơn vị ô). Nhỏ hơn bề dày tường (1 ô) nhiều. */
const SUBSTEP = 0.1;

export interface PlayerEntity {
  id: number;
  kind: "player";
  name: string;
  x: number;
  y: number;
  mapId: string;
  ownerKey: string;
  target: { x: number; y: number } | null;
}
export interface MonsterEntity {
  id: number;
  kind: "monster";
  name: string;
  x: number;
  y: number;
  mapId: string;
  monsterId: string;
  spawnIndex: number;
  target: { x: number; y: number } | null;
  idleUntil: number;
}

export interface WorldEvents {
  onTransfer(player: PlayerEntity, toMapId: string): void;
  onContact(player: PlayerEntity, monster: MonsterEntity, mapId: string): void;
}

export function isBlocked(map: WorldMapDef, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.rows[Math.floor(y)]?.[Math.floor(x)] === "#";
}

export interface MoveResult {
  x: number;
  y: number;
  arrived: boolean;
  blocked: boolean;
}

/** Đi thẳng từ (x,y) về (tx,ty) tối đa `dist` ô; dừng ngay trước tường / mép bản đồ. */
export function moveToward(map: WorldMapDef, x: number, y: number, tx: number, ty: number, dist: number): MoveResult {
  const full = Math.hypot(tx - x, ty - y);
  if (full === 0) return { x, y, arrived: true, blocked: false };
  const d = Math.min(dist, full);
  const n = Math.max(1, Math.ceil(d / SUBSTEP));
  let lx = x;
  let ly = y;
  for (let i = 1; i <= n; i++) {
    const nx = x + ((tx - x) / full) * d * (i / n);
    const ny = y + ((ty - y) / full) * d * (i / n);
    if (isBlocked(map, nx, ny)) return { x: lx, y: ly, arrived: false, blocked: true };
    lx = nx;
    ly = ny;
  }
  return { x: lx, y: ly, arrived: d >= full, blocked: false };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface WorldOptions {
  data: GameData;
  events: WorldEvents;
  random?: () => number;
}

interface Respawn {
  at: number;
  mapId: string;
  spawnIndex: number;
}

export class World {
  private readonly data: GameData;
  private readonly events: WorldEvents;
  private readonly random: () => number;
  private nextId = 1;
  private time = 0;
  private readonly players = new Map<number, PlayerEntity>();
  private readonly monsters = new Map<number, MonsterEntity>();
  private respawns: Respawn[] = [];

  constructor(opts: WorldOptions) {
    this.data = opts.data;
    this.events = opts.events;
    this.random = opts.random ?? Math.random;
    for (const map of Object.values(this.data.worldMaps)) {
      map.monsterSpawns.forEach((sp, i) => {
        for (let k = 0; k < sp.count; k++) this.spawnFromRule(map, sp, i);
      });
    }
  }

  private floorPointIn(map: WorldMapDef, a: Rect): { x: number; y: number } {
    for (let i = 0; i < 50; i++) {
      const x = a.x + this.random() * a.w;
      const y = a.y + this.random() * a.h;
      if (!isBlocked(map, x, y)) return { x, y };
    }
    for (let r = Math.floor(a.y); r < a.y + a.h; r++) {
      for (let c = Math.floor(a.x); c < a.x + a.w; c++) {
        if (!isBlocked(map, c + 0.5, r + 0.5)) return { x: c + 0.5, y: r + 0.5 };
      }
    }
    throw new Error(`vùng spawn không có ô trống trong ${map.id}`); // validateGameData đã chặn
  }

  private spawnFromRule(map: WorldMapDef, sp: MonsterSpawn, spawnIndex: number): MonsterEntity {
    const p = this.floorPointIn(map, sp.area);
    return this.spawnMonster(map.id, sp.monsterId, p.x, p.y, spawnIndex);
  }

  spawnMonster(mapId: string, monsterId: string, x: number, y: number, spawnIndex = -1): MonsterEntity {
    const def = this.data.monsters[monsterId];
    if (!def) throw new Error(`quái không có: ${monsterId}`);
    const m: MonsterEntity = {
      id: this.nextId++,
      kind: "monster",
      name: def.name,
      x,
      y,
      mapId,
      monsterId,
      spawnIndex,
      target: null,
      idleUntil: this.time + this.random() * 2,
    };
    this.monsters.set(m.id, m);
    return m;
  }

  addPlayer(ownerKey: string, name: string, mapId: string, x?: number, y?: number): PlayerEntity {
    const map = this.mapDef(mapId);
    const p: PlayerEntity = {
      id: this.nextId++,
      kind: "player",
      name,
      x: x ?? map.spawn.x,
      y: y ?? map.spawn.y,
      mapId,
      ownerKey,
      target: null,
    };
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }
  getPlayer(id: number): PlayerEntity | undefined {
    return this.players.get(id);
  }
  mapDef(mapId: string): WorldMapDef {
    const m = this.data.worldMaps[mapId];
    if (!m) throw new Error(`bản đồ không có: ${mapId}`);
    return m;
  }
  setTarget(id: number, x: number, y: number): void {
    const p = this.players.get(id);
    if (p) p.target = { x, y };
  }
  /** Đặt thẳng vị trí một thực thể (dùng cho test). */
  teleport(id: number, x: number, y: number): void {
    const e = this.players.get(id) ?? this.monsters.get(id);
    if (e) {
      e.x = x;
      e.y = y;
      e.target = null;
    }
  }
  playersIn(mapId: string): PlayerEntity[] {
    return [...this.players.values()].filter((p) => p.mapId === mapId);
  }
  monstersIn(mapId: string): MonsterEntity[] {
    return [...this.monsters.values()].filter((m) => m.mapId === mapId);
  }
  entities(mapId: string): Entity[] {
    const out: Entity[] = [];
    for (const p of this.playersIn(mapId)) out.push({ id: p.id, kind: "player", name: p.name, x: round2(p.x), y: round2(p.y) });
    for (const m of this.monstersIn(mapId)) {
      out.push({ id: m.id, kind: "monster", name: m.name, x: round2(m.x), y: round2(m.y), monsterId: m.monsterId });
    }
    return out;
  }

  step(dt: number): void {
    this.time += dt;
    this.runRespawns();
    this.moveMonsters(dt);
    for (const p of [...this.players.values()]) {
      this.movePlayer(p, dt);
      if (!this.players.has(p.id)) continue;
      this.checkPortal(p);
    }
    this.checkContacts();
  }

  private runRespawns(): void {
    if (this.respawns.length === 0) return;
    const due = this.respawns.filter((r) => r.at <= this.time);
    this.respawns = this.respawns.filter((r) => r.at > this.time);
    for (const r of due) {
      const map = this.mapDef(r.mapId);
      const sp = map.monsterSpawns[r.spawnIndex];
      if (sp) this.spawnFromRule(map, sp, r.spawnIndex);
    }
  }

  private movePlayer(p: PlayerEntity, dt: number): void {
    if (!p.target) return;
    const map = this.mapDef(p.mapId);
    const r = moveToward(map, p.x, p.y, p.target.x, p.target.y, this.data.character.worldSpeedTilesPerSec * dt);
    p.x = r.x;
    p.y = r.y;
    if (r.arrived || r.blocked) p.target = null;
  }

  private checkPortal(p: PlayerEntity): void {
    const map = this.mapDef(p.mapId);
    for (const portal of map.portals) {
      if (p.x >= portal.x && p.x < portal.x + portal.w && p.y >= portal.y && p.y < portal.y + portal.h) {
        p.mapId = portal.toMapId;
        p.x = portal.toSpawn.x;
        p.y = portal.toSpawn.y;
        p.target = null;
        this.events.onTransfer(p, portal.toMapId);
        return;
      }
    }
  }

  private moveMonsters(dt: number): void {
    for (const m of this.monsters.values()) {
      const map = this.mapDef(m.mapId);
      const sp = map.monsterSpawns[m.spawnIndex];
      if (!sp) continue;
      if (!m.target) {
        if (this.time < m.idleUntil) continue;
        m.target = this.floorPointIn(map, sp.area);
      }
      const speed = this.data.monsters[m.monsterId]!.worldSpeedTilesPerSec;
      const r = moveToward(map, m.x, m.y, m.target.x, m.target.y, speed * dt);
      m.x = r.x;
      m.y = r.y;
      if (r.arrived || r.blocked) {
        m.target = null;
        m.idleUntil = this.time + 0.5 + this.random() * 2;
      }
    }
  }

  private checkContacts(): void {
    const radius = this.data.settings.contactRadiusTiles;
    for (const p of [...this.players.values()]) {
      if (!this.players.has(p.id)) continue;
      if (this.mapDef(p.mapId).kind !== "vung_san") continue;
      for (const m of this.monstersIn(p.mapId)) {
        if (Math.hypot(m.x - p.x, m.y - p.y) > radius) continue;
        this.players.delete(p.id);
        this.monsters.delete(m.id);
        if (m.spawnIndex >= 0) {
          this.respawns.push({
            at: this.time + this.data.settings.monsterRespawnSeconds,
            mapId: m.mapId,
            spawnIndex: m.spawnIndex,
          });
        }
        this.events.onContact(p, m, p.mapId);
        break;
      }
    }
  }
}
