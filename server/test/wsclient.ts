import { WebSocket } from "ws";

/** Client WebSocket cho test tích hợp: ghi log mọi thông điệp, chờ theo điều kiện. */
export class Client {
  log: any[] = [];
  private cursor = 0;
  private waiters: Array<() => void> = [];
  closeCode: number | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      this.log.push(JSON.parse(d.toString()));
      for (const w of this.waiters.splice(0)) w();
    });
    ws.on("close", (code) => {
      this.closeCode = code;
      for (const w of this.waiters.splice(0)) w();
    });
  }
  static async open(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    const c = new Client(ws);
    c.send({ type: "hello", clientVersion: "test" });
    await c.waitFor("welcome");
    return c;
  }
  send(o: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, ...o }));
  }
  async waitFor(match: string | ((m: any) => boolean), timeoutMs = 6000): Promise<any> {
    const pred = typeof match === "string" ? (m: any) => m.type === match : match;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.log.length) {
        const m = this.log[this.cursor++];
        if (pred(m)) return m;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        const kinds = this.log.filter((m) => m.type !== "world_tick").map((m) => m.type);
        throw new Error(`hết giờ chờ ${String(match)}; đã nhận: ${kinds.join(",")}`);
      }
      await new Promise<void>((res) => {
        const t = setTimeout(res, left);
        this.waiters.push(() => {
          clearTimeout(t);
          res();
        });
      });
    }
  }
  /** Không nhận được thông điệp khớp trong `ms` mili giây thật (tính từ vị trí đọc hiện tại). */
  async expectNone(pred: (m: any) => boolean, ms = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    const hit = this.log.slice(this.cursor).find(pred);
    if (hit) throw new Error(`nhận thông điệp không mong đợi: ${JSON.stringify(hit)}`);
  }
  async waitClosed(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error("hết giờ chờ đóng kết nối");
      await new Promise((r) => setTimeout(r, 5));
    }
    return this.closeCode;
  }
}
