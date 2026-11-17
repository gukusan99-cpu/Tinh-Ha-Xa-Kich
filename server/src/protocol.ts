/** Giao thức Giai đoạn 0 + 1 + 2 (xem docs/06-kien-truc.md, docs/08-thach-dau.md). */
import type { Status, TurnResult, ZoneInfo } from "./battle/types.js";

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_CLIENT_VERSION_LENGTH = 32;

/** Giới hạn thô của chuỗi trong thông điệp tài khoản; luật chi tiết kiểm ở tầng tài khoản. */
const MAX_RAW_STRING = 256;
/** Góc cực đoan bị từ chối ở tầng giao thức; góc hợp lý được máy chủ kẹp theo dữ liệu. */
const MAX_ABS_ANGLE = 360;
const MAX_ABS_COORD = 1e6;
const MAX_GUN_ID_LENGTH = 64;
const MAX_ID_LENGTH = 64;
/** Giới hạn thô số phần tử của set_loadout; số ô thật do máy chủ kiểm theo dữ liệu. */
const MAX_LOADOUT_IDS = 16;

export type ErrorCode =
  | "bad_json"
  | "bad_version"
  | "bad_message"
  | "not_hello"
  | "unknown_type"
  | "too_large"
  | "not_allowed";

// ---------- luật chuỗi ----------

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const validateUsername = (s: string): boolean => USERNAME_RE.test(s);
export const validatePassword = (s: string): boolean => {
  const n = Array.from(s).length;
  return n >= 6 && n <= 64;
};
/** Trim, 2-16 ký tự (theo code point), không ký tự điều khiển. Trả null nếu sai. */
export function normalizeCharacterName(s: string): string | null {
  const t = s.trim();
  const n = Array.from(t).length;
  if (n < 2 || n > 16) return null;
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(t)) return null;
  return t;
}

// ---------- C→S ----------

export interface HelloMessage {
  v: 1;
  type: "hello";
  clientVersion: string;
}
export interface PingMessage {
  v: 1;
  type: "ping";
  seq: number;
}
export interface RegisterMessage {
  v: 1;
  type: "register";
  username: string;
  password: string;
}
export interface LoginMessage {
  v: 1;
  type: "login";
  username: string;
  password: string;
}
export interface CreateCharacterMessage {
  v: 1;
  type: "create_character";
  name: string;
  sign: string;
}
export interface EnterWorldMessage {
  v: 1;
  type: "enter_world";
}
export interface MoveToMessage {
  v: 1;
  type: "move_to";
  x: number;
  y: number;
}
export interface BattleMoveMessage {
  v: 1;
  type: "battle_move";
  col: number;
}
export interface BattleShotMessage {
  v: 1;
  type: "battle_shot";
  angle: number;
  power: number;
  facing: -1 | 1;
  gunId: string;
}
export interface AimPreviewMessage {
  v: 1;
  type: "aim_preview";
  gunId: string;
  angle: number;
  power: number;
  facing: -1 | 1;
}
export interface ChallengeMessage {
  v: 1;
  type: "challenge";
  targetEntityId: number;
}
export interface ChallengeReplyMessage {
  v: 1;
  type: "challenge_reply";
  challengeId: string;
  accept: boolean;
}
export interface ChallengeCancelMessage {
  v: 1;
  type: "challenge_cancel";
  challengeId: string;
}
/** Đổi súng chung mang theo (chỉ trong thành, docs/10). */
export interface SetLoadoutMessage {
  v: 1;
  type: "set_loadout";
  gunIds: string[];
}
export type ClientMessage =
  | HelloMessage
  | PingMessage
  | RegisterMessage
  | LoginMessage
  | CreateCharacterMessage
  | EnterWorldMessage
  | MoveToMessage
  | BattleMoveMessage
  | BattleShotMessage
  | AimPreviewMessage
  | ChallengeMessage
  | ChallengeReplyMessage
  | ChallengeCancelMessage
  | SetLoadoutMessage;

// ---------- S→C ----------

