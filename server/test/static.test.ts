import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createServer, type GameServer } from "../src/server.js";

describe("phục vụ bản Web cùng cổng", () => {
  let server: GameServer;
  let base: string;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "thxk-web-"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "index.html"), "<html>ok</html>");
    writeFileSync(join(root, "game.wasm"), Buffer.from([0, 97, 115, 109]));
    writeFileSync(join(root, "..", "bimat.txt"), "không được lộ");
    server = await createServer({ port: 0, staticDir: root });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => server.close());

  it("trả index.html ở / kèm header COOP/COEP", async () => {
    const r = await fetch(base + "/");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("ok");
    expect(r.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("đúng MIME cho wasm", async () => {
    const r = await fetch(base + "/game.wasm");
    expect(r.headers.get("content-type")).toBe("application/wasm");
  });

  it("404 khi không có file, 403/404 khi thoát khỏi thư mục", async () => {
    expect((await fetch(base + "/khong-co.js")).status).toBe(404);
    const r = await fetch(base + "/%2e%2e/bimat.txt");
    expect([403, 404]).toContain(r.status);
    expect(await r.text()).not.toContain("không được lộ");
  });

  it("WebSocket vẫn chạy trên cùng cổng", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const msg = await new Promise<string>((res, rej) => {
      ws.on("open", () => ws.send(JSON.stringify({ v: 1, type: "hello", clientVersion: "t" })));
      ws.on("message", (d) => res(String(d)));
      ws.on("error", rej);
    });
    ws.close();
    expect(JSON.parse(msg).type).toBe("welcome");
  });
});
