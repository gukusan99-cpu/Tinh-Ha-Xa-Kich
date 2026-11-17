/** Sổ lời mời thách đấu (docs/08): mỗi người một lời mời đang chờ, hết hạn theo giờ máy chủ, cooldown sau khi bị từ chối. */
import { randomUUID } from "node:crypto";
import type { Clock } from "./clock.js";
import type { ChallengeCloseReason } from "./protocol.js";

export interface Challenge {
  id: string;
  /** Khóa tài khoản (chữ thường) của người mời / người nhận. */
  fromKey: string;
  toKey: string;
  expiresAt: number;
}

export class ChallengeBook {
  private readonly byId = new Map<string, { c: Challenge; cancel: () => void }>();
  private readonly byPlayer = new Map<string, Challenge>();
  /** `${from}>${to}` -> giờ máy chủ được mời lại. */
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly timeoutMs: number,
    private readonly retryMs: number,
    /** Gọi sau khi lời mời đã hết hạn và bị gỡ khỏi sổ. */
    private readonly onExpire: (c: Challenge) => void,
    private readonly newId: () => string = randomUUID,
  ) {}

  get(id: string): Challenge | undefined {
    return this.byId.get(id)?.c;
  }

  /** Lời mời đang chờ của người chơi (gửi hoặc nhận). */
  ofPlayer(key: string): Challenge | undefined {
    return this.byPlayer.get(key);
  }

  /** Không bận lời mời nào và `from` không còn trong thời gian chờ mời lại `to`. */
  canOpen(fromKey: string, toKey: string): boolean {
    if (fromKey === toKey || this.byPlayer.has(fromKey) || this.byPlayer.has(toKey)) return false;
    const until = this.cooldowns.get(`${fromKey}>${toKey}`);
    return until === undefined || this.clock.now() >= until;
  }

  open(fromKey: string, toKey: string): Challenge | null {
    if (!this.canOpen(fromKey, toKey)) return null;
    const c: Challenge = { id: this.newId(), fromKey, toKey, expiresAt: this.clock.now() + this.timeoutMs };
    const cancel = this.clock.setTimeout(() => {
      if (this.remove(c.id)) this.onExpire(c);
    }, this.timeoutMs);
    this.byId.set(c.id, { c, cancel });
    this.byPlayer.set(fromKey, c);
    this.byPlayer.set(toKey, c);
    return c;
  }

  /** Gỡ lời mời. "declined" đặt cooldown mời lại. Trả null nếu không còn. */
  close(id: string, reason: ChallengeCloseReason): Challenge | null {
    const c = this.remove(id);
    if (c && reason === "declined") {
      const now = this.clock.now();
      for (const [k, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(k);
      this.cooldowns.set(`${c.fromKey}>${c.toKey}`, now + this.retryMs);
    }
    return c;
  }

  private remove(id: string): Challenge | null {
    const e = this.byId.get(id);
    if (!e) return null;
    e.cancel();
    this.byId.delete(id);
    this.byPlayer.delete(e.c.fromKey);
    this.byPlayer.delete(e.c.toKey);
    return e.c;
  }

  /** Dừng mọi timer (khi tắt máy chủ). */
  dispose(): void {
    for (const e of this.byId.values()) e.cancel();
    this.byId.clear();
    this.byPlayer.clear();
  }
}