export interface Character {
  name: string;
  sign: string;
  level: number;
  exp: number;
  gunId: string;
  /** Kho súng chung đã có (không trùng). */
  ownedGunIds: string[];
  /** Súng chung đang mang (tối đa extraGunSlots, đều nằm trong kho). */
  loadout: string[];
  /** Thành tích thách đấu (docs/08). */
  pvp: { wins: number; losses: number; draws: number };
}
export interface Entity {
  id: number;
  kind: "player" | "monster";
  name: string;
  x: number;
  y: number;
  monsterId?: string;
  /** Chỉ người chơi: để hiển thị trước khi mời thách đấu. */
  sign?: string;
  level?: number;
}
export interface UnitInfo {
  id: number;
  kind: "player" | "monster";
  name: string;
  team: 0 | 1;
  col: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: -1 | 1;
  energy: number;
  cooldowns: Record<string, number>;
  statuses: Status[];
  /** Chỉ người chơi: bộ súng đang mang. */
  guns?: string[];
  /** Chỉ quái: id loại quái (data/quai.json). */
  monsterId?: string;
}
/** Trạng thái đơn vị gửi kèm mỗi `phase`. */
export interface UnitPhaseState {
  id: number;
  hp: number;
  energy: number;
  cooldowns: Record<string, number>;
  statuses: Status[];
  guns?: string[];
}

export interface WelcomeMessage {
  v: 1;
  type: "welcome";
  sessionId: string;
  serverVersion: string;
  serverTime: number;
}
export interface PongMessage {
  v: 1;
  type: "pong";
  seq: number;
  serverTime: number;
}
export interface ErrorMessage {
  v: 1;
  type: "error";
  code: ErrorCode;
  message: string;
}
export interface AuthOkMessage {
  v: 1;
  type: "auth_ok";
  username: string;
  character: Character | null;
}
export type AuthErrorCode = "taken" | "bad_credentials" | "invalid";
export interface AuthErrorMessage {
  v: 1;
  type: "auth_error";
  code: AuthErrorCode;
}
export interface CharacterMessage {
  v: 1;
  type: "character";
  character: Character;
}
export interface WorldStateMessage {
  v: 1;
  type: "world_state";
  mapId: string;
  width: number;
  height: number;
  rows: string[];
  you: number;
  entities: Entity[];
}
export interface WorldTickMessage {
  v: 1;
  type: "world_tick";
  entities: Entity[];
}
export interface MatchStartMessage {
  v: 1;
  type: "match_start";
  matchId: string;
  mode: "pve" | "pvp";
  /** Id bản đồ trận đang dùng (data/tran/). */
  battleMapId: string;
  map: { width: number; height: number; rows: string[] };
  units: UnitInfo[];
  you: number;
  maxTurns: number;
}
export interface PhaseMessage {
  v: 1;
  type: "phase";
  turn: number;
  phase: "move" | "aim";
  deadline: number;
  serverTime: number;
  units: UnitPhaseState[];
  /** Vũng đang tồn tại (active=false: cảnh báo, chưa gây độc). */
  zones: ZoneInfo[];
}
export interface AimPreviewResultMessage {
  v: 1;
  type: "aim_preview";
  points: [number, number][];
}
export interface MovesResultMessage {
  v: 1;
  type: "moves_result";
  turn: number;
  moves: { unitId: number; path: number[]; col: number; y: number }[];
}
export type TurnResultMessage = { v: 1; type: "turn_result" } & TurnResult;
export interface MatchEndMessage {
  v: 1;
  type: "match_end";
  matchId: string;
  result: "win" | "lose" | "draw";
  rewards: { exp: number };
  /** Súng mới nhận (đã có thì không tính); PvP luôn rỗng. */
  drops: string[];
  character: Character;
}
export interface ChallengeSentMessage {
  v: 1;
  type: "challenge_sent";
  challengeId: string;
  targetName: string;
  expiresAt: number;
}
export interface ChallengeReceivedMessage {
  v: 1;
  type: "challenge_received";
  challengeId: string;
  fromName: string;
  fromSign: string;
  fromLevel: number;
  expiresAt: number;
}
/** Cổng khóa cấp (docs/09): người chơi chưa đủ cấp đứng vào cổng. */
export interface PortalLockedMessage {
  v: 1;
  type: "portal_locked";
  levelRequired: number;
}
export type ChallengeCloseReason = "accepted" | "declined" | "expired" | "cancelled" | "unavailable";
export interface ChallengeClosedMessage {
  v: 1;
  type: "challenge_closed";
  challengeId: string;
  reason: ChallengeCloseReason;
}
export type ServerMessage =
  | WelcomeMessage
  | PongMessage
  | ErrorMessage
  | AuthOkMessage
  | AuthErrorMessage
  | CharacterMessage
  | WorldStateMessage
  | WorldTickMessage
  | MatchStartMessage
  | PhaseMessage
  | MovesResultMessage
  | AimPreviewResultMessage
  | TurnResultMessage
  | MatchEndMessage
  | ChallengeSentMessage
  | ChallengeReceivedMessage
  | ChallengeClosedMessage
  | PortalLockedMessage;

