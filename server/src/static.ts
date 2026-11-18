import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

/** Phục vụ bản xuất Web của Godot (build/web) cùng cổng với WebSocket. Chỉ GET/HEAD, không liệt kê thư mục. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function createStaticHandler(dir: string): (req: IncomingMessage, res: ServerResponse) => void {
  const root = resolve(dir);
  return (req, res) => {
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      let path: string;
      try {
        path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (path.endsWith("/")) path += "index.html";
      const file = normalize(join(root, path));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (!(await stat(file)).isFile()) throw new Error("not a file");
        const body = await readFile(file);
        res.writeHead(200, {
          "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
          "Content-Length": body.length,
          // Cho phép bản Web dùng SharedArrayBuffer nếu bật luồng.
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cache-Control": "no-cache",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Không tìm thấy");
      }
    })();
  };
}
