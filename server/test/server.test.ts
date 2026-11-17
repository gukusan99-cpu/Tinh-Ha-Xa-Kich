import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type GameServer } from "../src/server.js";

let server: GameServer;
const clients: WebSocket[] = [];

beforeEach(async () => {
  server = await createServer({ port: 0 });
});

afterEach(async () => {
  for (const c of clients) c.terminate();
  clients.length = 0;
  await server.close();
});

async function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  clients.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

/** Hàng đợi thông điệp để test đọc tuần tự, không mất tin. */
function inbox(ws: WebSocket) {
  const queue: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString());
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return {
    next: () =>
      new Promise<any>((resolve, reject) => {
        const m = queue.shift();
        if (m !== undefined) return resolve(m);
        const t = setTimeout(() => reject(new Error("hết giờ chờ thông điệp")), 2000);
        waiters.push((x) => {
          clearTimeout(t);
          resolve(x);
        });
      }),
  };
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve(-1);
    ws.once("close", (code) => resolve(code));
  });
}

const hello = JSON.stringify({ v: 1, type: "hello", clientVersion: "test" });

describe("máy chủ giai đoạn 0", () => {
  it("hello -> welcome", async () => {
    const ws = await connect();
    const box = inbox(ws);
    const before = Date.now();
    ws.send(hello);
    const m = await box.next();
    expect(m.v).toBe(1);
    expect(m.type).toBe("welcome");
    expect(typeof m.sessionId).toBe("string");
    expect(m.sessionId.length).toBeGreaterThan(10);
    expect(typeof m.serverVersion).toBe("string");
    expect(m.serverTime).toBeGreaterThanOrEqual(before);
  });

  it("ping -> pong lặp lại seq", async () => {
    const ws = await connect();
    const box = inbox(ws);
    ws.send(hello);
    await box.next();
    ws.send(JSON.stringify({ v: 1, type: "ping", seq: 42 }));
    const m = await box.next();
    expect(m).toMatchObject({ v: 1, type: "pong", seq: 42 });
    expect(typeof m.serverTime).toBe("number");
  });

  it("gửi ping trước hello -> not_hello rồi đóng", async () => {
    const ws = await connect();
    const box = inbox(ws);
    const c = closed(ws);
    ws.send(JSON.stringify({ v: 1, type: "ping", seq: 1 }));
    const m = await box.next();
    expect(m).toMatchObject({ v: 1, type: "error", code: "not_hello" });
    expect(typeof m.message).toBe("string");
    await c;
  });

  it("lỗi đơn lẻ không đóng kết nối", async () => {
    const ws = await connect();
    const box = inbox(ws);
    ws.send(hello);
    await box.next();
    ws.send("{garbage");
    expect(await box.next()).toMatchObject({ type: "error", code: "bad_json" });
    ws.send(JSON.stringify({ v: 9, type: "ping", seq: 1 }));
    expect(await box.next()).toMatchObject({ type: "error", code: "bad_version" });
    ws.send(JSON.stringify({ v: 1, type: "nope" }));
    expect(await box.next()).toMatchObject({ type: "error", code: "unknown_type" });
    ws.send(JSON.stringify({ v: 1, type: "ping", seq: 7 }));
    expect(await box.next()).toMatchObject({ type: "pong", seq: 7 });
  });

  it("quá 5 thông điệp lỗi -> đóng kết nối", async () => {
    const ws = await connect();
    const box = inbox(ws);
    ws.send(hello);
    await box.next();
    const c = closed(ws);
    for (let i = 0; i < 6; i++) ws.send("{garbage");
    for (let i = 0; i < 6; i++) {
      expect(await box.next()).toMatchObject({ type: "error", code: "bad_json" });
    }
    await c;
  });

  it("thông điệp quá 4 KB -> đóng kết nối (1009)", async () => {
    const ws = await connect();
    const c = closed(ws);
    ws.send(JSON.stringify({ v: 1, type: "hello", clientVersion: "a", pad: "x".repeat(5000) }));
    expect(await c).toBe(1009);
  });

  it("máy chủ sống sót sau rác, nhị phân và client ngắt đột ngột", async () => {
    const a = await connect();
    a.send(Buffer.from([0xff, 0x00, 0x13]));
    a.send("\u0000\u0001 {{{{");
    a.terminate();

    const b = await connect();
    const box = inbox(b);
    b.send(hello);
    expect((await box.next()).type).toBe("welcome");
    b.send(JSON.stringify({ v: 1, type: "ping", seq: 1 }));
    expect((await box.next()).type).toBe("pong");
  });

  it("hello lần hai -> bad_message", async () => {
    const ws = await connect();
    const box = inbox(ws);
    ws.send(hello);
    await box.next();
    ws.send(hello);
    expect(await box.next()).toMatchObject({ type: "error", code: "bad_message" });
  });
});