// ---------- parse ----------

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; code: ErrorCode };

const fail = (code: ErrorCode): ParseResult => ({ ok: false, code });
const bad = (): ParseResult => fail("bad_message");
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isRawString = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_RAW_STRING;

/** Kiểm tra từng trường bằng tay; không tin bất cứ gì từ client. */
export function parseClientMessage(raw: string | Buffer): ParseResult {
  const byteLength = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.length;
  if (byteLength > MAX_MESSAGE_BYTES) return fail("too_large");

  let data: unknown;
  try {
    data = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return fail("bad_json");
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) return bad();
  const obj = data as Record<string, unknown>;

  if (obj.v !== PROTOCOL_VERSION) return fail("bad_version");
  if (typeof obj.type !== "string") return bad();

  switch (obj.type) {
    case "hello": {
      const cv = obj.clientVersion;
      if (typeof cv !== "string" || cv.length === 0 || cv.length > MAX_CLIENT_VERSION_LENGTH) return bad();
      return { ok: true, message: { v: 1, type: "hello", clientVersion: cv } };
    }
    case "ping": {
      const seq = obj.seq;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return bad();
      return { ok: true, message: { v: 1, type: "ping", seq } };
    }
    case "register":
    case "login": {
      const { username, password } = obj;
      if (!isRawString(username) || !isRawString(password)) return bad();
      return { ok: true, message: { v: 1, type: obj.type, username, password } };
    }
    case "create_character": {
      const { name, sign } = obj;
      if (!isRawString(name) || !isRawString(sign) || sign === "") return bad();
      const n = normalizeCharacterName(name);
      if (n === null) return bad();
      return { ok: true, message: { v: 1, type: "create_character", name: n, sign } };
    }
    case "enter_world":
      return { ok: true, message: { v: 1, type: "enter_world" } };
    case "move_to": {
      const { x, y } = obj;
      if (!isNum(x) || !isNum(y) || Math.abs(x) > MAX_ABS_COORD || Math.abs(y) > MAX_ABS_COORD) return bad();
      return { ok: true, message: { v: 1, type: "move_to", x, y } };
    }
    case "battle_move": {
      const col = obj.col;
      if (typeof col !== "number" || !Number.isSafeInteger(col)) return bad();
      return { ok: true, message: { v: 1, type: "battle_move", col } };
    }
    case "battle_shot":
    case "aim_preview": {
      const { angle, power, facing, gunId } = obj;
      if (!isNum(angle) || Math.abs(angle) > MAX_ABS_ANGLE) return bad();
      if (!isNum(power) || power < 0 || power > 100) return bad();
      if (facing !== 1 && facing !== -1) return bad();
      if (typeof gunId !== "string" || gunId === "" || gunId.length > MAX_GUN_ID_LENGTH) return bad();
      return { ok: true, message: { v: 1, type: obj.type, gunId, angle, power, facing } };
    }
    case "challenge": {
      const id = obj.targetEntityId;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return bad();
      return { ok: true, message: { v: 1, type: "challenge", targetEntityId: id } };
    }
    case "challenge_reply": {
      const { challengeId, accept } = obj;
      if (!isId(challengeId) || typeof accept !== "boolean") return bad();
      return { ok: true, message: { v: 1, type: "challenge_reply", challengeId, accept } };
    }
    case "challenge_cancel": {
      const challengeId = obj.challengeId;
      if (!isId(challengeId)) return bad();
      return { ok: true, message: { v: 1, type: "challenge_cancel", challengeId } };
    }
    case "set_loadout": {
      const ids = obj.gunIds;
      if (!Array.isArray(ids) || ids.length > MAX_LOADOUT_IDS) return bad();
      for (const g of ids) if (typeof g !== "string" || g === "" || g.length > MAX_GUN_ID_LENGTH) return bad();
      return { ok: true, message: { v: 1, type: "set_loadout", gunIds: ids as string[] } };
    }
    default:
      return fail("unknown_type");
  }
}
