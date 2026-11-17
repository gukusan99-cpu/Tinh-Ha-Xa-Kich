import type { Clock } from "../src/clock.js";
import { loadGameData, type GameData } from "../src/data.js";

/** Bản sao dữ liệu thật để test sửa thoải mái. */
export function testData(): GameData {
  return structuredClone(loadGameData());
}

/** Đồng hồ thủ công: test tự tiến thời gian. */
export class ManualClock implements Clock {
  private t = 1_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void; every?: number }>();

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return () => void this.timers.delete(id);
  }
  setInterval(fn: () => void, ms: number): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return () => void this.timers.delete(id);
  }
  pending(): number {
    return this.timers.size;
  }
  /** Tiến `ms` mili giây, chạy các timer đến hạn theo thứ tự. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let best: [number, { at: number; fn: () => void; every?: number }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e;
      if (!best) break;
      const [id, tm] = best;
      this.t = Math.max(this.t, tm.at);
      if (tm.every !== undefined) tm.at += tm.every;
      else this.timers.delete(id);
      tm.fn();
    }
    this.t = end;
  }
}

/** Cho các promise đang chờ chạy xong. */
export async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
