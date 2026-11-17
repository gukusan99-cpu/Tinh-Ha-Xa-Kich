/**
 * Hợp đồng kiểu của engine trận (docs/06-kien-truc.md, mục "Luật vật lý trận";
 * docs/07-cung-va-sung.md cho súng, nội tại, hiệu ứng).
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
  /** Nội lực: hồi mỗi lượt (can-bang-v0.json) và trần (nhan-vat.json). */
  energyRegenPerTurn: number;
  energyMax: number;
  /** Thời lượng tối đa của hiệu ứng (can-bang-v0.json). */
  burnMaxTurns: number;
  stunMaxTurns: number;
  slowMaxTurns: number;
}

/** Một dòng của data/sung.json (docs/07). */
export interface GunStats {
  id: string;
  sign: SignId | null;
  kind: "projectile" | "burst" | "shower" | "self";
  damage: number;
  blastRadiusTiles: number;
  energyCost: number;
  cooldownTurns: number;
  count?: number; // burst, shower
  powerOffsets?: number[]; // burst
  spreadTiles?: number; // shower
  burn?: { turns: number; damagePerTurn: number };
  slow?: { turns: number; tiles: number };
  stun?: { turns: number };
  knockbackTiles?: number;
  craterDepthTiles?: number;
  selfEffect?: { type: "shield"; amount: number } | { type: "trueAim"; turns: number };
}

export type SignId = "bach_duong" | "kim_nguu" | "xu_nu" | "bao_binh";

/** Nội tại cung, lấy từ data/nhan-vat.json (docs/07, mục "Nội tại cung"). */
export type Passive =
  | { type: "earlyShot"; earlyShotSeconds: number; earlyShotDamageBonus: number; lineBonus: number }
  | { type: "toughness"; damageTakenReduction: number; lineBonus: number }
  | { type: "precision"; deviationReduction: number; lineBonus: number; aimPreviewFraction: number; aimPreviewPerSecond: number }
  | { type: "meteorPush"; digBelowOnHit: number; lineBonusStones: number; lineBonus: number };

export type Status =
  | { type: "burn"; turns: number; damagePerTurn: number }
  | { type: "slow"; turns: number; tiles: number }
  | { type: "stun"; turns: number }
  | { type: "shield"; turns: number; amount: number } // amount = lượng còn lại
  | { type: "trueAim"; turns: number };

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
  /** Súng mặc định (quái dùng súng này). */
  gunId: string;
  /** Người chơi: bộ súng mang theo. Quái: [gunId]. */
  guns: string[];
  sign: SignId | null;
  passive: Passive | null;
  energy: number;
  cooldowns: Record<string, number>; // gunId -> số lượt còn phải chờ
  statuses: Status[];
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
  gunId: string;
  /** Giây kể từ đầu pha ngắm tới lệnh bắn cuối cùng (nội tại Bạch Dương). */
  aimElapsedSeconds: number;
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
  gunId: string;
  /** Viên con (burst, sao băng của shower): chỉ số của phát gốc trong shots[]; phát gốc là null. */
  parentIndex: number | null;
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

export interface StatusEvent {
  unitId: number;
  sourceUnitId: number;
  status: Status; // trạng thái sau khi áp (đã xử lý quy tắc "giữ cái mạnh hơn")
}

export interface KnockbackEvent {
  unitId: number;
  fromCol: number;
  toCol: number;
}

export interface TurnResult {
  turn: number;
  /** Hiệu ứng self (khiên, ngắm chuẩn) áp trước mọi vụ nổ. */
  selfEffects: StatusEvent[];
  shots: ShotResult[];
  explosions: Explosion[]; // theo thứ tự áp dụng
  /** amount là sát thương thật sau khiên và giảm sát thương. */
  damage: DamageEvent[];
  shieldAbsorbed: { unitId: number; amount: number }[];
  statusEvents: StatusEvent[];
  knockbacks: KnockbackEvent[];
  falls: FallEvent[];
  /** Sát thương cháy cuối lượt. */
  burnTicks: DamageEvent[];
  deaths: number[];
  /** Trạng thái mỗi đơn vị sau lượt (năng lượng đã cộng hồi cho lượt sau, hồi chiêu đã giảm). */
  units: { id: number; hp: number; energy: number; cooldowns: Record<string, number>; statuses: Status[] }[];
}

export type MatchOutcome = "win" | "lose" | "draw" | null; // null: chưa kết thúc

/**
 * Các hàm engine phải xuất ra (server/src/battle/engine.ts):
 *
 * createBattleState(map: {width,height,rows}, units: Omit<Unit,"y"|"alive">[]): BattleState
 *   – đặt y của mỗi đơn vị lên mặt đất cột của nó.
 * applyMoves(state, cmds: MoveCommand[], cfg): { state: BattleState; moves: UnitMove[] }
 *   – choáng: không đi; chậm: giảm quãng đi.
 * validateShot(state, cmd, guns): "ok" | "not_allowed"   – súng trong bộ, đủ nội lực, hết hồi
 * resolveShots(state, cmds: ShotCommand[], guns: Record<string,GunStats>, cfg, seed: number):
 *   { state: BattleState; result: TurnResult }   – state trả về có turn = turn cũ + 1
 *   – lệnh không hợp lệ bị bỏ qua (như không bắn).
 * previewShot(state, cmd, guns, cfg, fraction): [number, number][]   – Súng kính, không lệch
 * chooseMonsterShot(state, unitId, guns, cfg): ShotCommand
 * winnerTeam(state, maxTurns): 0 | 1 | "draw" | null
 *   – đội còn người sống khi đội kia hết; "draw" nếu cả hai hết cùng lúc hoặc state.turn > maxTurns;
 *     null nếu chưa kết thúc. Dùng cho PvE và PvP (docs/08).
 * outcome(state, maxTurns): MatchOutcome   – góc nhìn đội 0, giữ để tương thích
 *   – "lose" nếu không còn người chơi sống (ưu tiên trước "win"), "win" nếu không còn quái sống,
 *     "draw" nếu state.turn > maxTurns, ngược lại null.
 * mulberry32(seed: number): () => number
 */
