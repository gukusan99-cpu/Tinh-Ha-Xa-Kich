/** Tài khoản & nhân vật. Giai đoạn 1: lưu trong bộ nhớ qua interface `AccountStore`. */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import {
  normalizeCharacterName,
  validatePassword,
  validateUsername,
  type AuthErrorCode,
  type Character,
} from "./protocol.js";

export interface AccountRecord {
  username: string;
  passwordHash: string;
  character: Character | null;
}

/** Bản PostgreSQL thay vào sau mà không đổi giao thức. Tên tra cứu không phân biệt hoa thường. */
export interface AccountStore {
  /** Trả null nếu tên đã có. */
  create(username: string, passwordHash: string): Promise<AccountRecord | null>;
  find(username: string): Promise<AccountRecord | null>;
  /** Chỉ đặt khi chưa có nhân vật; trả false nếu đã có hoặc không có tài khoản. */
  createCharacter(username: string, character: Character): Promise<boolean>;
  saveCharacter(username: string, character: Character): Promise<boolean>;
}

export class MemoryAccountStore implements AccountStore {
  private readonly byKey = new Map<string, AccountRecord>();
  private static key(u: string): string {
    return u.toLowerCase();
  }
  async create(username: string, passwordHash: string): Promise<AccountRecord | null> {
    const k = MemoryAccountStore.key(username);
    if (this.byKey.has(k)) return null;
    const rec: AccountRecord = { username, passwordHash, character: null };
    this.byKey.set(k, rec);
    return structuredClone(rec);
  }
  async find(username: string): Promise<AccountRecord | null> {
    const r = this.byKey.get(MemoryAccountStore.key(username));
    return r ? structuredClone(r) : null;
  }
  async createCharacter(username: string, character: Character): Promise<boolean> {
    const r = this.byKey.get(MemoryAccountStore.key(username));
    if (!r || r.character) return false;
    r.character = structuredClone(character);
    return true;
  }
  async saveCharacter(username: string, character: Character): Promise<boolean> {
    const r = this.byKey.get(MemoryAccountStore.key(username));
    if (!r) return false;
    r.character = structuredClone(character);
    return true;
  }
}

// ---------- băm mật khẩu ----------

const KEY_LEN = 64;
const SALT_LEN = 16;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Định dạng lưu: `scrypt:<salt hex>:<hash hex>` (tham số mặc định của Node). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
  const actual = await scryptAsync(password, salt);
  return timingSafeEqual(actual, expected);
}

// ---------- exp / cấp ----------

/** Lên cấp khi exp ≥ expPerLevel × level; phần dư giữ lại. Không sửa đầu vào. */
export function applyExp(c: Character, gain: number, expPerLevel: number): Character {
  let { level, exp } = c;
  exp += gain;
  while (exp >= expPerLevel * level) {
    exp -= expPerLevel * level;
    level++;
  }
  return { ...c, level, exp };
}

// ---------- dịch vụ ----------

export interface AccountRules {
  signs: string[];
  startingGunId: string;
  expPerLevel: number;
}

export type RegisterResult = { ok: true; account: AccountRecord } | { ok: false; code: AuthErrorCode };
export type CharacterResult = { ok: true; character: Character } | { ok: false; code: "exists" | "invalid" };

export class AccountService {
  /** Băm giả để đăng nhập tài khoản không tồn tại tốn thời gian như tài khoản có thật. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly store: AccountStore,
    private readonly rules: AccountRules,
  ) {}

  async register(username: string, password: string): Promise<RegisterResult> {
    if (!validateUsername(username) || !validatePassword(password)) return { ok: false, code: "invalid" };
    const account = await this.store.create(username, await hashPassword(password));
    return account ? { ok: true, account } : { ok: false, code: "taken" };
  }

  async login(username: string, password: string): Promise<RegisterResult> {
    const account = validateUsername(username) ? await this.store.find(username) : null;
    if (!account) {
      this.dummyHash ??= hashPassword("dummy-password");
      await verifyPassword(password, await this.dummyHash);
      return { ok: false, code: "bad_credentials" };
    }
    if (!(await verifyPassword(password, account.passwordHash))) return { ok: false, code: "bad_credentials" };
    return { ok: true, account };
  }

  async createCharacter(username: string, rawName: string, sign: string): Promise<CharacterResult> {
    const name = normalizeCharacterName(rawName);
    if (name === null || !this.rules.signs.includes(sign)) return { ok: false, code: "invalid" };
    const character: Character = { name, sign, level: 1, exp: 0, gunId: this.rules.startingGunId };
    if (!(await this.store.createCharacter(username, character))) return { ok: false, code: "exists" };
    return { ok: true, character };
  }

  /** Cộng exp, lưu và trả nhân vật mới; null nếu không có tài khoản/nhân vật. */
  async awardExp(username: string, gain: number): Promise<Character | null> {
    const account = await this.store.find(username);
    if (!account?.character) return null;
    const next = applyExp(account.character, gain, this.rules.expPerLevel);
    await this.store.saveCharacter(username, next);
    return next;
  }
}
