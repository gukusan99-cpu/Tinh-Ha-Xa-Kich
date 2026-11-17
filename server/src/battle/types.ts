/**
 * Hợp đồng kiểu của engine trận (docs/06-kien-truc.md, mục "Luật vật lý trận").
 * Engine là hàm thuần, tất định theo seed; không có I/O, không có timer.
 * Đổi file này = đổi giao thức: cập nhật docs/06 và client cùng lúc.
 */

/** Hằng số lấy từ data/can-bang-v0.json (không hard-code). */
export interface BattleConfig {
  gravityTilesPerSec2: number;
  maxProjectileSpeedTilesPerSec: number;
  simHz: number;
  trajectorySampleHz: number;
  maxFlightSeconds: number;
  selfHitGraceSeconds: number;
  unitRadiusTiles: number;
  moveRangeTiles: number;
  maxClimbTiles: number;
  aimAngleMinDegrees: number;
  aimAngleMaxDegrees: number;
  aiAngleStepDegrees: number;
  deviationMaxTiles: number;
  critChance: number;
  critMultiplier: number;
}

export interface GunStats {
  id: string;
  damage: number;
  blastRadiusTiles: number;
}

export type Team = 0 | 1; // 0 người chơi, 1 quái
export type Facing = -1 | 1;

export interface Unit {
  id: number; // thứ tự xử lý tăng dần theo id
  kind: "player" | "monster";
  name: string;
  team: Team;
  col: number; // cột đang đứng (số nguyên)
  y: number; // hàng của ô đất ngay dưới chân
  hp: number;
  maxHp: number;
  facing: Facing;
  gunId: string;
  /** Chỉ quái: độ lệch riêng thay cho deviationMaxTiles. */
  aiErrorTiles?: number;
  alive: boolean;
}

export interface BattleState {
  width: number;
  height: number;
  /** rows[r][c] === "#" là đất. Engine trả về bản sao mới, không sửa tại chỗ. */
  rows: string[];
  units: Unit[];
  turn: number; // bắt đầu từ 1
}

export interface ShotCommand {
  unitId: number;
  angle: number; // độ, đã kẹp trong [aimAngleMin, aimAngleMax]
  power: number; // 0..100
  facing: Facing;
}

export interface MoveCommand {
  unitId: number;
  col: number; // cột đích
}

export interface UnitMove {
  unitId: number;
  path: number[]; // các cột đã đi qua, không gồm cột xuất phát
  col: number;
  y: number;
}

export interface ShotResult {
  unitId: number;
  points: [number, number][]; // quỹ đạo lấy mẫu, đã làm tròn 2 chữ số, luôn có điểm cuối
  impact: { x: number; y: number } | null; // null nếu bay ra ngoài
  hitUnitId: number | null;
  crit: boolean;
  flightSeconds: number;
}

export interface Explosion {
  unitId: number; // người bắn
  x: number;
  y: number;
  radius: number;
  removedTiles: [number, number][]; // [col, row]
}

export interface DamageEvent {
  unitId: number;
  sourceUnitId: number;
  amount: number;
  hpAfter: number;
}

export interface FallEvent {
  unitId: number;
  y: number; // hàng mới; -1 nếu rơi khỏi bản đồ
}

export interface TurnResult {
  turn: number;
  shots: ShotResult[];
  explosions: Explosion[]; // theo thứ tự áp dụng
  damage: DamageEvent[];
  falls: FallEvent[];
  deaths: number[];
}

export type MatchOutcome = "win" | "lose" | "draw" | null; // null: chưa kết thúc

/**
 * Các hàm engine phải xuất ra (server/src/battle/engine.ts):
 *
 * createBattleState(map: {width,height,rows}, units: Omit<Unit,"y"|"alive">[]): BattleState
 *   – đặt y của mỗi đơn vị lên mặt đất cột của nó.
 * applyMoves(state, cmds: MoveCommand[], cfg): { state: BattleState; moves: UnitMove[] }
 * resolveShots(state, cmds: ShotCommand[], guns: Record<string,GunStats>, cfg, seed: number):
 *   { state: BattleState; result: TurnResult }   – state trả về có turn = turn cũ + 1
 * chooseMonsterShot(state, unitId, guns, cfg): ShotCommand
 * outcome(state, maxTurns): MatchOutcome
 *   – "lose" nếu không còn người chơi sống (ưu tiên trước "win"), "win" nếu không còn quái sống,
 *     "draw" nếu state.turn > maxTurns, ngược lại null.
 * mulberry32(seed: number): () => number
 */
